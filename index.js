#!/bin/env node

var opbeat = require('opbeat').start({
	appId: '29ee5b27da',
	organizationId: '6b3a8bba7de440a9905bf3ddf30b8c7e',
	secretToken: '599934ab6d5b9da42ed137275c6929ac5899a0f5',
});

var NAME           = 'Roster IO',
	DOMAIN         = 'roster.mismith.io',
	BASE_URL       = 'https://' + DOMAIN,
	FB_BASE_URL    = 'https://roster-io.firebaseio.com',
	FB_AUTH_TOKEN  = 'xwYj28J4UELF5WgifokLbqjN71mFE9Y4cBwykmyI',
	POSTMARK_TOKEN = '75cdd97a-2c40-4319-a6a9-4576d0948d57',
	EMAIL          = 'roster@mismith.io',
	TIMEZONE       = 'America/Edmonton';

var express   = require('express'),
	server    = express(),
	moment    = require('moment-timezone'),
	Firebase  = require('firebase'),
	extend    = require('node.extend'),
	Q         = require('q'),
	_         = require('lodash'),
	CronJob   = require('cron').CronJob,
	ical      = require('ical-generator'),
	miEmail   = require('mi-node-email')(POSTMARK_TOKEN);

// config
moment.tz.setDefault(TIMEZONE);

// make Error object's JSON-ifiable more easily
Object.defineProperty(Error.prototype, 'toJSON', {
	value: function () {
		var alt = {};

		Object.getOwnPropertyNames(this).forEach(function (key) {
			alt[key] = this[key];
		}, this);

		return alt;
	},
	configurable: true
});

// web app
server.use(express.static('build'));

// api
var api = express.Router();
server.use('/api/v1', api);

// routes
server.all('/*', function(req, res){
	res.sendFile(__dirname + '/build/index.html');
});

// server
server.listen(process.env.PORT || 3030);



// api methods

// invites
function getInviteInfo(inviteId) {
	var deferred = Q.defer();
	
	// fetch data
	if (inviteId) {
		new Firebase(FB_BASE_URL + '/data/invites/' + inviteId).once('value', function (inviteSnap) {
			var invite = inviteSnap.val();
			if (invite) {
				invite.$id = inviteId;
				invite.url = '/invite/' + invite.$id;
				
				new Firebase(FB_BASE_URL + '/data/users/' + invite.inviterId).once('value', function (inviterSnap) {
					var inviter = inviterSnap.val();
					inviter.$id = inviterSnap.key();
		
					new Firebase(FB_BASE_URL + '/data/rosters/' + invite.rosterId).once('value', function (rosterSnap) {
						var roster = rosterSnap.val();
						roster.$id = rosterSnap.key();
						roster.url = '/roster/' + roster.$id;
						
						deferred.resolve({
							invite:  invite,
							inviter: inviter,
							roster:  roster,
						});
					});
				});
			} else {
				deferred.reject(new Error('Invite not found'));
			}
		});
	} else {
		deferred.reject(new Error('Invite not specified'));
	}
	
	return deferred.promise;
}
function getInviteEmail(inviteId) {
	var deferred = Q.defer();
	
	miEmail.getCompiledTemplate('invite').then(function (template) {
		getInviteInfo(inviteId).then(function (info) {
			info.inviter.avatar = 'https://graph.facebook.com/' + (info.inviter && info.inviter.facebookId ? info.inviter.facebookId + '/' : '') + 'picture?type=square';
			info.subject = 'Invitation: Join ' + info.inviter.name + ' on the "' + info.roster.name + '" roster';
				
			miEmail.getJuicedEmail(template, info).then(function (html) {
				deferred.resolve({
					html: html,
					info: info,
				});
			}).catch(function (err) {
				deferred.reject(err);
			});
		}).catch(function (err) {
			deferred.reject(err);
		});
	}).catch(function (err) {
		deferred.reject(err);
	});
	
	return deferred.promise;
}
function sendInviteEmail(inviteId) {
	var deferred = Q.defer();
	
	getInviteEmail(inviteId).then(function (email) {
		// send email
		return miEmail.sendEmail({
			From:       EMAIL,
			To:         email.info.invite.name ? email.info.invite.name + ' <' + email.info.invite.email + '>' : email.info.invite.email,
			Subject:    email.info.subject,
			HtmlBody:   email.html,
			TrackOpens: true,
		}).then(function () {
			deferred.resolve();
		});
	}).catch(function (err) {
		deferred.reject(err);
	});
	
	return deferred.promise;
}
/*
api.get('/email/invite', function (req, res) {
	getInviteEmail(req.query.inviteId).then(function (email) {
		// return email as html
		res.send(email.html);
	}).catch(function (err) {
		res.json({
			success: false,
			error: err,
		});
	});
});
api.post('/email/invite', function (req, res) {
	sendInviteEmail(req.query.inviteId).then(function () {
		res.json({
			success: true,
		});
	}).catch(function (err) {
		res.json({
			success: false,
			error:   err,
		});
	});
});
*/



