/* jshint sub: true */
/* globals MessageQueue, JpegImage, vagueTime */

/* set minimum based on pebble.h's APP_MESSAGE_INBOX_MINIMUM */
var CHUNK_SIZE = 124;

var IMG_WIDTH = 144;

var sendSuccess = function(e) {
    console.log("sendSuccess, e: " + JSON.stringify(e));
    //console.log(
    //    'Successfully delivered message with transactionId=' +
    //    e.data.transactionId);
};

var sendFailure = function(e) {
    console.log("sendFailure, e: " + JSON.stringify(e));
    //console.log(
    //    'Unable to deliver message with transactionId=' +
    //    e.data.transactionId +
    //    ' Error is: ' + e.error.message);
};

var transferInProgress = false;

function transferImageBytes(bytes, chunkSize, successCb, failureCb) {
    console.log("transferImageBytes, chunkSize" + chunkSize);
    var retries = 0;
    var success = function() {
        console.log("Success cb=" + successCb);
        if (successCb !== undefined) {
            successCb();
        }
    };
    var failure = function(e) {
        console.log("Failure cb=" + failureCb);
        if (failureCb !== undefined) {
            failureCb(e);
        }
    };

    bytes = packImage(bytes);
    
    // This function sends chunks of data.
    var sendChunk = function(start) {
        var txbuf = Array.prototype.slice.call(bytes, start, start + chunkSize);
        console.log("Sending " + txbuf.length + " bytes at offset " + start);
        MessageQueue.sendAppMessage(
            { "NETDL_DATA": txbuf },
            function(e) {
                // If there is more data to send - send it.
                if (bytes.length > start + chunkSize) {
                    sendChunk(start + chunkSize);
                }
                // Otherwise we are done sending. Send closing message.
                else {
                    MessageQueue.sendAppMessage({"NETDL_END": "done" }, success, failure);
                }
            },
            // Failed to send message - Retry a few times.
            function (e) {
                if (retries++ < 3) {
                    console.log("Got a nack for chunk #" + start + " - Retry...");
                    sendChunk(start);
                }
                else {
                    failure(e);
                }
            }
        );
    };

    // Let the pebble app know how much data we want to send.
    console.log("Sending NETDL_BEGIN, bytes.length = " + bytes.length);
    MessageQueue.sendAppMessage(
        {"NETDL_BEGIN": bytes.length, "PACKED_IMG": 1 },
        function (e) {
            // success - start sending
            sendChunk(0);
        }, failure);
}

// step 1 -- get current geolocation

function takePicture() {
    navigator.geolocation.getCurrentPosition(
        findNearbyPhotos,
        locationError,
        {
            enableHighAccuracy: true, 
            maximumAge: 10000, 
            timeout: 10000
        });
}

function locationError(err) {
    console.log('location error (' + err.code + '): ' + err.message);
    // FIXME: send "can't search" message back to watch
}

// step 2 - make API call to Instagram to get nearby pictures
function findNearbyPhotos(pos) {
    console.log('lat= ' + pos.coords.latitude + ' lon= ' + pos.coords.longitude);
    if (localStorage.getItem("access_token")) {
        var req = new XMLHttpRequest();
        var url = "https://api.instagram.com/v1/media/search" +
            "?lat=" + pos.coords.latitude +
            "&lng=" + pos.coords.longitude +
            "&access_token=" + localStorage.getItem("access_token");
        console.log("GET " + url);
        req.open('GET', url, true);
        req.onload = selectPhotos.bind(this, req);
        req.send();
    }
    else {
        var msg = { UPDATE_TOKEN: false };
        MessageQueue.sendAppMessage(msg, sendSuccess, sendFailure);
    }
}

// step 3 - find candidate photos to request and resample
function selectPhotos(req, e) {
    if (req.readyState == 4 && req.status == 200) {
        var response = JSON.parse(req.responseText);
        var data = response.data;
        var candidates = [];
        var i, entry;
        for (i in data) {
            entry = data[i];
            if (entry.type == "image" &&
                entry.images &&
                entry.images.thumbnail &&
                entry.images.thumbnail.url &&
                entry.user &&
                entry.user.username &&
                entry.created_time) {
                candidates.push({
                    // url: entry.images.thumbnail.url,
                    url: entry.images.low_resolution.url,
                    username: entry.user.username,
                    created_time: entry.created_time
                });
                //console.log("url: " + entry.images.thumbnail.url +
                //            ", user: " + entry.user.username +
                //            ", time: " + entry.created_time);
            }
        }

        // process candidates list, pick most recent one to fetch
        if (candidates.length > 0) {
            var latestEntry = {
                created_time: 0
            };
            for (i in candidates) {
                entry = candidates[i];
                if (entry.created_time > latestEntry.created_time) {
                    latestEntry = entry;
                }
            }
            processPhoto(latestEntry);
            // possibly post other candidates to timeline in future version
        }
        else {
            console.log("no suitable candidates");
            // FIXME: return error to user
        }
    }
    else {
        console.log('Error');
        // FIXME - indicate error to user on watch
    }
}

