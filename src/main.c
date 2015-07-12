#include <pebble.h>
#include <inttypes.h>
    
static Window *window;
static TextLayer *text_layer;
static BitmapLayer *bitmap_layer;
static GBitmap *image_bmp;
static GBitmap *phantom_bmp;
static uint8_t *sDataBuffer = NULL;
static uint32_t sDataBufferLen = 0;
static char sErrorMsg[32];
static char sName[32];
static char sTimeTaken[32];
static bool sIsPacked;

/* The key used to indicate Instagram token state. UInt8 as boolean */
#define UPDATE_TOKEN 1

/* The key used to indicate that you should grab the nearest picture, UInt8 - ignored */
#define TAKE_PICTURE 2

/* key for username associated with incoming picture, string */
#define PICTURE_USER 3

/* key for description text associated with incoming picture, string */
#define PICTURE_TEXT 4

/* key for display time of incoming picture, string */
#define PICTURE_TIME 5

/* keys to send predefined position with picture request to override geolocation */
#define LATITUDE 6
#define LONGITUDE 7

/* if set, bitmap is using 6-bit pixels, packed 4 pixels to 3 bytes */
#define PACKED_IMG 8

/* string with error message from JS side, usually a network failure */
#define ERROR 9
    
/* The key used to transmit download data. Contains byte array. */
#define NETDL_DATA 5000 
/* The key used to start a new image transmission. Contains uint32 size */
#define NETDL_BEGIN NETDL_DATA + 1
/* The key used to finalize an image transmission. Data not defined. */
#define NETDL_END NETDL_DATA + 2

/* The key used to tell the JS how big chunks should be */
#define NETDL_CHUNK_SIZE NETDL_DATA + 3
/* The key used to request a PBI */
#define NETDL_URL NETDL_DATA + 4

typedef void (*NetDownloadCallback)(const char *name, const char *timeTaken);

typedef struct {
  /* size of the data buffer allocated */
  uint32_t length;
  /* buffer of data that will contain the actual data */
  uint8_t *data;
  /* Next byte to write */
  uint32_t index;
  /* Callback to call when we are done loading the data */
  NetDownloadCallback callback;
} NetDownloadContext;

static char *translate_error(AppMessageResult result) {
    switch (result) {
        case APP_MSG_OK: return "APP_MSG_OK";
        case APP_MSG_SEND_TIMEOUT: return "APP_MSG_SEND_TIMEOUT";
        case APP_MSG_SEND_REJECTED: return "APP_MSG_SEND_REJECTED";
        case APP_MSG_NOT_CONNECTED: return "APP_MSG_NOT_CONNECTED";
        case APP_MSG_APP_NOT_RUNNING: return "APP_MSG_APP_NOT_RUNNING";
        case APP_MSG_INVALID_ARGS: return "APP_MSG_INVALID_ARGS";
        case APP_MSG_BUSY: return "APP_MSG_BUSY";
        case APP_MSG_BUFFER_OVERFLOW: return "APP_MSG_BUFFER_OVERFLOW";
        case APP_MSG_ALREADY_RELEASED: return "APP_MSG_ALREADY_RELEASED";
        case APP_MSG_CALLBACK_ALREADY_REGISTERED: return "APP_MSG_CALLBACK_ALREADY_REGISTERED";
        case APP_MSG_CALLBACK_NOT_REGISTERED: return "APP_MSG_CALLBACK_NOT_REGISTERED";
        case APP_MSG_OUT_OF_MEMORY: return "APP_MSG_OUT_OF_MEMORY";
        case APP_MSG_CLOSED: return "APP_MSG_CLOSED";
        case APP_MSG_INTERNAL_ERROR: return "APP_MSG_INTERNAL_ERROR";
        default: return "UNKNOWN ERROR";
    }
}

static NetDownloadContext* netdownload_create_context(NetDownloadCallback callback) {
    NetDownloadContext *ctx = malloc(sizeof(NetDownloadContext));

    ctx->length = 0;
    ctx->index = 0;
    ctx->data = sDataBuffer;
    ctx->callback = callback;

    return ctx;
}

static void netdownload_destroy_context(NetDownloadContext *ctx) {
    free(ctx);
}

static void request_picture(void) {
    DictionaryIterator *outbox;
    app_message_outbox_begin(&outbox);
    // Tell the javascript how big we want each chunk of data: max possible size - dictionary overhead with one Tuple in it.
    uint32_t chunk_size = app_message_inbox_size_maximum() - dict_calc_buffer_size(1);
    dict_write_uint32(outbox, NETDL_CHUNK_SIZE, chunk_size);
    // include request token
    dict_write_int8(outbox, TAKE_PICTURE, 0);
    app_message_outbox_send();
}

