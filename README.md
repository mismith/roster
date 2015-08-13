Roster IO
========================

Quickly poll your team roster's availability.


## TODO

- fix cron timezone issues
- improve loading screen messaging if angular fails, connectivity issues, etc
- send email to roster members on event day to notify them
- async email sending via debounced queue in firebase
- fix dialog error handling and loading icon issues
- in dialogs, clone edited object so cancellable changes aren't visible locally
- auto-accept invites if invited user's email logs in (and not necessarily to accept that invite)
- add proper auth to API
- add proper auth to Firebase from Node
- fix minor page loading flicker (using resolve?)
- fix buggy fast scrolling on mobile
- add offline app cache for homescreen app (or native app wrapper?)
- add local notifications for reminders (including push notifications for home screen apps?)
- shareable urls on event pages
- google contacts integration?