// user added
function getAddedInfo(rosterId, inviteeId, inviterId) {
	var deferred = Q.defer();
	
	// fetch data
	if (rosterId) {
		new Firebase(FB_BASE_URL + '/data/rosters/' + rosterId).once('value', function (rosterSnap) {
			var roster = rosterSnap.val();
			if (roster) {
				roster.$id = rosterId;
				roster.url = '/roster/' + roster.$id;
				
				if (inviteeId) {
					new Firebase(FB_BASE_URL + '/data/users/' + inviteeId).once('value', function (inviteeSnap) {
						var invitee = inviteeSnap.val();
						if (invitee) {
							invitee.$id = inviteeSnap.key();
				
							if (inviterId) {
								new Firebase(FB_BASE_URL + '/data/users/' + inviterId).once('value', function (inviterSnap) {
									var inviter = inviterSnap.val();
									if (inviter) {
										inviter.$id = inviterSnap.key();
										inviter.avatar = 'http://graph.facebook.com/' + (inviter.facebookId ? inviter.facebookId + '/' : '') + 'picture?type=square';
										
										deferred.resolve({
											roster:  roster,
											invitee: invitee,
											inviter: inviter,
										});
									} else {
										deferred.reject(new Error('Inviter not found'));
									}
								});
							} else {
								deferred.reject(new Error('Inviter not specified'));
							}
						} else {
							deferred.reject(new Error('Invitee not found'));
						}
					});
				} else {
					deferred.reject(new Error('Invitee not specified'));
				}
			} else {
				deferred.reject(new Error('Roster not found'));
			}
		});
	} else {
		deferred.reject(new Error('Roster not specified'));
	}
	
	return deferred.promise;
}
function getAddedEmail(rosterId, inviteeId, inviterId) {
	var deferred = Q.defer();
	
	miEmail.getCompiledTemplate('added').then(function (template) {
		getAddedInfo(rosterId, inviteeId, inviterId).then(function (info) {
			info.subject = info.inviter.name + ' added you to the "' + info.roster.name + '" roster';
				
			miEmail.getJuicedEmail(template, info).then(function (html) {
				deferred.resolve({
					html: html,
					info: info,
				});
			}).catch(function (err) {
				deferred.reject(err);
			});
		}).catch(function (err) {
			deferred.reject(err);
		});
	}).catch(function (err) {
		deferred.reject(err);
	});
	
	return deferred.promise;
}
function sendAddedEmail(rosterId, inviteeId, inviterId) {
	var deferred = Q.defer();
	
	getAddedEmail(rosterId, inviteeId, inviterId).then(function (email) {
		// send email
		return miEmail.sendEmail({
			From:       EMAIL,
			To:         email.info.invitee.name ? email.info.invitee.name + ' <' + email.info.invitee.email + '>' : email.info.invitee.email,
			Subject:    email.info.subject,
			HtmlBody:   email.html,
			TrackOpens: true,
		}).then(function () {
			deferred.resolve();
		});
	}).catch(function (err) {
		deferred.reject(err);
	});
	
	return deferred.promise;
}
/*
api.get('/email/added', function (req, res) {
	getAddedEmail(req.query.rosterId, req.query.inviteeId, req.query.inviterId).then(function (email) {
		// return email as html
		res.send(email.html);
	}).catch(function (err) {
		res.json({
			success: false,
			error: err,
		});
	});
});
api.post('/email/added', function (req, res) {
	sendAddedEmail(req.query.rosterId, req.query.inviteeId, req.query.inviterId).then(function () {
		res.json({
			success: true,
		});
	}).catch(function (err) {
		res.json({
			success: false,
			error:   err,
		});
	});
});
*/



