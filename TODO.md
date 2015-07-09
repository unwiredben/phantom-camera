TO DO LIST
----------
* use action bar on initial screen
* lock out user action until we get token verification
* provide more download feedback
* keep previous picture until new one starts downloading
* add option to take pictures at remote scenic locales
* show animated ghost instead of static ghost bitmap
* add timeline pins for five most recent pictures
* add launch mechanism to show a recent picture
* make select when viewing photo go to screen showing info, "refresh", and maybe "like"
* handle case where user de-authorizes the app
  * ```{"meta":{"error_type":"OAuthParameterException","code":400,"error_message":"The access_token provided is invalid."}}```
* handle communication timeout on startup
* handle communication timeout for getting geolocation
* handle communication timeout for finding matches
* handle communication timeout when downloading image

COMPLETED
---------
* check for auth token at startup
* integrate message queue management code
* reduce download time by sending 6-bit pixels instead of 8-bit


