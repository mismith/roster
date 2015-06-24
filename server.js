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
	Firebase = require('firebase');

// web app
server.use(express.static('html'));
server.get('/', express.static('html/index.html'));

// api
server.post('/api/v1/email', function (req, res) {
	postmark.sendEmail({
		From: 'rsvp@rstr.io',
		To: 'murray@mismith.info',
		Subject: 'Test', 
		TextBody: 'Hello from Postmark!',
		TrackOpens: true,
	}, function (err, data) {
		if (err) {
			res.json({error: err});
			return;
		}
		res.json({success: true});
	});
});
server.get('/api/v1/email/:template', function (req, res) {
	// read template
	fs.readFile('html/emails/' + req.params.template + '.html', function (err, file) {
		if (err) {
			console.error(err);
			return;
		}
		
		// fetch data
		new Firebase(FB_BASE_URL + '/rosters/' + req.query.roster).on('value', function (rosterSnap) {
			var roster  = rosterSnap.val(),
				event   = roster.events[req.query.event],
				subject = 'Reminder: RSVP Required - ' + roster.name + ' - ' + event.name;
			
			// render template
			var template = ejs.compile(file.toString());
			var html = template({
				subject: subject,
				roster:  roster,
				event:   event,
				
				url:     'http://rstr.io/#/roster/' + req.query.roster + '/' + req.query.event,
				query:   req.query,
				moment:  moment,
			});
			
			// juice email
			juice.juiceResources(html, {}, function (err, html2) {
				if (err) {
					console.error(err);
					return;
				}
				
				if (1) {
					// gather recipients
					var to = 'Murray Smith <murray@mismith.info>';
					
					// send email
					postmark.sendEmail({
						From: 'rsvp@rstr.io',
						To: to,
						Subject: subject, 
						HtmlBody: html,
						TrackOpens: true,
					}, function (err, data) {
		/*
						if (err) {
							res.json({error: err});
							return;
						}
						res.json({success: true});
		*/
					});
				}
				
				// return response
				res.type('text/html');
				res.send(html);
			});
			
		});
	});
});

server.listen(process.env.OPENSHIFT_NODEJS_PORT || 3030, process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1');