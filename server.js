#!/bin/env node

var FB_BASE_URL = 'https://roster-io.firebaseio.com';

var fs        = require('fs'),
	express   = require('express'),
	server    = express(),
	Postmark  = require('postmark'),
	postmark  = new Postmark.Client('75cdd97a-2c40-4319-a6a9-4576d0948d57'),
	ejs       = require('ejs'),
	juice     = require('juice'),
	moment    = require('moment'),
	Firebase  = require('firebase'),
	extend    = require('node.extend'),
	Q         = require('q')
	_         = require('lodash'),
	rest      = require('restler'),
	scheduler = require('node-schedule');

// web app
server.use(express.static('html'));
server.get('/', express.static('html/index.html'));

// api
function authed(req, res, next) {
	if (req.headers.authorization) {
		next();
	} else {
		res.send(403);
	}
}

function getCompiledTemplate(templateId, callback) {
	// read template
	fs.readFile('html/emails/' + templateId + '.html', function (err, file) {
		if (err) {
			console.error(err);
			return;
		}
		
		// compile it
		var compiled = ejs.compile(file.toString());
		
		// return it
		callback(compiled);
	});
}
function getJuicedEmail(template, data, callback) {
	// render email
	var html = template(data);
	
	// juice email
	juice.juiceResources(html, {
		webResources: {
			relativeTo: 'http://www.rstr.io/',
			images: false,
		}
	}, function (err, juiced) {
		if (err) {
			console.error(err);
			return;
		}
		
		callback(juiced);
	});
}



function getEventInfo(rosterId, eventId, callback) {
	// fetch data
	new Firebase(FB_BASE_URL + '/data/rosters/' + rosterId).once('value', function (snapshot) {
		var roster  = snapshot.val();
		if ( ! roster) {
			// make sure roster exists
			console.error('Roster "' + rosterId + '" not found.');
			return; // @TODO
		}
		
		var event   = roster.events[eventId];
		if ( ! event) {
			// make sure event exists
			console.error('Event "' + eventId + '" not found.');
			return; // @TODO
		}
		
		roster.$id = rosterId;
		roster.url = '#/roster/' + roster.$id;
		event.$id  = eventId;
		event.url  = roster.url + '/' + event.$id;
		
		callback(roster, event);
	});
}
function getEventReminderEmailTemplate(rosterId, eventId, callback) {
	getCompiledTemplate('reminder', function (template) {
		getEventInfo(rosterId, eventId, function (roster, event) {
			var subject = 'Reminder: RSVP Required - ' + roster.name + ' - ' + event.name,
				data = {
					subject:  subject,
					roster:   roster,
					event:    event,
					
					// helpers
					moment:   moment,
				};
			
			callback(template, data);
		});
	});
}
server.get('/api/v1/email/reminder', function (req, res) {
	getEventReminderEmailTemplate(req.query.roster, req.query.event, function (template, data) {
		getJuicedEmail(template, data, function (html) {
			// display email
			res.send(html);
		});
	});
});
function sendEventReminderEmails(rosterId, eventId, callback) {
	getEventReminderEmailTemplate(rosterId, eventId, function (template, data) {
		var response = {success: true, sent: [], skipped: [], failed: []};
		
		var deferreds = [];
		Object.keys(data.roster.participants).forEach(function (userId) {
			var deferred = Q.defer();
			deferreds.push(deferred.promise);
			(function (deferred) {
				new Firebase(FB_BASE_URL + '/data/users/' + userId).once('value', function (userSnap) {
					var user = userSnap.val();
					if (user.email && ( ! data.event.rsvps || ! data.event.rsvps[userId] || data.event.rsvps[userId].status < 0)) {
						// clone the data for each user so we don't mess anything up
						var userData = extend({}, data, {user: user});
						
						getJuicedEmail(template, userData, function (html) {
							// send email
							postmark.sendEmail({
								From:       'rsvp@rstr.io',
								To:         user.name + ' <' + user.email + '>',
								Subject:    data.subject,
								HtmlBody:   html,
								TrackOpens: true,
							}, function (err) {
								if (err) {
									response.failed.push({userId: userId, error: err});
									response.success = false;
									
									deferred.resolve();
									return;
								}
								response.sent.push({userId: userId});
								deferred.resolve();
							});
						});
					} else {
						response.skipped.push({userId: userId});
						deferred.resolve();
					}
				});
			})(deferred);
		});
		Q.all(deferreds).then(function () {
			callback(response);
		});
	});
}
server.post('/api/v1/email/reminder', function (req, res) {
	sendEventReminderEmails(req.query.roster, req.query.event, function (response) {
		res.json(response);
	});
});