// reminders
function getReminderInfo(rosterId, eventId) {
	var deferred = Q.defer();
	
	// fetch data
	if (rosterId) {
		new Firebase(FB_BASE_URL + '/data/rosters/' + rosterId).once('value', function (snapshot) {
			var roster  = snapshot.val();
			if (roster) {
				roster.$id = rosterId;
				roster.url = '/roster/' + roster.$id;
				
				if (eventId) {
					new Firebase(FB_BASE_URL + '/data/rosterEvents/' + rosterId + '/' + eventId).once('value', function (eventSnap) {
						var event = eventSnap.val();
						
						if (event) {
							event.$id  = eventId;
							event.url  = roster.url + '/' + event.$id;
							
							deferred.resolve({
								roster: roster,
								event:  event,
							});
						} else {
							deferred.reject(new Error('Event not found'));
						}
					});
				} else {
					deferred.reject(new Error('Event not specified'));
				}
			} else {
				deferred.reject(new Error('Roster not found'));
			}
		});
	} else {
		deferred.reject(new Error('Roster not specified'));
	}
	
	return deferred.promise;
}
function getReminderEmailTemplate(rosterId, eventId) {
	var deferred = Q.defer();
	
	miEmail.getCompiledTemplate('reminder').then(function (template) {
		getReminderInfo(rosterId, eventId).then(function (info) {
			info.subject = 'Reminder: RSVP Required - ' + info.roster.name + ' - ' + info.event.name;
			info.moment  = moment;
			
			deferred.resolve({
				html: template,
				info: info,
			});
		}).catch(function (err) {
			deferred.reject(err);
		});
	}).catch(function (err) {
		deferred.reject(err);
	});
	
	return deferred.promise;
}
function sendReminderEmails(rosterId, eventId, optionalUserId) {
	// @TODO double check all the error handling in here
	var deferred = Q.defer();
	
	getReminderEmailTemplate(rosterId, eventId).then(function (template) {
		var response = {success: true, sent: [], skipped: [], failed: []};
		
		var deferreds = [];
		Object.keys(template.info.roster.participants).forEach(function (userId) {
			if (optionalUserId === undefined || userId === optionalUserId) {
				var d = Q.defer();
				deferreds.push(d.promise);
				(function (d) {
					new Firebase(FB_BASE_URL + '/data/users/' + userId).once('value', function (userSnap) {
						var user = userSnap.val();
						if (user.email && ( ! template.info.event.rsvps || ! template.info.event.rsvps[userId] || template.info.event.rsvps[userId].status < 0)) {
							// clone the data for each user so we don't mess anything up
							var userInfo = extend({}, template.info, {user: user});
							
							miEmail.getJuicedEmail(template.html, userInfo).then(function (html) {
								// send email
								miEmail.sendEmail({
									From:       EMAIL,
									To:         user.name + ' <' + user.email + '>',
									Subject:    template.info.subject,
									HtmlBody:   html,
									TrackOpens: true,
								}).then(function () {
									response.sent.push({userId: userId});
									
									d.resolve();
								}).catch(function (err) {
									response.failed.push({userId: userId, error: err});
									response.success = false;
										
									d.resolve();
								});
							}).catch(function (err) {
								response.failed.push({userId: userId, error: err});
								response.success = false;
								
								d.resolve();
							});
						} else {
							response.skipped.push({userId: userId});
							d.resolve();
						}
					});
				})(d);
			} else {
				response.skipped.push({userId: userId});
			}
		});
		Q.all(deferreds).then(function () {
			deferred.resolve(response);
		}).catch(function (err) {
			deferred.reject(err);
		});
	}).catch(function (err) {
		deferred.reject(err);
	});
	
	return deferred.promise;
}
/*
api.get('/email/reminder', function (req, res) {
	getReminderEmailTemplate(req.query.rosterId, req.query.eventId).then(function (template) {
		miEmail.getJuicedEmail(template.html, template.info).then(function (html) {
			// display email
			res.send(html);
		}).catch(function (err) {
			res.json({
				success: false,
				error: err,
			});
		});
	}).catch(function (err) {
		res.json({
			success: false,
			error: err,
		});
	});
});
api.post('/email/reminder', function (req, res) {
	sendReminderEmails(req.query.rosterId, req.query.eventId, req.query.userId).then(function (response) {
		res.json(response);
	}).catch(function (err) {
		res.json({
			success: false,
			error:   err,
		});
	});
});
*/

