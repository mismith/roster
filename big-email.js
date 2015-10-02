#!/bin/env node

(function() {
'use strict';

var Q = require('q'),
	_ = require('lodash');
		
module.exports = function (postmarkToken, options) {
	var postmark = new require('postmark').Client(postmarkToken);
	options = _.extend({
		templatePath: 'html/emails/',
		juice: {
			webResources: {
				relativeTo: 'html/',
				images: false,
			},
		},
	}, options || {});
	
	return {
		getCompiledTemplate: function getCompiledTemplate(templateId, ejsOptions) {
			var deferred = Q.defer();
			
			ejsOptions = _.extend(options.ejs || {}, ejsOptions || {});
			
			// read template
			require('fs').readFile(options.templatePath.replace(/\/*$/, '/') + templateId + '.html', function (err, file) {
				if (err) return deferred.reject(err);
				
				// compile it
				var compiled = require('ejs').compile(file.toString(), ejsOptions);
				
				// return it
				deferred.resolve(compiled);
			});
			
			return deferred.promise;
		},
		getJuicedEmail: function getJuicedEmail(template, data, juiceOptions) {
			var deferred = Q.defer();
			
			// render email
			var html = template(data);
			
			juiceOptions = _.extend(options.juice || {}, juiceOptions || {});
			
			// juice email
			require('juice').juiceResources(html, juiceOptions, function (err, juiced) {
				if (err) return deferred.reject(err);
				
				deferred.resolve(juiced);
			});
			
			return deferred.promise;
		},
		sendEmail: function sendEmail(postmarkOptions) {
			var deferred = Q.defer();
			
			postmark.sendEmail(postmarkOptions, function (err) {
				if (err) return deferred.reject(err);
				
				deferred.resolve();
			});
			
			return deferred.promise;
		},
		
		firebaseQueue: function firebaseQueue(firebaseRef, firebaseToken) {
			var deferred = Q.defer();
			
			// authenticate first
			firebaseRef.authWithCustomToken(firebaseToken, function(err, authData) {
				if (err) return deferred.reject(err);
				
				deferred.resolve();
			});
			
			return {
				// then return a watcher function
				watch: function watch(callback) {
					deferred.promise.then(function () {
						firebaseRef.on('child_added', function (emailSnap) {
							var email = emailSnap.val();
							if (email) {
								var promise = callback(email);
								
								Q.when(promise).then(function () {
									// remove from queue if successfully handled
									emailSnap.ref().remove();
								}).catch(function (err) {
									// add error details if not
									email.error   = err;
									email.errorAt = moment().format();
									emailSnap.ref().update(email);
								});
							} else {
								// @TODO: could a newly added child ever be empty/null?
							}
						});
					});
				},
			};
		}
	};
};

})();