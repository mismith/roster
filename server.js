#!/bin/env node

var express  = require('express'),
	server   = express(),
	Postmark = require('postmark'),
	postmark = new Postmark.Client('75cdd97a-2c40-4319-a6a9-4576d0948d57');

// web app
server.use(express.static('html'));
server.get('/', express.static('html/index.html'));

// api
server.post('/api/v1/notify/email', function (req, res) {
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

server.listen(process.env.PORT || 3030);