function dispatchReminders(rosterId) {
	new Firebase(FB_BASE_URL + '/data/rosterEvents/' + rosterId).once('value', function (eventsSnap) {
		var events = eventsSnap.val();
		
		_.each(events, function (event, eventId) {
			// check if date matches a range that needs sending reminders for
			var now  = moment(),
				date = moment(event.date),
				diff = date.diff(now, 'day');
			if (0 <= diff && diff < 7) {
				// send individual emails (only to certain users, based on logic within sentReminderEmails)
				sendReminderEmails(rosterId, eventId).then(function (response) {
					console.log('Event ' + eventId + ':\n', response);
				}).catch(function (err) {
					console.error(err); // @TODO
				});
			}
		});
	});
}
var runningJobs = {};
var rostersRef = new Firebase(FB_BASE_URL + '/data/rosters');
rostersRef.on('child_added', function (rosterSnap) {
	var rosterId  = rosterSnap.key(),
		rosterRef = rosterSnap.ref();
	
	rosterRef.child('cron').on('value', function (cronSnap) {
		// stop any running job since we've changed how often it should run anyway
		if (runningJobs[rosterId]){
			runningJobs[rosterId].stop();
			delete runningJobs[rosterId];
		}
		
		var cron = cronSnap.val();
		if (cron) {
			try {
				runningJobs[rosterId] = new CronJob(cron, function () {
					console.log('Running cron for roster ' + rosterId + '.');
					dispatchReminders(rosterId);
				}, undefined, true, TIMEZONE);
			} catch (err) {
				console.error(err);
			}
		}
	});	
});
rostersRef.on('child_removed', function (rosterSnap) {
	var rosterId = rosterSnap.key();
	
	// stop any jobs for this roster
	if (runningJobs[rosterId]){
		runningJobs[rosterId].stop();
		delete runningJobs[rosterId];
	}
});



// email queueing
miEmail.firebaseQueue(new Firebase(FB_BASE_URL + '/queues/email'), FB_AUTH_TOKEN).watch(function (email) {
	switch (email.template) {
		case 'invite':
			return sendInviteEmail(email.data.inviteId).then(function () {
				new Firebase(FB_BASE_URL + '/data/invites/' + email.data.inviteId).update({sent: moment().format()});
			});
		case 'added':
			return sendAddedEmail(email.data.rosterId, email.data.inviteeId, email.data.inviterId);
		case 'reminder':
			return sendReminderEmails(email.data.rosterId, email.data.eventId, email.data.userId);
	}
});



