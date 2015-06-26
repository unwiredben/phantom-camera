#include <pebble.h>
#include <inttypes.h>
#include "netdownload.h"
    
static Window *window;
static TextLayer *text_layer;
static BitmapLayer *bitmap_layer;
static GBitmap *current_bmp;

void show_next_image() {
    // show that we are loading by showing no image
    bitmap_layer_set_bitmap(bitmap_layer, NULL);

    text_layer_set_text(text_layer, "Loading...");

    // Unload the current image if we had one and save a pointer to this one
    if (current_bmp) {
        gbitmap_destroy(current_bmp);
        current_bmp = NULL;
    }

    netdownload_request("");
}

static void window_load(Window *window) {
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);

    bitmap_layer = bitmap_layer_create(bounds);
    layer_add_child(window_layer, bitmap_layer_get_layer(bitmap_layer));
    current_bmp = NULL;
}

static void window_unload(Window *window) {
    bitmap_layer_destroy(bitmap_layer);
    gbitmap_destroy(current_bmp);
}

void download_complete_handler(NetDownload *download) {
    printf("Loaded image with %" PRIu32 " bytes", download->length);
    printf("Heap free is %" PRIu32 " bytes", (uint32_t)heap_bytes_free());

    GBitmap *bmp = gbitmap_create_from_png_data(download->data, download->length);
    bitmap_layer_set_bitmap(bitmap_layer, bmp);

    // Save pointer to currently shown bitmap (to free it)
    if (current_bmp) {
        gbitmap_destroy(current_bmp);
    }
    current_bmp = bmp;

    // Free the memory now
    free(download->data);

    // We null it out now to avoid a double free
    download->data = NULL;
    netdownload_destroy(download);
}

void tap_handler(AccelAxisType accel, int32_t direction) {
    show_next_image();
}

static void init(void) {
    // Need to initialize this first to make sure it is there when
    // the window_load function is called by window_stack_push.
    netdownload_initialize(download_complete_handler);

    window = window_create();
    window_set_window_handlers(window, (WindowHandlers) {
        .load = window_load,
        .unload = window_unload,
    });
    const bool animated = true;
    window_stack_push(window, animated);

    accel_tap_service_subscribe(tap_handler);
}

static void deinit(void) {
    netdownload_deinitialize(); // call this to avoid 20B memory leak
    window_destroy(window);
}

int main(void) {
    init();

    APP_LOG(APP_LOG_LEVEL_DEBUG, "Done initializing, pushed window: %p", window);

    app_event_loop();
    deinit();
}