// unpacked: --AAAAA --BBBBBB --CCCCCC --DDDDDD
//   packed: AAAAAABB BBBBCCCC CCDDDDDD
static void unpackImage(uint8_t *data, uint32_t packedLength) {
    for (int32_t i = packedLength - 3, j = packedLength / 3 * 4 - 4; i >= 0; i -= 3, j -= 4) {
        data[j + 3] = 0xC0 | (data[i + 2] & 0x3F);
        data[j + 2] = 0xC0 | ((data[i + 2] & 0xC0) >> 6) | ((data[i + 1] & 0x0F) << 2);
        data[j + 1] = 0xC0 | ((data[i + 1] & 0xF0) >> 4) | ((data[i] & 0x03) << 4);
        data[j]     = 0xC0 | ((data[i] & 0xFC) >> 2);
    }
}
    
static void netdownload_receive(DictionaryIterator *iter, void *context) {
    NetDownloadContext *ctx = (NetDownloadContext*) context;

    Tuple *tuple = dict_read_first(iter);
    if (!tuple) {
        APP_LOG(APP_LOG_LEVEL_ERROR, "Got a message with no first key! Size of message: %" PRIo32, (uint32_t)iter->end - (uint32_t)iter->dictionary);
        return;
    }
    while (tuple) {
        switch (tuple->key) {
            case NETDL_DATA: {
                if (ctx->index + tuple->length <= ctx->length) {
                    memcpy(ctx->data + ctx->index, tuple->value->data, tuple->length);
                    ctx->index += tuple->length;
                }
                else {
                    APP_LOG(APP_LOG_LEVEL_WARNING, "Not overriding rx buffer. Bufsize=%" PRIu32 " "
                            "BufIndex=%" PRIu32 " DataLen=%" PRIu16,
                            ctx->length, ctx->index, tuple->length);
                }
                break;
            }
            case NETDL_BEGIN: {
                APP_LOG(APP_LOG_LEVEL_DEBUG, "Start transmission. Size=%lu", tuple->value->uint32);
                ctx->length = tuple->value->uint32;
                // limit length to size of buffer
                if (ctx->length > sDataBufferLen)
                    ctx->length = sDataBufferLen;
                ctx->index = 0;
                bitmap_layer_set_bitmap(bitmap_layer, phantom_bmp);
                text_layer_set_text(text_layer, "Developing...");
                break;
            }
            case PACKED_IMG: {
                sIsPacked = tuple->value->uint8;
                break;
            }
            case NETDL_END: {
                if (ctx->data && ctx->length > 0 && ctx->index > 0) {
                    printf("Received complete file=%" PRIu32, ctx->length);
                    if (sIsPacked) {
                        unpackImage(ctx->data, ctx->length);
                    }
                    ctx->callback(sName, sTimeTaken);
    
                    // We have transfered ownership of this memory to the app. Make sure we dont free it.
                    // (see netdownload_destroy for cleanup)
                    ctx->index = 0;
                    ctx->length = 0;
                }
                else {
                    APP_LOG(APP_LOG_LEVEL_DEBUG, "Got End message but we have no image...");
                }
                break;
            }
            case UPDATE_TOKEN: {
                APP_LOG(APP_LOG_LEVEL_DEBUG, "has_instagram_token: %s",
                       tuple->value->uint8 ? "yes" : "no");
                text_layer_set_text(
                    text_layer, 
                    tuple->value->uint8 ? "Click!" : "Configure me!");
                break;
            }
            case PICTURE_USER: {
                APP_LOG(APP_LOG_LEVEL_DEBUG, "user: %s", tuple->value->cstring);
                strncpy(sName, tuple->value->cstring, sizeof(sName));
                sName[sizeof(sName) - 1] = 0;
                break;
            }
            case PICTURE_TIME: {
                APP_LOG(APP_LOG_LEVEL_DEBUG, "time: %s", tuple->value->cstring);
                strncpy(sTimeTaken, tuple->value->cstring, sizeof(sTimeTaken));
                sTimeTaken[sizeof(sTimeTaken) - 1] = 0;
                break;
            }
            case PICTURE_TEXT: {
                APP_LOG(APP_LOG_LEVEL_DEBUG, "text: %s", tuple->value->cstring);
                break;
            }
            case ERROR: {
                APP_LOG(APP_LOG_LEVEL_ERROR, "error received: %s", tuple->value->cstring);
                strncpy(sErrorMsg, tuple->value->cstring, sizeof(sErrorMsg));
                sErrorMsg[sizeof(sErrorMsg) - 1] = 0;
                text_layer_set_text(text_layer, sErrorMsg);
                break;
            }
            default: {
                APP_LOG(APP_LOG_LEVEL_WARNING, "Unknown key in dict: %" PRIo32, tuple->key);
                break;
            }
        }
        tuple = dict_read_next(iter);
    }
}