/*
// url shortening
function generateHash(n) {
	var alphabet = 'UteQA9bjVXygpBE2vchDdnKrk7xMFHGa3RmCf6uZws4Tl8zqNWYPJ', // random order a-zA-Z0-9 non-similar
		length   = alphabet.length;
	
	if(n > length) {
		return generateHash(Math.floor(n / length)) + alphabet[n % length];
	} else {
		return alphabet[n];
	}
}
function getUrl(hash) {
	var deferred = Q.defer();
	
	if (hash) {
		new Firebase(FB_BASE_URL + '/data/urls/' + hash).once('value', function (urlSnap) {
			var url = urlSnap.val();
			
			if (url) {
				deferred.resolve(url);
			} else {
				deferred.reject(new Error('URL not found for hash "' + hash + '"'));
			}
		});
	} else {
		deferred.reject(new Error('Hash not specified'));
	}
	
	return deferred.promise;
}
api.get('/url/unshorten', function (req, res) {
	var hash = req.query.hash;
	getUrl(hash).then(function (url) {
		res.send({
			success: true,
			hash:    hash,
			url:     url,
		});
	}).catch(function (err) {
		res.json({
			success: false,
			error:   err,
		});
	});
});
api.post('/url/shorten', function (req, res) {
	var urlsRef = new Firebase(FB_BASE_URL + '/data/urls');
	urlsRef.once('value', function (urlsSnap) {
		var urls = urlsSnap.val(),
			url  = req.query.url || BASE_URL + req.query.path;
		
		if (url) {
			// check if url has already been shortened
			var hash;
			_.each(urls, function(u, h) {
				if (url === u) {
					hash = h + '';
					return false;
				}
			});
			// otherwise, generate a new one
			if ( ! hash) hash = generateHash(urlsSnap.numChildren() + 1000 + 1);
			
			// save it
			urlsRef.child(hash).set(url, function () {
				res.json({
					success: true,
					hash:    hash,
					url:     url,
				});
			});
		} else {
			res.json({
				success: false,
				error:   new Error('URL or Path not specified'),
			});
		}
	});
});
api.all('/url/redirect', function (req, res) {
	var hash = req.query.hash || (req.query.from || '').replace(/^\/+|\/+$/g, '');
	
	if (hash) {
		getUrl(hash).then(function (url) {
			res.redirect(url);
		}).catch(function (err) {
			res.json({
				success: false,
				error:   err,
			});
		});
	} else {
		res.redirect(BASE_URL);
	}
});
*/



// calendars
function createCal(options) {
	return ical(_.extend({
		domain:   DOMAIN,
		timezone: TIMEZONE,
		name:     NAME,
		prodId:   {
			company: NAME,
			product: DOMAIN,
		},
	}, options || {}));
}
function getEventParticipantStatus(event, participantId) {
	var status = undefined;
	if (event && event.rsvps && event.rsvps[participantId]) {
		switch(event.rsvps[participantId].status) {
			case 1:  status = 'accepted'; break;
			case 0:  status = 'declined'; break;
			case -1: status = 'tentative'; break;
		}
	}
	return status;
}
function getRosterCalendar(rosterId) {
	var deferred = Q.defer();
	if (rosterId) {
		new Firebase(FB_BASE_URL + '/data/rosters/' + rosterId).once('value', function (rosterSnap) {
			var rosterId = rosterSnap.key(),
				roster   = rosterSnap.val(),
				cal      = createCal({
					name: roster.name,
				});
			
			new Firebase(FB_BASE_URL + '/data/users').once('value', function (usersSnap) {
				var users = usersSnap.val();
				
				new Firebase(FB_BASE_URL + '/data/invites').once('value', function (invitesSnap) {
					var invites = invitesSnap.val();
				
					new Firebase(FB_BASE_URL + '/data/rosterEvents/' + rosterId).once('value', function (eventsSnap) {
						var events = eventsSnap.val();
						
						_.each(events, function (event, eventId) {
							// populate event info
							var calEvent = cal.createEvent({
								id:          eventId,
								summary:     event.name,
								description: event.notes,
								start:       moment(event.date).toDate(),
								end:         moment(event.date).add(1, 'hours').toDate(),
								location:    event.location,
								url:         BASE_URL + '/roster/' + rosterId + '/' + eventId,
								//status:      event.status,
							});
							
							// add attendees
							if (users) {
								_.each(roster.participants, function (participantId) {
									var user = users[participantId];
									if (user) {
										calEvent.createAttendee({
											name:   user.name,
											email:  user.email,
											status: getEventParticipantStatus(event, participantId),
										});
									}
								});
							}
							if (invites) {
								_.each(roster.invites, function (inviteId) {
									var invite = invites[inviteId];
									if (invite) {
										calEvent.createAttendee({
											name:  invite.name,
											email: invite.email,
										});
									}
								});
							}
						});
						
						deferred.resolve(cal);
					});
				});
			});
		});
	} else {
		deferred.reject(new Error('Roster not specified'));
	}
	return deferred.promise;
}
api.get('/calendar/roster', function (req, res) {
	getRosterCalendar(req.query.rosterId).then(function (cal) {
		cal.serve(res);
	}).catch(function (err) {
		res.json({
			success: false,
			error:   err,
		});
	});
});