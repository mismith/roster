#!/bin/env node

var FB_BASE_URL = 'https://roster-io.firebaseio.com';

var fs       = require('fs'),
	express  = require('express'),
	server   = express(),
	Postmark = require('postmark'),
	postmark = new Postmark.Client('75cdd97a-2c40-4319-a6a9-4576d0948d57'),
	ejs      = require('ejs'),
	juice    = require('juice'),
	moment   = require('moment'),
	Firebase = require('firebase'),
	merge    = require('object-merge');

// web app
server.use(express.static('html'));
server.get('/', express.static('html/index.html'));

// api

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
function getEventInfo(rosterId, eventId, callback) {
	// fetch data
	new Firebase(FB_BASE_URL + '/rosters/' + rosterId).on('value', function (snapshot) {
		var roster  = snapshot.val(),         // @TODO: make sure this roster exists
			event   = roster.events[eventId]; // @TODO: make sure this event exists
		
		roster.$id = rosterId;
		roster.url = '#/roster/' + rosterId;
		event.$id  = eventId;
		event.url  = roster.url + '/' + eventId;
		
		callback(roster, event);
	});
}
function getJuicedEmail(template, data, callback) {
	// render email
	var html = template(data);
	
	// juice email
	juice.juiceResources(html, {}, function (err, juiced) {
		if (err) {
			console.error(err);
			return;
		}
		
		callback(juiced);
	});
}

server.get('/api/v1/email/reminder', function (req, res) {
	getCompiledTemplate('reminder', function (template) {
		getEventInfo(req.query.roster, req.query.event, function (roster, event) {
			var subject = 'Reminder: RSVP Required - ' + roster.name + ' - ' + event.name,
				data = {
					subject:  subject,
					roster:   roster,
					event:    event,
					
					// helpers
					moment:   moment,
				};
			
			getJuicedEmail(template, data, function (html) {
				// display email
				res.type('text/html');
				res.send(html);
			});
		});
	});
});
server.post('/api/v1/email/reminder', function (req, res) {
	getCompiledTemplate('reminder', function (template) {
		getEventInfo(req.query.roster, req.query.event, function (roster, event) {
			var subject = 'Reminder: RSVP Required - ' + roster.name + ' - ' + event.name,
				data = {
					subject:  subject,
					roster:   roster,
					event:    event,
					
					// helpers
					moment:   moment,
				},
				response = {success: true};
			
			Object.keys(roster.participants).forEach(function (userId) {
				var user = merge(roster.participants[userId]); // @TODO / @FIX: get real user
				
				if (user.email && ( ! event.rsvps || ! event.rsvps[userId] || event.rsvps[userId].status < 0)) {
					console.log(user, data);
					var userData = merge(data, {user: user});
					
					getJuicedEmail(template, userData, function (html) {
						// send email
						postmark.sendEmail({
							From:       'rsvp@rstr.io',
							To:         user.name + ' <' + user.email + '>',
							Subject:    subject, 
							HtmlBody:   html,
							TrackOpens: true,
						}, function (err) {
							if (err) {
								response.failed.push({data: user, error: err});
								response.success = false;
								return;
							}
							response.sent.push({data: user});
						});
					});
					
				}
			});
			
			res.json({success: true});
		});
	});
});

server.listen(process.env.OPENSHIFT_NODEJS_PORT || 3030, process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1');