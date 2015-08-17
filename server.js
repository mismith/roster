#!/bin/env node

var BASE_URL      = 'http://www.roster-io.com',
	FB_BASE_URL   = 'https://roster-io.firebaseio.com',
	FB_AUTH_TOKEN = 'xwYj28J4UELF5WgifokLbqjN71mFE9Y4cBwykmyI',
	EMAIL         = 'support@roster-io.com';

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
	CronJob   = require('cron').CronJob;

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

// server
server.use(express.static('html'));
server.all('/*', function(req, res){
  res.sendfile(__dirname + '/html/index.html');
});
server.listen(process.env.OPENSHIFT_NODEJS_PORT || 3030, process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1');

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



function getReminderInfo(rosterId, eventId) {
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
function getReminderEmailTemplate(rosterId, eventId) {
	var deferred = Q.defer();
	
	getCompiledTemplate('reminder', function (template) {
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
	});
	
	return deferred.promise;
}
function sendReminderEmails(rosterId, eventId, callback) {
	// @TODO double check all the error handling in here
	var deferred = Q.defer();
	
	getReminderEmailTemplate(rosterId, eventId).then(function (template) {
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
	getReminderEmailTemplate(req.query.rosterId, req.query.eventId).then(function (template) {
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
	sendReminderEmails(req.query.rosterId, req.query.eventId).then(function (response) {
		res.json(response);
	}).catch(function (err) {
		res.json({
			success: false,
			error:   err,
		});
	});
});




function dispatchReminders(rosterId) {
	new Firebase(FB_BASE_URL + '/data/rosters/' + rosterId + '/events').once('value', function (eventsSnap) {
		var events = eventsSnap.val();
		
		_.each(events, function (event, eventId) {
			// check if date matches a range that needs sending reminders for
			var now  = moment(),
				date = moment(event.date),
				diff = date.diff(now, 'day');
			if (0 <= diff && diff < 7) {
				// send individual emails (to specific users based on logic within sentReminderEmails)
				sendReminderEmails(rosterId, eventId).then(function (response) {
					console.log('Event ' + eventId + ':\n', response); // @TODO: handle errors
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
				}, undefined, true, 'America/Edmonton');
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
function sendInviteEmail(inviteId) {
	var deferred = Q.defer();
	
	getInviteEmail(inviteId).then(function (email) {
		// send email
		return sendEmail({
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
server.get('/api/v1/email/invite', function (req, res) {
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
server.post('/api/v1/email/invite', function (req, res) {
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
function sendAddedEmail(rosterId, inviteeId, inviterId) {
	var deferred = Q.defer();
	
	getAddedEmail(rosterId, inviteeId, inviterId).then(function (email) {
		// send email
		return sendEmail({
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
server.get('/api/v1/email/added', function (req, res) {
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
server.post('/api/v1/email/added', function (req, res) {
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


var emailQueueRef = new Firebase(FB_BASE_URL + '/email/queue');
emailQueueRef.authWithCustomToken(FB_AUTH_TOKEN, function(err, authData) {
	if (err) return console.error(err);
	
	emailQueueRef.on('child_added', function (emailSnap) {
		var email = emailSnap.val();
		if (email) {
			var promise;
			
			switch (email.template) {
				case 'added':
					promise = sendAddedEmail(email.data.rosterId, email.data.inviteeId, email.data.inviterId);
					break;
				case 'invite':
					promise = sendInviteEmail(email.data.inviteId).then(function () {
						new Firebase(FB_BASE_URL + '/data/invites/' + email.data.inviteId).update({sent: moment().format()});
					});
					break;
			}
			
			if (promise) {
				promise.then(function () {
					emailSnap.ref().remove();
				}).catch(function (err) {
					email.error   = err;
					email.errorAt = moment().format();
					emailSnap.ref().update(email);
				});
			}
		}
	});
});


// url shortening
function generateHash(n) {
	var alphabet = 'UteQA9bjVXygpBE2vchDdnKrk7xMFHGa3RmCf6uZws4Tl8zqNWYPJ',
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
server.get('/api/v1/url/unshorten', function (req, res) {
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
server.post('/api/v1/url/shorten', function (req, res) {
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
server.all('/api/v1/url/redirect', function (req, res) {
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