function dispatchReminders() {
	new Firebase(FB_BASE_URL + '/data/rosters').once('value', function (rostersSnap) {
		_.each(rostersSnap.val(), function (roster, rosterId) {
			_.each(roster.events, function (event, eventId) {
				// check if date matches a range that needs sending reminders for
				var now  = moment(),
					date = moment(event.date);
				if (now.isBefore(date), now.isSame(date, 'week')) {
					// send individual emails (to specific users based on logic within sentReminderEmails)
					sendEventReminderEmails(rosterId, eventId, function (response) {
						console.log(response); // @TODO: handle errors
					});
				}
			});
		});
	});
}
scheduler.scheduleJob('0 0 17 * * 1' /* every Monday at 5pm */, dispatchReminders);
server.post('/api/v1/dispatch/reminders', function (req, res) {
	dispatchReminders();
});



function getInviteInfo(inviteId, callback) {
	// fetch data
	new Firebase(FB_BASE_URL + '/data/invites/' + inviteId).once('value', function (inviteSnap) {
		var invite = inviteSnap.val();
		if (invite) {
			invite.$id = inviteId;
			invite.url = '#/invite/' + invite.$id;
			
			new Firebase(FB_BASE_URL + '/data/users/' + invite.by).once('value', function (userSnap) {
				var user = userSnap.val();
				
				user.$id = userSnap.key();
	
				new Firebase(FB_BASE_URL + '/data/rosters/' + invite.to.params.roster).once('value', function (rosterSnap) {
					var roster = rosterSnap.val();
				
					roster.$id = rosterSnap.key();
					roster.url = '#/roster/' + roster.$id;
					
					callback(invite, user, roster);
				});
			});
		} else {
			// @TODO
			console.error('Invite not found');
		}
	});
}
function getInviteEmail(inviteId, callback) {
	getCompiledTemplate('invite', function (template) {
		getInviteInfo(inviteId, function (invite, inviter, roster) {
			inviter.avatar = 'http://graph.facebook.com/' + (inviter.facebook && inviter.facebook.id ? inviter.facebook.id + '/' : '') + 'picture?type=square';
			
			var subject = 'Invitation: Join ' + inviter.name + ' on the "' + roster.name + '" roster',
				data = {
					subject: subject,
					invite:  invite,
					inviter: inviter,
					roster:  roster,
				};
				
			getJuicedEmail(template, data, function (html) {
				callback(html, data);
			});
		});
	});
}
server.get('/api/v1/email/invite', function (req, res) {
	getInviteEmail(req.query.invite, function (html, data) {
		// return email as html
		res.send(html);
	});
});
server.post('/api/v1/email/invite', function (req, res) {
	getInviteEmail(req.query.invite, function (html, data) {
		// send email
		postmark.sendEmail({
			From:       'invite@rstr.io',
			To:         data.invite.name ? data.invite.name + ' <' + data.invite.email + '>' : data.invite.email,
			Subject:    data.subject,
			HtmlBody:   html,
			TrackOpens: true,
		}, function (err) {
			if (err) {
				console.error(err);
				
				res.json({
					success: false,
					error:   err,
				});
				return;
			}
			res.json({success: true});
		});
	});
});

server.get('/api/v1/url/shorten', function (req, res) {
	var id = 1000;
	var alphabet = 'UteQA9bjVXygpBE2vchDdnKrk7xMFHGa3RmCf6uZws4Tl8zqNWYPJ',
		count    = alphabet.length;
	
	function hash(n) {
		if(n > count) {
			return hash(Math.floor(n / count)) + alphabet[n % count];
		} else {
			return alphabet[n];
		}
	}
	
	res.send(hash(req.query.url));
});

server.listen(process.env.OPENSHIFT_NODEJS_PORT || 3030, process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1');