static void netdownload_dropped(AppMessageResult reason, void *context) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Dropped message! Reason given: %s", translate_error(reason));
}

static void netdownload_out_success(DictionaryIterator *iter, void *context) {
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Message sent.");
}

static void netdownload_out_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Failed to send message. Reason = %s", translate_error(reason));
}

static void netdownload_initialize(NetDownloadCallback callback, uint8_t *data, uint32_t maxLength) {
    sDataBuffer = data;
    sDataBufferLen = maxLength;

    NetDownloadContext *ctx = netdownload_create_context(callback);
    APP_LOG(APP_LOG_LEVEL_DEBUG, "NetDownloadContext = %p", ctx);
    app_message_set_context(ctx);

    app_message_register_inbox_received(netdownload_receive);
    app_message_register_inbox_dropped(netdownload_dropped);
    app_message_register_outbox_sent(netdownload_out_success);
    app_message_register_outbox_failed(netdownload_out_failed);
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Max buffer sizes are %li / %li", app_message_inbox_size_maximum(), app_message_outbox_size_maximum());
    app_message_open(app_message_inbox_size_maximum(), app_message_outbox_size_maximum());
}

static void netdownload_deinitialize(void) {
    netdownload_destroy_context(app_message_get_context());
    app_message_set_context(NULL);
}

static void take_picture() {
    // show that we are loading by showing no image
    text_layer_set_text(text_layer, "Searching...");
    request_picture();
}

static void download_complete_handler(const char *name, const char *time_taken) {
    /* let user know download was complete by buzzing and turning on light */
    vibes_short_pulse();
    light_enable_interaction();
    
    /* image_bmp's data is updated, so safe to show it now */
    bitmap_layer_set_bitmap(bitmap_layer, image_bmp);
    text_layer_set_text(text_layer, time_taken);
}

static void click_handler(ClickRecognizerRef recognizer, void *context) {
    APP_LOG(APP_LOG_LEVEL_INFO, "main - select");
    take_picture();
}

static void click_config_provider(void *context) {
    window_single_click_subscribe(BUTTON_ID_SELECT, click_handler);
}

static void window_load(Window *window) {
    Layer *window_layer = window_get_root_layer(window);

    bitmap_layer = bitmap_layer_create((GRect) { .origin = { 0, 0 }, .size = { 144, 144 } });
    bitmap_layer_set_bitmap(bitmap_layer, phantom_bmp);
    layer_add_child(window_layer, bitmap_layer_get_layer(bitmap_layer));

    text_layer = text_layer_create((GRect) { .origin = { 0, 144 }, .size = { 144, 24 } });
    text_layer_set_font(text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
    text_layer_set_text(text_layer, "Contacting spirits...");
    text_layer_set_text_alignment(text_layer, GTextAlignmentCenter);
    layer_add_child(window_layer, text_layer_get_layer(text_layer));
    
    window_set_click_config_provider(window, click_config_provider);
}

static void window_unload(Window *window) {
    bitmap_layer_destroy(bitmap_layer);
}

static void init(void) {
    image_bmp = gbitmap_create_blank((GSize){144, 144}, GBitmapFormat8Bit);
    phantom_bmp = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_PHANTOM);

    window = window_create();
    window_set_window_handlers(window, (WindowHandlers) {
        .load = window_load,
        .unload = window_unload,
    });
    const bool animated = true;
    window_stack_push(window, animated);

    // Need to initialize this first to make sure it is there when
    // the window_load function is called by window_stack_push.
    netdownload_initialize(download_complete_handler, gbitmap_get_data(image_bmp), 144 * 144);
}

static void deinit(void) {
    gbitmap_destroy(image_bmp);
    gbitmap_destroy(phantom_bmp);
    netdownload_deinitialize(); // call this to avoid 20B memory leak
    window_destroy(window);
}

int main(void) {
    init();
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Done initializing, pushed window: %p", window);
    app_event_loop();
    deinit();
}
