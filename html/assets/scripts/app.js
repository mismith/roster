window.STRICT_INVITE_CHECK = false;

angular.module('roster-io', ['ui.router', 'ui.router.title', 'ngMaterial', 'firebaseHelper', 'ngTouch'])
	
	.config(function ($locationProvider, $urlRouterProvider, $urlMatcherFactoryProvider, $stateProvider, $firebaseHelperProvider, $sceProvider, $compileProvider) {
		// routing
		$locationProvider.html5Mode(true).hashPrefix('!');
		$urlRouterProvider.when('', '/');
		$urlMatcherFactoryProvider.strictMode(false); // make trailing slashes optional
		
		$stateProvider
			// pages
			.state('home', {
				url: '/',
				templateUrl: 'views/page/home.html',
				resolve: {
					authed: function (Auth, $state) {
						return Auth.$waitForMe().then(function ($me) {
							if ($me.$id) $state.go('user', {user: $me.$id});
						});
					},
				},
			})
			.state('roster', {
				url: '/roster/:roster',
				templateUrl: 'views/page/roster.html',
				controller: 'RosterCtrl',
				resolve: {
					Roster: function ($firebaseHelper, $stateParams, $state) {
						return $firebaseHelper.object('data/rosters', $stateParams.roster).$loaded(function ($roster) {
							if ($roster.$value === null) return $state.go('404', {model: 'roster'}, {location: false});
							return $roster;
						});
					},
					$title: function (Roster) {
						return Roster.name;
					},
				},
			})
			.state('event', {
				url: '/roster/:roster/:event?v&edit',
				templateUrl: 'views/page/event.html',
				controller: 'EventCtrl',
				resolve: {
					Roster: function ($firebaseHelper, $stateParams, $state) {
						return $firebaseHelper.object('data/rosters', $stateParams.roster).$loaded(function ($roster) {
							if ($roster.$value === null) return $state.go('404', {model: 'roster'}, {location: false});
							return $roster;
						});
					},
					Event: function ($firebaseHelper, $stateParams, $state, Roster) {
						return $firebaseHelper.object('data/rosterEvents', Roster.$id, $stateParams.event).$loaded(function ($event) {
							if ($event.$value === null) return $state.go('404', {model: 'event'}, {location: false});
							return $event;
						});
					},
					$title: function (Roster, Event) {
						return Event.name + ' • ' + Roster.name;
					},
				},
			})
			.state('invite', {
				url: '/invite/:invite',
				templateUrl: 'views/page/invite.html',
				controller: 'InviteCtrl',
				resolve: {
					Invite: function ($firebaseHelper, $stateParams, $state) {
						return $firebaseHelper.object('data/invites', $stateParams.invite).$loaded(function ($invite) {
							if ($invite.$value === null) return $state.go('404', {model: 'invite'}, {location: false});
							return $invite;
						});
					},
					Inviter: function ($firebaseHelper, $stateParams, Invite) {
						return $firebaseHelper.object('data/users', Invite.inviterId).$loaded();
					},
					Roster: function ($firebaseHelper, $stateParams, Invite) {
						return $firebaseHelper.object('data/rosters', Invite.rosterId).$loaded();
					},
					$title: function () {
						return 'Invitation';
					},
				},
			})
			.state('user', {
				url: '/user/:user',
				templateUrl: 'views/page/user.html',
				controller: 'UserCtrl',
				resolve: {
					User: function ($firebaseHelper, $stateParams, $state) {
						return $firebaseHelper.object('data/users', $stateParams.user).$loaded(function ($user) {
							if ($user.$value === null) return $state.go('404', {model: 'user'}, {location: false});
							return $user;
						});
					},
					$title: function (User) {
						return User.name;
					},
				},
			})
		// fallbacks
			.state('404', {
				templateUrl: 'views/page/404.html',
				params: {model: 'page'},
				controller: function ($scope, $stateParams) {
					$scope.model = $stateParams.model;
				},
			});
		$urlRouterProvider.otherwise(function ($injector, $location) {
			var $state = $injector.get('$state');
			$state.go('404', null, {location: false});
			return $location.path();
		});
		
		// data
		$firebaseHelperProvider.namespace('roster-io');
		
		// security
		$sceProvider.enabled(false);
		$compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|ftp|mailto|tel|webcal|fb\-messenger|(comgoogle)?maps(url)?):/);
	})
	
	.factory('Auth', function ($rootScope, $firebaseHelper, $state, $q, $timeout) {
		var Auth = $firebaseHelper.auth();
		
		$rootScope.$me = {};
		Auth.$onAuth(function (authData) {
			if (authData) {
				// logging in
				var meRef      = $firebaseHelper.ref('data/users/' + authData.uid);
				$rootScope.$me = $firebaseHelper.object(meRef);
				
				// presence
				$firebaseHelper.ref('.info/connected').on('value', function (snap) {
					if (snap.val()) {
						meRef.child('online').onDisconnect().set(moment().format());
						meRef.child('online').set(true);
					}
				});
				
				// info
				if (authData.facebook) {
					$rootScope.$me.$loaded(function ($me) { // autofill details from facebook if necessary/possible
						$me.facebookId = $me.facebookId || authData.facebook.id;
						$me.name       = $me.name       || authData.facebook.displayName;
						$me.email      = $me.email      || authData.facebook.email;
						$me.gender     = $me.gender     || authData.facebook.cachedUserProfile ? authData.facebook.cachedUserProfile.gender : null;
						$me.$save();
					});
				}
				
				// don't show login screen
				if ($state.current.name === 'home') {
					$state.reload();
				}
			} else {
				// page loaded or refreshed while not logged in, or logging out
				$rootScope.$me = {};
			}
		});
		Auth.$waitForMe = function () {
			var deferred = $q.defer();
			
			Auth.$waitForAuth().then(function (authData) {
				$timeout(function () {
					deferred.resolve($rootScope.$me);
				});
			});
			
			return deferred.promise;
		};
		
		$rootScope.$auth = Auth.$auth = function () {
			return $q.when(Auth.$getAuth() || Auth['$authWithOAuth' + ($rootScope.isMobile ? 'Redirect' : 'Popup')]('facebook', {scope: 'email'}));
		};
		$rootScope.$unauth = Auth.$unauth;
		
		return Auth;
	})
	.controller('AppCtrl', function ($rootScope, $state, $firebaseHelper, Auth) {
		$rootScope.loaded          = true;
		$rootScope.$state          = $state;
		$rootScope.$firebaseHelper = $firebaseHelper;
		$rootScope.console         = console;
		$rootScope.history         = history;
		$rootScope.BASE_SHORT_URL  = 'http://www.roster-io.com/';
		
		// state
		$rootScope.$on('$stateChangeSuccess', function(e, toState, toParams, fromState, fromParams){
			// highlight previous state for user convenience/orientation
			$state.$previous        = fromState;
			$state.$previous.params = fromParams;
		});
		
		// hacky browser detection
		$rootScope.isMobile  = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
		$rootScope.isAndroid = /Android/i.test(navigator.userAgent);
		$rootScope.isiOS     = /iPhone|iPad|iPod/i.test(navigator.userAgent);
		
		// auth
		Auth.$onAuth(function (authData) {
			$rootScope.myRosters = authData ? $firebaseHelper.join([$rootScope.$me, 'rosters'], 'data/rosters') : null;
		});
		$rootScope.canEdit = function () {
			// returns false if not logged in
			// returns true if any of the following:
			// - object/array(s) specified and currently logged in user id is in it(them)
			// - string(s) specified and it(they) match the currently logged in user id
			// - nothing is specified but the currently logged in user is an admin
			var args = Array.prototype.slice.call(arguments);
			return !! args.filter(function (test) {
				if (angular.isArray(test) && test.indexOf($rootScope.$me.$id) >= 0) return true;
				else if (angular.isObject(test) && test[$rootScope.$me.$id]) return true;
				else return test ? test === $rootScope.$me.$id : false;
			}).length || $rootScope.$me.admin;
		};
		
		// helpers
		$rootScope.avatar = function (user, query) {
			query = query || 'type=square';
			
			var userId = user ? user.facebookId : false;
			
			return '//graph.facebook.com/' + (userId ? userId + '/' : '') + 'picture?' + query;
		};
		$rootScope.mapsUrl = function (event) {
			var protocol = $rootScope.isiOS ? 'comgooglemapsurl' : ($rootScope.isMobile ? 'maps' : 'http'),
				url      = '';
			if (event.locationUrl) {
				url = event.locationUrl.replace(/^https?:\/\//, '');
			} else if (event.location) {
				url = 'maps.google.com/?q=' + encodeURIComponent(event.location.replace('\n', ' '));
			}
			
			return protocol + '://' + url;
		};
	})
	
	
	
	
	.controller('RosterCtrl', function ($scope, $rootScope, $firebaseHelper, $mdDialogForm, $state, $mdToast, $q, RSVP, $http, Roster) {
		$scope.roster       = Roster;
		$scope.timegroups   = $firebaseHelper.array('constants/timegroups'); // constant
		$scope.events       = $firebaseHelper.array('data', 'rosterEvents', Roster.$id);
		$scope.participants = $firebaseHelper.join([Roster, 'participants'], 'data/users');
		$scope.invites      = $firebaseHelper.join([Roster, 'invites'], 'data/invites');
		$scope.users        = $firebaseHelper.array('data/users');
		$scope.RSVP         = RSVP;		
		
		// roster
		$scope.deleteRoster = function (skipConfirm) {
			if (skipConfirm || confirm('Are you sure you want to permanently delete this roster?')) {
				// remove roster from all participants and admins rosters
				var deferreds  = [],
					rosterId   = Roster.$id,
					removeLink = function (uid) {
						deferreds.push($firebaseHelper.object('data/users', uid, 'rosters', rosterId).$remove());
					};
				angular.forEach(Roster.admins,       removeLink);
				angular.forEach(Roster.participants, removeLink);
				
				// delete the roster itself
				deferreds.push(Roster.$remove());
				
				// wait for all promises to complete the redirect and notify user
				$q.all(deferreds).then(function () {
					$state.go('home');
					
					$mdToast.showSimple('Roster deleted.');
				});
			}
		};
		$scope.editRoster = function () {
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Edit roster',
				contentUrl:    'views/template/roster.html',
				ok:            'Save',
				onSubmit: function () {
					return Roster.$save().then(function () {
						$mdToast.showSimple('Roster saved.');
					});
				},
			});
		};
		$scope.newEvent = function () {
			$scope.event = {};
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Add new event',
				contentUrl:    'views/template/event.html',
				ok:            'Create',
				onSubmit: function (scope) {
					scope.event.date = moment(scope.event.$date).format();
					
					return $scope.events.$add(scope.event).then(function () {
						$mdToast.showSimple('Event created.');
					});
				},
			});
		};
		
		// participants
		$scope.removeUser = function (skipConfirm, participant, participants) {
			participants = participants || $scope.participants;
			
			if (skipConfirm || confirm('Are you sure you want to remove this user from this roster?')) {
				var name = participant.name;
				$q.all([
					participants.$unlink(participant), // remove roster's particpants link
					$firebaseHelper.object('data/users', participant.$id, 'rosters', Roster.$id).$remove(), // remove user's rosters link
				]).then(function () {
					$mdToast.showSimple('"' + name + '" removed.');
				});
			}
		};
		
		// invites
		var sendInviteEmail = function (inviteId) {
			var deferred  = $q.defer(),
				inviteRef = $firebaseHelper.ref('data/invites', inviteId);
				
			inviteRef.once('value', function (inviteSnap) {
				var invite = inviteSnap.val();
				
				$firebaseHelper.array('queues/email').$add({template: 'invite', data: {inviteId: inviteId}}).then(function () {
					// add to roster's invites list
					$firebaseHelper.object(Roster, 'invites').$loaded().then(function ($invites) {
						$invites[inviteId] = inviteId;
						$invites.$save().then(function () {
							deferred.resolve();
							
							// alert user
							$mdToast.showSimple('Invitation email sent to "' + (invite.name ? invite.name + ' ' : '') + '<' + invite.email + '>".');
						}).catch(function (err) {
							deferred.reject(err);
						});
					}).catch(function (err) {
						deferred.reject(err);
					});
				}).catch(function (err) {
					deferred.reject(err);
					
					$mdToast.showSimple('Error ' + err.code + ': ' + err.message + '.');
				});
			});
			return deferred.promise;
		};
		$scope.inviteUser = function () {
			$scope.invite = {
				inviterId: $scope.$me.$id,
				rosterId:  Roster.$id,
			};
			$scope.loadExistingUser = function (user) {
				user = user || {};
				
				$scope.invite.name  = user.name;
				$scope.invite.email = user.email;
			};
			$scope.importGoogleContacts = function () {
				$scope.contacts = [];
				gapi.auth.authorize({
					client_id: '413081268225-vj2fi4to1uhlv6h7acdsn0l6kifjep21.apps.googleusercontent.com',
					scope: 'https://www.googleapis.com/auth/contacts.readonly',
					immediate: true,
				}, function (authResponse) {
					$http.get('https://www.google.com/m8/feeds/contacts/default/full?alt=json&max-results=9999999', {params: gapi.auth.getToken()}).then(function (response) {
						if (response && response.data && response.data.feed && response.data.feed.entry) {
							angular.forEach(response.data.feed.entry, function (contact) {
								console.log(contact);
								angular.forEach(contact.gd$email, function (email) {
									if (contact.title.$t) {
										$scope.contacts.push({
											name:  contact.title.$t,
											email: email.address,
										});
									}
								});
							});
						}
					});
				});
			};
			
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Invite user',
				contentUrl:    'views/template/invite.html',
				ok:            'Invite',
				onSubmit: function (scope) {
					var deferred      = $q.defer(),
						alreadyExists = false;
					
					// add existing user, if found, and skip invitation process
					angular.forEach($scope.users, function (user) {
						if (user.email === $scope.invite.email) {
							alreadyExists = true;
							$q.all([
								$firebaseHelper.join(['data/users', user.$id, 'rosters'], 'data/rosters').$link(Roster.$id),
								$firebaseHelper.join(['data/rosters', Roster.$id, 'participants'], 'data/users').$link(user.$id),
								$firebaseHelper.array('queues/email').$add({template: 'added', data: {rosterId: Roster.$id, inviteeId: user.$id, inviterId: $scope.$me.$id}}),
							]).then(function () {
								deferred.resolve();
								
								$mdToast.showSimple('"' + user.name + '" added.');
							}).catch(function (err) {
								deferred.reject(err);
							});
						}
					});
					
					if ( ! alreadyExists) {
						// Title Case in case of illiterate users
						$scope.invite.name = ($scope.invite.name || '').replace(/\b\w+/g, function (text) {
							return text.charAt(0).toUpperCase() + text.substr(1);
						});
						
						// create invite
						$firebaseHelper.array('data/invites').$add($scope.invite).then(function (inviteRef) {
							// send email
							sendInviteEmail(inviteRef.key()).then(function () {
								deferred.resolve();
							}).catch(function (err) {
								deferred.reject(err);
							});
						}).catch(function (err) {
							deferred.reject(err);
						});
					}
					
					return deferred.promise;
				},
			});
		};
		$scope.resendInvite = function (skipConfirm, inviteId) {
			if (skipConfirm || confirm('Are you sure you want to resend this user\'s invite?')) {
				sendInviteEmail(inviteId);
			}
		};
		$scope.rescindInvite = function (skipConfirm, participant, invites) {
			invites = invites || $scope.invites;
			
			if (skipConfirm || confirm('Are you sure you want to rescind this user\'s invite?')) {
				var name = participant.name || participant.email;
				invites.$remove(participant).then(function () {
					$mdToast.showSimple('Invite for "' + name + '" rescinded.');
				});
			}
		};
		
		// admins
		$scope.isAdmin = function (participantId) {
			return Roster && angular.isObject(Roster.admins) && Roster.admins[participantId];
		};
		$scope.toggleAdmin = function (skipConfirm, participant) {
			var isAdmin = $scope.isAdmin(participant.$id);
			if (skipConfirm || confirm('Are you sure you want to ' + (isAdmin ? 'demote this' : 'promote this participant to') + ' roster admin?')) {
				Roster.admins = Roster.admins || {};
				if ( ! isAdmin || (isAdmin && Object.keys(Roster.admins).length > 1)) {
					// other admins remain, so it's safe to demote this user
					isAdmin = Roster.admins[participant.$id] = Roster.admins[participant.$id] ? null : participant.$id;
					return Roster.$save().then(function (){
						$mdToast.showSimple('"' + participant.name + '" is ' + (isAdmin ? 'now' : 'no longer') + ' a roster admin.');
					});
				} else {
					// no other admins remain, so you cannot demote yourself
					$mdToast.showSimple('Sorry, you can\'t demote yourself since you are the only admin for this roster.');
				}
			}
		};
	})
		
	.controller('EventCtrl', function ($scope, $firebaseHelper, $mdDialogForm, $state, $mdToast, Auth, RSVP, $location, API, $stateParams, Roster, Event) {
		$scope.roster = Roster;
		$scope.event  = Event;
		
		if ($state.params.v !== undefined) {
			Auth.$onAuth(function (authData) {
				if(authData){
					RSVP($scope.event).setParticipantStatus(authData.uid, $state.params.v).then(function () {
						// remove query string so we don't accidentally re-rsvp
						$location.url($location.path());
					});
				}
			});
		}
		
		$scope.statuses     = $firebaseHelper.array('constants/statuses'); // constant
		$scope.participants = $firebaseHelper.join([Roster, 'participants'], 'data/users');
		$scope.RSVP         = RSVP;
		
		// helpers
		$scope.urlencode = window.encodeURIComponent;
		
/*
		// sharing
		var sharePrompt = function () {
			prompt('Copy and paste this URL:', $scope.BASE_SHORT_URL + $scope.event.hash);
		};
		$scope.shareEvent = function () {
			if ($scope.event.hash) {
				sharePrompt();
			} else {
				API.post('/url/shorten', {params: {path: '/' + $state.href('event', $stateParams)}}).then(function (data) {
					if (data && data.hash) {
						$scope.event.hash = data.hash;
						$scope.event.$save().then(sharePrompt);
					}
				});
			}
		};
*/
		
		// event
		$scope.deleteEvent = function (skipConfirm) {
			if (skipConfirm || confirm('Are you sure you want to permanently delete this event?')) {
				$scope.event.$remove().then(function () {
					$state.go('roster', {roster: Roster.$id});
					
					$mdToast.showSimple('Event deleted.');
				});
			}
		};
		$scope.editEvent = function () {
			$scope.event.$date = moment($scope.event.date).toDate();
			
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Edit event',
				contentUrl:    'views/template/event.html',
				ok:            'Save',
				onSubmit: function (scope) {
					scope.event.date = moment(scope.event.$date).format();
					
					return $scope.event.$save().then(function () {
						$mdToast.showSimple('Event saved.');
					});
				},
			});
		};
		if ($state.params.edit) $scope.editEvent();
		$scope.duplicateEvent = function () {
			var event = {};
			angular.forEach($scope.event, function (v, k) {
				switch (k) {
					case 'rsvps':
					case 'hash':
						// @IGNORE
						break;
					default:
						event[k] = v;
						break;
				}
			});
			return $firebaseHelper.array('data', 'rosterEvents', Roster.$id).$add(event).then(function (eventRef) {
				$state.go('event', {roster: Roster.$id, event: eventRef.key(), edit: 1});
				
				$mdToast.showSimple('Event duplicated.');
			});
		};
	})
	
	.controller('InviteCtrl', function ($scope, $firebaseHelper, $state, $q, Auth, $mdToast, $mdDialog, Invite, Inviter, Roster) {
		$scope.invite  = Invite;
		$scope.inviter = Inviter;
		$scope.roster  = Roster;
		
		$scope.acceptInvite = function () {
			Auth.$auth();
		};
		Auth.$onAuth(function (authData) {
			if (Invite.accepted) {
				// notify user
				$mdToast.showSimple('Invitation already accepted.');
				
				// redirect
				return $state.go('roster', Invite.rosterId);
			}
			if (authData) {
				if( ! $scope.notFound) {
					$scope.$me.$loaded().then(function (me) {
						if ( ! STRICT_INVITE_CHECK || (STRICT_INVITE_CHECK && Invite.email === me.email)) {
							Roster.$loaded().then(function () {
								// update user model
								var rosters = {};
								rosters[Invite.rosterId] = Invite.rosterId;
								$scope.$me.$ref().update({
									email:   Invite.email || me.facebook.email,
									name:    Invite.name || me.facebook.displayName,
									gender:  (me.facebook.cachedUserProfile ? me.facebook.cachedUserProfile.gender : false) || 'male',
									rosters: rosters,
								});
								
								// update roster
								if(Roster.invites) delete Roster.invites[Invite.$id];
								if( ! Roster.participants) Roster.participants = {};
								Roster.participants[me.uid] = me.uid;
								Roster.$save().then(function () {
									// update invite
									Invite.accepted = moment().format();
									Invite.$save().then(function () {
										// notify user
										$mdToast.showSimple('Invitation accepted.');
										
										// redirect
										return $state.go('roster', Invite.rosterId);
									});
								});
							});
						} else {
							// emails don't match
							
							// notify user
							$mdDialog.show($mdDialog.alert({
								content: 'Sorry, your Facebook email (' + me.email + ') does not match the email this invite was sent to (' + Invite.email + ').',
								ok: 'OK',
							}));
						}
					});
				}
			}
		});
	})
	
	.controller('UserCtrl', function ($scope, $firebaseHelper, $state, $mdToast, $mdDialogForm, User, $q) {
		$scope.user        = User;
		$scope.userRosters = $firebaseHelper.join([User, 'rosters'], 'data/rosters');
		
		// user
		$scope.editUser = function () {
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Edit user',
				contentUrl:    'views/template/user.html',
				ok:            'Save',
				onSubmit: function () {
					return User.$save().then(function () {
						$mdToast.showSimple('User saved.');
					});
				},
			});
		};
		
