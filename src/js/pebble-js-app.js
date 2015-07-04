/* jshint sub: true */
/* globals JpegImage */

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

Pebble.addEventListener("ready", function(e) {
    console.log("NetDownload JS Ready");
});

Pebble.addEventListener("appmessage", function(e) {
    console.log("Got message: " + JSON.stringify(e));

    if ('NETDL_URL' in e.payload) {
        if (!transferInProgress) {
            transferInProgress = true;
            downloadBinaryResource(e.payload['NETDL_URL'], function(bytes) {
                transferImageBytes(bytes, e.payload['NETDL_CHUNK_SIZE'],
                                   function() { console.log("Done!"); transferInProgress = false; },
                                   function(e) { console.log("Failed! " + e); transferInProgress = false; }
                                  );
            },
                                   function(e) {
                                       console.log("Download failed: " + e); transferInProgress = false;
                                   });
        }
        else {
            console.log("Ignoring request to download " + e.payload['NETDL_URL'] + " because another download is in progress.");
        }
    }
    else if ('CHECK_TOKEN' in e.payload) {
        var msg = {};
        var access_token = localStorage.getItem("access_token");
        if (access_token) {
            msg.UPDATE_TOKEN = true;
        }
        else {
            msg.UPDATE_TOKEN = false;
        }
        Pebble.sendAppMessage(msg, sendSuccess, sendFailure);
    }
    else if ('TAKE_PICTURE' in e.payload) {
        takePicture();
    }
});

function downloadBinaryResource(imageURL, callback, errorCallback) {
    var req = new XMLHttpRequest();
    req.open("GET", imageURL,true);
    req.responseType = "arraybuffer";
    req.onload = function(e) {
        console.log("loaded");
        var buf = req.response;
        if(req.status == 200 && buf) {
            var byteArray = new Uint8Array(buf);
            var arr = [];
            for(var i=0; i<byteArray.byteLength; i++) {
                arr.push(byteArray[i]);
            }

            console.log("Downloaded file with " + byteArray.length + " bytes.");
            callback(arr);
        }
        else {
            errorCallback("Request status is " + req.status);
        }
    };
    req.onerror = function(e) {
        errorCallback(e);
    };
    req.send(null);
}

function transferImageBytes(bytes, chunkSize, successCb, failureCb) {
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

    // This function sends chunks of data.
    var sendChunk = function(start) {
        var txbuf = bytes.slice(start, start + chunkSize);
        console.log("Sending " + txbuf.length + " bytes - starting at offset " + start);
        Pebble.sendAppMessage({ "NETDL_DATA": txbuf },
                              function(e) {
                                  // If there is more data to send - send it.
                                  if (bytes.length > start + chunkSize) {
                                      sendChunk(start + chunkSize);
                                  }
                                  // Otherwise we are done sending. Send closing message.
                                  else {
                                      Pebble.sendAppMessage({"NETDL_END": "done" }, success, failure);
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
    Pebble.sendAppMessage({"NETDL_BEGIN": bytes.length },
                          function (e) {
                              // success - start sending
                              sendChunk(0);
                          }, failure);

}

Pebble.addEventListener("showConfiguration", function(e) {
    Pebble.openURL('http://combee.net/phantom-camera/config.html');
});

Pebble.addEventListener("webviewclosed", function(e) {
    var msg = {};
    if (e.response) {
        console.log("got access token: " + e.response);
        localStorage.setItem("access_token", e.response);
        msg.UPDATE_TOKEN = true;
    }
    else {
        console.log("no access token received");
        localStorage.setItem("access_token", null);
        msg.UPDATE_TOKEN = false;
    }
    Pebble.sendAppMessage(msg, sendSuccess, sendFailure);
});


// step 1 -- get current geolocation

function takePicture() {
    if (localStorage.getItem("access_token")) {
        navigator.geolocation.getCurrentPosition(
            findNearbyPhotos,
            locationError,
            {
                enableHighAccuracy: true, 
                maximumAge: 10000, 
                timeout: 10000
            });
    }
    else {
        console.log("no access_token set");
    }
}

function locationError(err) {
    console.log('location error (' + err.code + '): ' + err.message);
    // FIXME: send "can't search" message back to watch
}

// step 2 - make API call to Instagram to get nearby pictures
function findNearbyPhotos(pos) {
    console.log('lat= ' + pos.coords.latitude + ' lon= ' + pos.coords.longitude);
    // test at home
    pos.coords.latitude = 30.3278514;
    pos.coords.longitude = -97.7362387;
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
                    url: entry.images.thumbnail.url,
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
                time: 0
            };
            for (i in candidates) {
                entry = candidates[i];
                if (entry.time > latestEntry.time)
                    latestEntry = entry;
            }
            processPhoto(entry);
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
    var msg = {
        PICTURE_USER: photo.username,
        PICTURE_TIME: photo.created_time
    };
    console.log("sending " + JSON.stringify(msg));
    Pebble.sendAppMessage(msg, sendSuccess, sendFailure);

    // load image into JPEG decoder library
    var j = new JpegImage();
    j.onload = function() {
        console.log("decoded image, size: " + j.width + "x" + j.height);
        // produce PNG using 144x144 center crop of picture
        // post PNG data back to watch app
    };
    j.load(photo.url);
}