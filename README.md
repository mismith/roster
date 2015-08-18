Roster IO
========================

Quickly poll your team roster's availability.


## @TODO

- improve loading screen messaging if angular fails, connectivity issues, etc
- improve user profiles by adding recent activity + upcoming rsvps
- improve notifications with user-selectable preferences
	- send email to roster members on event day to notify them
	- add local notifications for reminders (including push notifications for home screen apps?)
- improve dialogs/forms
	- fix dialog error handling and loading icon issues
	- in dialogs, clone edited object so cancellable changes aren't visible locally
- auto-accept invites if invited user's email logs in (and not necessarily to accept that invite)
	- improve invites so someone can be invited to more than 1 roster
- add proper auth to API
- add proper auth to Firebase from Node
- add offline app cache for homescreen app (or native app wrapper?)
- fix buggy fast scrolling on touch
- fix minor page loading flicker (using resolve?)

- add way to edit admins
- add (request) subs functionality
- add one-touch access to next event