function processPhoto(photo) {
    console.log("processing photo at url " + photo.url);

    // send to phone meta data on entry
    console.log("timeTaken: " + photo.created_time);
    var msg = {
        PICTURE_USER: photo.username,
        PICTURE_TIME: vagueTime.get({
            to: photo.created_time * 1000
        })
    };
    console.log("sending " + JSON.stringify(msg));
    MessageQueue.sendAppMessage(msg, sendSuccess, sendFailure);

    // load image into JPEG decoder library
    var j = new JpegImage();
    j.onload = function() {
        var w = j.width, h = j.height;
        console.log("decoded image, size: " + w + "x" + h);
        
        var img = {
            width: IMG_WIDTH,
            height: IMG_WIDTH,
            data: new Uint8ClampedArray(IMG_WIDTH * IMG_WIDTH * 4)
        };
        j.copyToImageData(img);

        // now, resample the imgData to BGRA color
        ditherImage(img.data);
        var pebbleImg = downsampleImage(img.data);

        transferImageBytes(
            pebbleImg, CHUNK_SIZE,
            function() { console.log("Done!"); transferInProgress = false; },
            function(e) { console.log("Failed! " + e); transferInProgress = false; }
        );
    };
    j.load(photo.url);
}

function ditherImage(imgData) {
    for (var i = 0; i < IMG_WIDTH * IMG_WIDTH * 4; i++) {
        // convert in place to 6-bit color with Floyd-Steinberg dithering
        var oldPixel = imgData[i];
        var newPixel = oldPixel & 0xC0;
        imgData[i] = newPixel;
        var quantError = oldPixel - newPixel;
        imgData[i + 4] += quantError * 7 / 16;
        imgData[i + ((IMG_WIDTH - 1) * 4)] += quantError * (3 / 16);
        imgData[i + (IMG_WIDTH * 4)] += quantError * (5 / 16);
        imgData[i + ((IMG_WIDTH + 1) * 4)] += quantError * (1 / 16);
    }
}

function downsampleImage(imgData) {
    var pebbleImg = new Uint8Array(IMG_WIDTH * IMG_WIDTH);
    for (var i = 0, d = 0; i < IMG_WIDTH * IMG_WIDTH; i++, d += 4) {
        pebbleImg[i] =
            0xC0 |
            /* R */ (imgData[d] & 0xC0) >> 2 |
            /* G */ (imgData[d + 1] & 0xC0) >> 4 |
            /* B */ (imgData[d + 2] & 0xC0) >> 6;
    }
    return pebbleImg;
}

// unpacked: --AAAAA --BBBBBB --CCCCCC --DDDDDD
//   packed: AAAAAABB BBBBCCCC CCDDDDDD
function packImage(imgData) {
    var packedImg = new Uint8Array(IMG_WIDTH * IMG_WIDTH * 3 / 4);
    for (var i = 0, j = 0; i < IMG_WIDTH * IMG_WIDTH * 4; i += 4, j += 3) {
        packedImg[j] = ((imgData[i] & 0x3F) << 2)     | ((imgData[i + 1] & 0x30) >> 4);
        packedImg[j + 1] = ((imgData[i + 1] & 0x0F) << 4) | ((imgData[i + 2] & 0x3C) >> 2);
        packedImg[j + 2] = ((imgData[i + 2] & 0x03) << 6) | (imgData[i + 3] & 0x3F);
    }
    return packedImg;
}

Pebble.addEventListener("ready", function(e) {
    console.log("NetDownload JS Ready");
    // send current access token state back to app
    var access_token = localStorage.getItem("access_token");
    var msg = { UPDATE_TOKEN: access_token ? 1 : 0 };
    MessageQueue.sendAppMessage(msg, sendSuccess, sendFailure);
});

Pebble.addEventListener("showConfiguration", function(e) {
    Pebble.openURL('http://combee.net/phantom-camera/config.html');
});

Pebble.addEventListener("webviewclosed", function(e) {
    var msg = {};
    if (e.response) {
        console.log("got access token: " + e.response);
        localStorage.setItem("access_token", e.response);
        msg.UPDATE_TOKEN = 1;
    }
    else {
        console.log("no access token received");
        localStorage.setItem("access_token", null);
        msg.UPDATE_TOKEN = 0;
    }
    MessageQueue.sendAppMessage(msg, sendSuccess, sendFailure);
});

Pebble.addEventListener("appmessage", function(e) {
    console.log("Got message: " + JSON.stringify(e));

    if ('TAKE_PICTURE' in e.payload) {
        CHUNK_SIZE = e.payload['NETDL_CHUNK_SIZE'];
        if ('LATITUDE' in e.payload && 'LONGITUDE' in e.payload) {
            var pos = {
                coords: { 
                    latitude: e.payload.LATITUDE / 1000, 
                    longitude: e.payload.LONGITUDE / 1000
                } 
            };
            findNearbyPhotos(pos);
        }
        else {
            takePicture();
        }
    }
});
