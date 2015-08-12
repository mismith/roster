#!/bin/env node

var FB_BASE_URL = 'https://roster-io.firebaseio.com',
	EMAIL       = 'support@roster-io.com';

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
server.use(express.static('html'));
server.get('/', express.static('html/index.html'));

// api
/*
function authed(req, res, next) {
	if (req.headers.authorization) {
		next();
	} else {
		res.send(403);
	}
}
*/

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
function sendEmail(options) {
	var deferred = Q.defer();
	
	postmark.sendEmail(options, function (err) {
		if (err){
			deferred.reject(err);
		} else {
			deferred.resolve();
		}
	});
	
	return deferred.promise;
}



function getEventReminderInfo(rosterId, eventId) {
	var deferred = Q.defer();
	
	// fetch data
	if (rosterId) {
		new Firebase(FB_BASE_URL + '/data/rosters/' + rosterId).once('value', function (snapshot) {
			var roster  = snapshot.val();
			if (roster) {
				roster.$id = rosterId;
				roster.url = '#/roster/' + roster.$id;
				
				if (eventId) {
					var event = roster.events[eventId];
					
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
function getEventReminderEmailTemplate(rosterId, eventId) {
	var deferred = Q.defer();
	
	getCompiledTemplate('reminder', function (template) {
		getEventReminderInfo(rosterId, eventId).then(function (info) {
			info.subject = 'Reminder: RSVP Required - ' + info.roster.name + ' - ' + info.event.name;
			info.moment  = moment;
			
			deferred.resolve({
				html: template,
				info: info,
			});
		}).catch(function (err) {
			deferred.reject(err);
		});
	});
	
	return deferred.promise;
}
function sendEventReminderEmails(rosterId, eventId, callback) {
	// @TODO double check all the error handling in here
	var deferred = Q.defer();
	
	getEventReminderEmailTemplate(rosterId, eventId).then(function (template) {
		var response = {success: true, sent: [], skipped: [], failed: []};
		
		var deferreds = [];
		Object.keys(template.info.roster.participants).forEach(function (userId) {
			var d = Q.defer();
			deferreds.push(d.promise);
			(function (d) {
				new Firebase(FB_BASE_URL + '/data/users/' + userId).once('value', function (userSnap) {
					var user = userSnap.val();
					if (user.email && ( ! template.info.event.rsvps || ! template.info.event.rsvps[userId] || template.info.event.rsvps[userId].status < 0)) {
						// clone the data for each user so we don't mess anything up
						var userInfo = extend({}, template.info, {user: user});
						
						getJuicedEmail(template.html, userInfo, function (html) {
							// send email
							sendEmail({
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
						});
					} else {
						response.skipped.push({userId: userId});
						d.resolve();
					}
				});
			})(d);
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
server.get('/api/v1/email/reminder', function (req, res) {
	getEventReminderEmailTemplate(req.query.roster, req.query.event).then(function (template) {
		getJuicedEmail(template.html, template.info, function (html) {
			// display email
			res.send(html);
		});
	}).catch(function (err) {
		res.json({
			success: false,
			error: err,
		});
	});
});
server.post('/api/v1/email/reminder', function (req, res) {
	sendEventReminderEmails(req.query.roster, req.query.event).then(function (response) {
		res.json(response);
	}).catch(function (err) {
		res.json({
			success: false,
			error:   err,
		});
	});
});


function dispatchEventReminders() {
	new Firebase(FB_BASE_URL + '/data/rosters').once('value', function (rostersSnap) {
		_.each(rostersSnap.val(), function (roster, rosterId) {
			_.each(roster.events, function (event, eventId) {
				// check if date matches a range that needs sending reminders for
				var now  = moment(),
					date = moment(event.date);
				if (now.isBefore(date), now.isSame(date, 'week')) {
					// send individual emails (to specific users based on logic within sentReminderEmails)
					sendEventReminderEmails(rosterId, eventId).then(function (response) {
						console.log(response); // @TODO: handle errors
					}).catch(function (err) {
						console.error(err); // @TODO
					});
				}
			});
		});
	});
}
scheduler.scheduleJob('0 0 17 * * 1' /* every Monday at 5pm */, dispatchEventReminders);
server.post('/api/v1/dispatch/reminders', function (req, res) {
	dispatchEventReminders();
});



function getInviteInfo(inviteId) {
	var deferred = Q.defer();
	
	// fetch data
	if (inviteId) {
		new Firebase(FB_BASE_URL + '/data/invites/' + inviteId).once('value', function (inviteSnap) {
			var invite = inviteSnap.val();
			if (invite) {
				invite.$id = inviteId;
				invite.url = '#/invite/' + invite.$id;
				
				new Firebase(FB_BASE_URL + '/data/users/' + invite.by).once('value', function (inviterSnap) {
					var inviter = inviterSnap.val();
					inviter.$id = inviterSnap.key();
		
					new Firebase(FB_BASE_URL + '/data/rosters/' + invite.to.params.roster).once('value', function (rosterSnap) {
						var roster = rosterSnap.val();
						roster.$id = rosterSnap.key();
						roster.url = '#/roster/' + roster.$id;
						
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
	
	getCompiledTemplate('invite', function (template) {
		getInviteInfo(inviteId).then(function (info) {
			info.inviter.avatar = 'http://graph.facebook.com/' + (info.inviter.facebook && info.inviter.facebook.id ? info.inviter.facebook.id + '/' : '') + 'picture?type=square';
			info.subject = 'Invitation: Join ' + info.inviter.name + ' on the "' + info.roster.name + '" roster';
				
			getJuicedEmail(template, info, function (html) {
				deferred.resolve({
					html: html,
					info: info,
				});
			});
		}).catch(function (err) {
			deferred.reject(err);
		});
	});
	
	return deferred.promise;
}
server.get('/api/v1/email/invite', function (req, res) {
	getInviteEmail(req.query.invite).then(function (email) {
		// return email as html
		res.send(email.html);
	}).catch(function (err) {
		res.json({
			success: false,
			error: err,
		});
	});
});
server.post('/api/v1/email/invite', function (req, res) {
	getInviteEmail(req.query.invite).then(function (email) {
		// send email
		return sendEmail({
			From:       EMAIL,
			To:         email.info.invite.name ? email.info.invite.name + ' <' + email.info.invite.email + '>' : email.info.invite.email,
			Subject:    email.info.subject,
			HtmlBody:   email.html,
			TrackOpens: true,
		}).then(function () {
			res.json({success: true});
		});
	}).catch(function (err) {
		res.json({
			success: false,
			error:   err,
		});
	});
});



function getAddedInfo(rosterId, inviteeId, inviterId) {
	var deferred = Q.defer();
	
	// fetch data
	if (rosterId) {
		new Firebase(FB_BASE_URL + '/data/rosters/' + rosterId).once('value', function (rosterSnap) {
			var roster = rosterSnap.val();
			if (roster) {
				roster.$id = rosterId;
				roster.url = '#/roster/' + roster.$id;
				
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
										inviter.avatar = 'http://graph.facebook.com/' + (inviter.facebook && inviter.facebook.id ? inviter.facebook.id + '/' : '') + 'picture?type=square';
										
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
	
	getCompiledTemplate('added', function (template) {
		getAddedInfo(rosterId, inviteeId, inviterId).then(function (info) {
			info.subject = info.inviter.name + ' added you to the "' + info.roster.name + '" roster';
				
			getJuicedEmail(template, info, function (html) {
				deferred.resolve({
					html: html,
					info: info,
				});
			});
		}).catch(function (err) {
			deferred.reject(err);
		});
	});
	
	return deferred.promise;
}
server.get('/api/v1/email/added', function (req, res) {
	getAddedEmail(req.query.roster, req.query.invitee, req.query.inviter).then(function (email) {
		// return email as html
		res.send(email.html);
	}).catch(function (err) {
		res.json({
			success: false,
			error: err,
		});
	});
});
server.post('/api/v1/email/added', function (req, res) {
	getAddedEmail(req.query.roster, req.query.invitee, req.query.inviter).then(function (email) {
		// send email
		return sendEmail({
			From:       EMAIL,
			To:         email.info.invitee.name ? email.info.invitee.name + ' <' + email.info.invitee.email + '>' : email.info.invitee.email,
			Subject:    email.info.subject,
			HtmlBody:   email.html,
			TrackOpens: true,
		}).then(function () {
			res.json({success: true});
		});
	}).catch(function (err) {
		res.json({
			success: false,
			error:   err,
		});
	});
});



/*
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
*/

server.listen(process.env.OPENSHIFT_NODEJS_PORT || 3030, process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1');