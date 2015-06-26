/* jshint sub: true */

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
        // FIXME - trigger server to get picture, return url, then use that as NETDL_URL process
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

