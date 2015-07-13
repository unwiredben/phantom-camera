TO DO LIST
----------
* provide more download feedback
* lock out user action until we get token verification
* show animated ghost instead of static ghost bitmap
* handle communication timeout on startup
* handle communication timeout for getting geolocation
* handle communication timeout for finding matches
* handle communication timeout when downloading image

FUTURE FEATURES
---------------
* use action bar on initial screen
* keep previous picture until new one starts downloading
* add option to take pictures at remote scenic locales
* add timeline pins for five most recent pictures
* add launch mechanism to show a recent picture
* make select when viewing photo go to screen showing info, "refresh", and maybe "like"
* update jpg.js code with latest from https://github.com/mozilla/pdf.js/blob/master/src/core/jpg.js, make PR to notmasteryet's repo with updates

COMPLETED
---------
* check for auth token at startup
* integrate message queue management code
* reduce download time by sending 6-bit pixels instead of 8-bit
* handle case where user de-authorizes the app
  * ```{"meta":{"error_type":"OAuthParameterException","code":400,"error_message":"The access_token provided is invalid."}}```
