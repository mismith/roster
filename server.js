#!/bin/env node

var express  = require('express'),
	app      = express(),
	postmark = require('postmark'),
	client   = new postmark.Client('75cdd97a-2c40-4319-a6a9-4576d0948d57');

app.post('/api/v1/notify/email', function (req, res) {
	
	
	client.sendEmail({
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

app.listen(process.env.PORT || 3030);