/*
		function concatChildren(parents, childrenKey) {
			var children = [];
			$firebaseHelper.ref(parents).on('child_added', function (parentSnap) {
				parentSnap.child(childrenKey).forEach(function (childSnap) {
					childSnap.ref().on('value', function (childSnap){
						var child = childSnap.val();
						child.$id = childSnap.key();
						
						var index = -1;
						angular.forEach(children, function (c, i) {
							if (c.$id === child.$id) {
								index = i;
								children[i] = child; // overwrite it
							}
						});
						if (index < 0) {
							// not found, so add it
							children.push(child);
						}
					});
				});
			});
			return children;
		}
		
		$scope.allMyEvents = concatChildren('data/rosters', 'events');
		$scope.$watch('allMyEvents', function (allMyEvents) {
			console.log(allMyEvents);
			if (allMyEvents !== undefined){
				$scope.myEvents = $filter('orderBy')(allMyEvents, 'date');
			}
		});
*/
		
		// rosters
		$scope.newRoster = function () {
			$scope.roster = {
				admins: {},
				participants: {},
			};
			$scope.roster.admins[$scope.$me.$id] = $scope.$me.$id;
			$scope.roster.participants[$scope.$me.$id] = $scope.$me.$id;
			
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Add new roster',
				contentUrl:    'views/template/roster.html',
				ok:            'Create',
				onSubmit: function (scope) {
					return $scope.myRosters.$add(scope.roster).then(function (rosterRef) {
						$q.all([
							$firebaseHelper.join([rosterRef, 'admins'], 'data/users').$link($scope.$me.$id),
							$firebaseHelper.join([rosterRef, 'participants'], 'data/users').$link($scope.$me.$id),
							$firebaseHelper.join([$scope.$me, 'rosters'], 'data/rosters').$link(rosterRef.key()),
						]).then(function () {
							$state.go('roster', {roster: rosterRef.key()});
							
							$mdToast.showSimple('Roster created.');
						});
					});
				},
			});
		};
	})
	
	
	.factory('RSVP', function ($firebaseHelper, $q, $mdToast) {
		return function ($event, options) {
			options = angular.extend({
				showToast: true,
			}, options);
			
			var $statuses = $firebaseHelper.object('constants/statuses'),// constant
				$rsvps    = $firebaseHelper.object($event, 'rsvps');
			
			return {
				statuses: $statuses,
				rsvps: $rsvps,
				getParticipantStatus: function (participantId) {
					return $rsvps && $rsvps[participantId] ? $rsvps[participantId].status : -2;
				},
				setParticipantStatus: function (participantId, status) {
					status = parseInt(status);
					status = $rsvps && $rsvps[participantId] && $rsvps[participantId].status === status ? -2 : status;
					
					var deferred = $q.defer();
					
					return $firebaseHelper.ref($rsvps, participantId).update({
						status: status,
						updated: moment().format(),
					}, function () {
						deferred.resolve();
						
						if(options.showToast) {
							$statuses.$loaded().then(function () {
								$mdToast.showSimple('Your RSVP saved as: "' + $statuses[status].name + '"');
							});
						}
					});
					
					return deferred.promise;
				},
			};
		};
	})
	.directive('rsvp', function () {
		return {
			scope: {
				event: '=',
				participant: '=',
				readonly: '=?',
				mdSwipeItem: '=mdSwipeItemController',
			},
			restrict: 'E',
			templateUrl: 'views/directive/rsvp.html',
			controller: function ($scope, RSVP) {
				$scope.RSVP = RSVP;
			}
		};
	})
	.directive('avatar', function ($parse) {
		return {
			scope: {
				roster: '=',
			},
			restrict: 'E',
			replace: true,
			templateUrl: 'views/directive/avatar.html',
			controller: function ($scope, $element, $attrs) {
				$scope.$size = parseInt($parse($attrs.size)($scope)) || 40;
				
				// helper function
				$scope.initials = function (str) {
					return (str || '').split(' ').map(function (word) {
						return word ? word[0].toUpperCase() : '';
					}).join('');
				};
			},
		}
	})
	.directive('datetime', function () {
		return {
			scope: {
				date: '=',
			},
			restrict: 'E',
			replace: true,
			templateUrl: 'views/directive/datetime.html',
		}
	})
	
	
	
	.filter('filterByRsvp', function () {
		return function (array, rsvps, rsvp) {
			if ( ! angular.isArray(array)) return array;
			if ( ! angular.isObject(rsvps)) rsvps = {};
			rsvp = parseInt(rsvp);
			
			return array.filter(function (item) {
				if (rsvps[item.$id]) {
					switch (rsvps[item.$id].status) {
						case 1:
						case 0:
						case -1:
							return rsvp === rsvps[item.$id].status;
							break;
						default:
							return rsvp === -2;
							break;
					}
				} else {
					return rsvp === -2;
				}
			});
		};
	})
	.filter('filterByTimegroup', function () {
		return function (array, timegroup) {
			if ( ! angular.isArray(array)) return array;
			
			return array.filter(function (item) {
				var today = moment().isSame(item.date, 'day');
				if (timegroup === 'today') {
					return today;
				} else {
					return ! today && (timegroup === (moment().diff(item.date) < 0 ? 'upcoming' : 'past'));
				}
			});
		};
	})
	.filter('gender', function () {
		return function (array, gender) {
			if ( ! angular.isArray(array) || ! angular.isString(gender)) return array;
			
			return array.filter(function (item) {
				return item.gender === gender;
			});
		};
	})
	.filter('length', function () {
		return function (array) {
			if (angular.isArray(array)) return array.length;
			if (angular.isObject(array)) return Object.keys(array).length;
			return 0;
		};
	})
	.filter('concat', function () {
		return function (array, append) {
			return array.concat(append);
		};
	})
	
	
	
	.factory('$mdDialogForm', function ($mdDialog, $q) {
		return {
			show: function (options) {
				return $mdDialog.show($mdDialog.confirm(angular.extend({
					focusOnOpen:   false,
					preserveScope: true,
					ok:            'Submit',
					cancel:        'Cancel',
					template:      [
						'<md-dialog ng-form="dialogForm" md-theme="{{ dialog.theme }}" aria-label="{{ dialog.ariaLabel }}" ng-class="{loading: dialog.loading}">',
							'<md-dialog-content role="document" tabIndex="-1">',
								'<h2 class="md-title">{{ dialog.title }}</h2>',
								'<p ng-if="dialog.content">{{ dialog.content }}</p>',
								'<div ng-if="dialog.contentUrl" ng-include="dialog.contentUrl"></div>',
							'</md-dialog-content>',
							'<div class="md-actions">',
								'<md-button ng-if="dialog.$type == \'confirm\'" ng-click="dialog.abort()" class="md-primary">',
									'{{ dialog.cancel }}',
								'</md-button>',
								'<md-button type="submit" ng-disabled="dialogForm.$invalid || dialog.loading" ng-click="dialog.startLoading(); dialog.onSubmit(this).then(dialog.hide).finally(dialog.stopLoading)" class="md-primary">',
									'{{ dialog.ok }}',
								'</md-button>',
							'</div>',
							'<md-dialog-footer>',
								'<md-progress-circular md-mode="indeterminate"></md-progress-circular>',
							'</md-dialog-footer>',
						'</md-dialog>'
					].join(''),
					startLoading:  function startLoading(){ this.loading = true; },
					stopLoading:   function stopLoading(){  this.loading = false; },
					onSubmit:      function onSubmit(scope) {
						var deferred = $q.defer();
						
						deferred.resolve();
						
						return deferred.promise;
					},
				}, options || {})));
			},
		};
	})
	.factory('API', function ($http, $q) {
		var BASE_URL = '/api/v1/';
		return {
			post: function (method, config) {
				var deferred = $q.defer();
				
				$http.post(BASE_URL + method.replace(/^\/+/, ''), config.data, config)
					.success(function (res) {
						if (res && res.success) {
							deferred.resolve(res);
						} else {
							deferred.reject(res);
						}
					})
					.error(function (msg, code) {
						deferred.reject({code: code, message: msg});
					});
				
				return deferred.promise;
			},
		};
	})
	
	
	.directive('loading', function () {
		return {
			restrict: 'E',
			replace: true,
			template: ['<div flex layout="column" layout-align="center center">',
				'<md-progress-circular md-mode="indeterminate"></md-progress-circular>',
			'</div>'].join(''),
		}
	})
	
	.directive('mdSwipeItem', function ($swipe, $timeout, $parse) {
		return {
			restrict: 'A',
			link: function ($scope, $element, $attrs) {
				$element.addClass('md-swipe-item');
				
				var $inner   = angular.element($element.children()[0]), // @HACKY
					$actions = angular.element($element.children()[1])
					$left    = angular.element($actions.children()[0]),
					$right   = angular.element($actions.children()[1]);
				
				var width     = {left: 0, right: 0},
					triggered = {left: false, right: false},
					moved     = false,
					startPos  = false,
					touchSupported = 'ontouchend' in document,
					
					move  = function (to) {
						if (to === true) {
							to = 0;
							triggered.left = triggered.right = false;
							$element.removeClass('md-swiping-left md-swiping-left-triggered md-swiping-right md-swiping-right-triggered');
						}
						var transform = 'translate3d(' + (to || 0)  + 'px, 0, 0)';
						$inner.css({
							transform:       transform,
							webkitTransform: transform,
						});
						
						$element.addClass('md-swipe-item-animating');
						$timeout(function () {
							$element.removeClass('md-swipe-item-animating');
							
							if (triggered.leftMost)  $element.removeClass('md-swiping-left-most-triggered');
							if (triggered.rightMost) $element.removeClass('md-swiping-right-most-triggered');
							if ( ! triggered.left)   $element.removeClass('md-swiping-left md-swiping-left-triggered');
							if ( ! triggered.right)  $element.removeClass('md-swiping-right md-swiping-right-triggered');
						}, 100);
					},
					
					close = function () {
						return move(true);
					};
				
				$actions.on('click', function (e) {
					close();
				});
				$swipe.bind($inner, {
					start: function (pos) {
						startPos = pos;
					},
					move: function (pos) {
						moved = true;
						if (startPos && touchSupported && $parse($attrs.mdSwipeItem)($scope)) {
							var x = pos.x - startPos.x;
							
							var transform = 'translate3d(' + x + 'px, 0, 0)';
							$inner.css({
								transform:       transform,
								webkitTransform: transform,
							});
							
							if (x < 0) {
								// swiping left
								$element.addClass('md-swiping-left');
								$element.removeClass('md-swiping-right md-swiping-right-triggered');
								triggered.right = false;
								
								if (x < -72) {
									$element.addClass('md-swiping-left-triggered');
									triggered.left = true;
								} else {
									$element.removeClass('md-swiping-left-triggered');
									triggered.left = false;
								}
								
								if (x < -$actions[0].offsetWidth * 0.75) {
									$element.addClass('md-swiping-left-most-triggered');
									triggered.leftMost = true;
								} else {
									$element.removeClass('md-swiping-left-most-triggered');
									triggered.leftMost = false;
								}
							} else {
								// swiping right
								$element.addClass('md-swiping-right');
								$element.removeClass('md-swiping-left md-swiping-left-triggered');
								triggered.left = false;
								
								if (x > 72) {
									$element.addClass('md-swiping-right-triggered');
									triggered.right = true;
								} else {
									$element.removeClass('md-swiping-right-triggered');
									triggered.right = false;
								}
								
								if (x > $actions[0].offsetWidth * 0.75) {
									$element.addClass('md-swiping-right-most-triggered');
									triggered.rightMost = true;
								} else {
									$element.removeClass('md-swiping-right-most-triggered');
									triggered.rightMost = false;
								}
							}
						}
					},
					end: function () {
						if (moved) {
							moved = false;
							
							// make sure all action buttons are visible
							var transform = 'scale(1)';
							angular.forEach([$left.children(), $right.children()], function ($children) {
								angular.forEach($children, function (el) {
									angular.element(el).css({
										transform:       transform,
										webkitTransform: transform,
									});
								});
							});
							
							// fire events
							if (triggered.leftMost) {
								$parse($attrs.mdSwipeLeftMostTriggered)($scope);
							} else if (triggered.left) {
								$parse($attrs.mdSwipeLeftTriggered)($scope);
								move(-172);
							} else if (triggered.rightMost) {
								$parse($attrs.mdSwipeRightMostTriggered)($scope);
							} else if (triggered.right) {
								$parse($attrs.mdSwipeRightTriggered)($scope);
							} else {
								close();
							}
							
						} else {
							close();
						}
					},
					cancel: function () {
						moved = false;
						close();
					},
				});
				
				$scope.mdSwipeItem = {
					triggered: triggered,
					close:     close,
					teaseLeft: function () {
						$element.addClass('md-teasing-left');
						$timeout(function () {
							$element.removeClass('md-teasing-left');
						}, 450);
					},
				};
			},
		};
	});