TO DO LIST
----------
* lock out user action until we get token verification
* show animated ghost instead of static ghost bitmap
* handle communication timeout on startup
* handle communication timeout for getting geolocation
* handle communication timeout for finding matches
* handle communication timeout when downloading image

FUTURE FEATURES
---------------
* better label buttons on initial screen
* add timeline pins for five most recent pictures
* add launch mechanism to show a recent picture
* update jpg.js code with latest from https://github.com/mozilla/pdf.js/blob/master/src/core/jpg.js, make PR to notmasteryet's repo with updates

COMPLETED
---------
* add ability to get pictures from popular and personal feeds
* keep previous picture until new one starts downloading
* provide more download feedback
* check for auth token at startup
* integrate message queue management code
* reduce download time by sending 6-bit pixels instead of 8-bit
* handle case where user de-authorizes the app
  * ```{"meta":{"error_type":"OAuthParameterException","code":400,"error_message":"The access_token provided is invalid."}}```
