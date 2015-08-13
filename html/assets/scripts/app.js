window.STRICT_INVITE_CHECK = false;

angular.module('roster-io', ['ui.router', 'ngMaterial', 'firebaseHelper', 'ngTouch'])
	
	.config(function ($urlRouterProvider, $stateProvider, $firebaseHelperProvider, $sceProvider) {
		// routing
		$urlRouterProvider.when('',  '/');
		$urlRouterProvider.when('/',  '/rosters'); // @TEMP?
		$stateProvider
			// pages
			.state('rosters', {
				url: '/rosters',
				templateUrl: 'views/page/rosters.html',
				resolve: {
					currentAuth:  function (Auth) {
						return Auth.$waitForMe();
					},
				},
				controller: 'RostersCtrl',
			})
			.state('roster', {
				url: '/roster/:roster',
				templateUrl: 'views/page/roster.html',
				controller: 'RosterCtrl',
			})
			.state('event', {
				url: '/roster/:roster/:event?v',
				templateUrl: 'views/page/event.html',
				controller: 'EventCtrl',
			})
			.state('invite', {
				url: '/invite/:invite',
				templateUrl: 'views/page/invite.html',
				controller: 'InviteCtrl',
			})
			.state('user', {
				url: '/user/:user',
				templateUrl: 'views/page/user.html',
				controller: 'UserCtrl',
			});
		
		// data
		$firebaseHelperProvider.namespace('roster-io');
		
		// security
		$sceProvider.enabled(false);
	})
	
	.factory('Auth', function ($rootScope, $firebaseHelper, $q) {
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
				meRef.update(authData); // update it w/ any changes since last login
			} else {
				// page loaded or refreshed while not logged in, or logging out
				$rootScope.$me = {};
			}
		});
		Auth.$waitForMe = function () {
			var deferred = $q.defer();
			
			Auth.$waitForAuth().then(function (authData) {
				if (authData) {
					$firebaseHelper.object('data/users/' + authData.uid).$loaded().then(function ($me) {
						authData.$me = $me;
						deferred.resolve(authData);
					});
				} else {
					deferred.resolve(authData);
				}
			});
			
			return deferred.promise;
		};
		
		$rootScope.$unauth = Auth.$unauth;
		
		return Auth;
	})
	.controller('AppCtrl', function ($rootScope, $state, $firebaseHelper, Auth) {
		$rootScope.loaded          = true;
		$rootScope.$state          = $state;
		$rootScope.$firebaseHelper = $firebaseHelper;
		$rootScope.console         = console;
		
		// state
		$rootScope.$on('$stateChangeSuccess', function(e, toState, toParams, fromState, fromParams){
			// highlight previous state for user convenience/orientation
			$state.$previous = fromState;
			$state.$previous.params = fromParams;
		});
		
		// auth
		$rootScope.$authThen = function (callback) {
			var authData = Auth.$getAuth();
			if ( ! authData) {
				Auth['$authWithOAuth' + (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ? 'Redirect' : 'Popup')]('facebook', {scope: 'email'}).then(function (authData) {
					if(angular.isFunction(callback)) callback(authData);
				}).catch(function (error) {
					console.error(error);
				});
			} else {
				if(angular.isFunction(callback)) callback(authData);
			}
		};
		
		// helpers
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
		$rootScope.avatar = function (userId, query) {
			query = query || 'type=square';
			return '//graph.facebook.com/' + (userId ? userId + '/' : '') + 'picture?' + query;
		};
	})
	
	
	
	.controller('RostersCtrl', function ($scope, $rootScope, $firebaseHelper, $q, Auth, $mdDialogForm, $mdToast) {
		Auth.$onAuth(function (authData) {
			if (authData) {
				$scope.rosters = $firebaseHelper.join([$scope.$me, 'rosters'], 'data/rosters');
			}
		});
		$rootScope.roster = $rootScope.event = null;
		
		$scope.newRoster = function () {
			$scope.roster = {
				admins: {},
				participants: {},
			};
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Add new roster',
				contentUrl:    'views/template/roster.html',
				ok:            'Create',
				onSubmit: function (scope) {
					return $scope.rosters.$add(scope.roster).then(function (rosterRef) {
						$q.all([
							$firebaseHelper.join([rosterRef, 'admins'], 'data/users').$link($scope.$me.$id),
							$firebaseHelper.join([rosterRef, 'participants'], 'data/users').$link($scope.$me.$id),
							$firebaseHelper.join([$scope.$me, 'rosters'], 'data/rosters').$link(rosterRef.key()),
						]).then(function () {
							$mdToast.showSimple({
								content: 'Roster created.',
							});
						});
					});
				},
			});
		};
		
		
		$scope.initials = function (str) {
			return (str || '').split(' ').map(function (word) {
				return word ? word[0].toUpperCase() : '';
			}).join('');
		};
	})
	
	.controller('RosterCtrl', function ($scope, $rootScope, $firebaseHelper, $mdDialogForm, $state, $mdToast, $q, Api, RSVP) {
		$scope.timegroups   = $firebaseHelper.array('constants/timegroups'); // constant
		
		$rootScope.roster   = $firebaseHelper.object('data/rosters', $state.params.roster);
		$rootScope.event    = null;
		
		$scope.invites      = $firebaseHelper.join([$scope.roster, 'invites'], 'data/invites');
		$scope.participants = $firebaseHelper.join([$scope.roster, 'participants'], 'data/users');
		$scope.events       = $firebaseHelper.array($scope.roster, 'events');
		$scope.users        = $firebaseHelper.array('data/users');
		$scope.RSVP         = RSVP;		
		
		$scope.deleteRoster = function (skipConfirm) {
			if (skipConfirm || confirm('Are you sure you want to permanently delete this roster?')) {
				// remove roster from all participants and admins rosters
				var deferreds  = [],
					rosterId   = $scope.roster.$id,
					removeLink = function (uid) {
						deferreds.push($firebaseHelper.object('data/users', uid, 'rosters', rosterId).$remove());
					};
				angular.forEach($scope.roster.admins,       removeLink);
				angular.forEach($scope.roster.participants, removeLink);
				
				// delete the roster itself
				deferreds.push($scope.roster.$remove());
				
				// wait for all promises to complete the redirect and notify user
				$q.all(deferreds).then(function () {
					$state.go('rosters');
					
					$mdToast.showSimple({
						content: 'Roster deleted.',
					});
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
					return $scope.roster.$save().then(function () {
						$mdToast.showSimple({
							content: 'Roster saved.',
						});
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
						$mdToast.showSimple({
							content: 'Event created.',
						});
					});
				},
			});
		};
		
		$scope.removeUser = function (skipConfirm, participant, participants) {
			participants = participants || $scope.participants;
			
			if (skipConfirm || confirm('Are you sure you want to remove this user from this roster?')) {
				var name = participant.name;
				$q.all([
					participants.$unlink(participant), // remove roster's particpants link
					$firebaseHelper.object('data/users', participant.$id, 'rosters', $scope.roster.$id).$remove(), // remove user's rosters link
				]).then(function () {
					$mdToast.showSimple({
						content: '"' + name + '" removed.',
					});
				});
			}
		};
		
		
		var sendInviteEmail = function (inviteId) {
			var deferred  = $q.defer(),
				inviteRef = $firebaseHelper.ref('data/invites', inviteId);
				
			inviteRef.once('value', function (inviteSnap) {
				var invite = inviteSnap.val();
				
				Api.post('email/invite', {params: {invite: inviteId}}).then(function () {
					// log as sent
					inviteRef.update({sent: moment().format()});
					
					// add to roster's invites list
					$firebaseHelper.object($scope.roster, 'invites').$loaded().then(function ($invites) {
						$invites[inviteId] = inviteId;
						$invites.$save().then(function () {
							deferred.resolve();
							
							// alert user
							$mdToast.showSimple({
								content: 'Invitation email sent to "' + (invite.name ? invite.name + ' ' : '') + '<' + invite.email + '>".',
							});
						}).catch(function (err) {
							deferred.reject(err);
						});
					}).catch(function (err) {
						deferred.reject(err);
					});
				}).catch(function (err) {
					deferred.reject(err);
					
					$mdToast.showSimple({
						content: 'Error ' + err.code + ': ' + err.message + '.',
					});
				});
			});
			return deferred.promise;
		};
		$scope.inviteUser = function () {
			$scope.invite = {
				by: $scope.$me.$id,
				to: {
					name: $state.current.name,
					params: $state.params,
				},
			};
			$scope.loadExistingUser = function (user) {
				$scope.invite.name  = user.name;
				$scope.invite.email = user.email;
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
								$firebaseHelper.join(['data/users', user.$id, 'rosters'], 'data/rosters').$link($scope.roster.$id),
								$firebaseHelper.join(['data/rosters', $scope.roster.$id, 'participants'], 'data/users').$link(user.$id),
								Api.post('email/added', {params: {roster: $scope.roster.$id, invitee: user.$id, inviter: $scope.$me.$id}}),
							]).then(function () {
								deferred.resolve();
								
								$mdToast.showSimple({
									content: '"' + user.name + '" added.',
								});
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
		$scope.rescindInvite = function (skipConfirm, participant, invites) {
			invites = invites || $scope.invites;
			
			if (skipConfirm || confirm('Are you sure you want to rescind this user\'s invite?')) {
				var name = participant.name || participant.email;
				invites.$remove(participant).then(function () {
					$mdToast.showSimple({
						content: 'Invite for "' + name + '" rescinded.',
					});
				});
			}
		};
		$scope.resendInvite = function (skipConfirm, inviteId) {
			if (skipConfirm || confirm('Are you sure you want to resend this user\'s invite?')) {
				sendInviteEmail(inviteId);
			}
		};
	})
		
	.controller('EventCtrl', function ($scope, $rootScope, $firebaseHelper, $mdDialogForm, $state, $mdToast, Auth, RSVP, $location) {
		$rootScope.roster = $firebaseHelper.object('data/rosters', $state.params.roster);
		$rootScope.event  = $firebaseHelper.object($scope.roster, 'events', $state.params.event);
		
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
		$scope.participants = $firebaseHelper.join([$scope.roster, 'participants'], 'data/users');
		$scope.RSVP         = RSVP;
		
		// helpers
		$scope.urlencode = window.encodeURIComponent;
		
		// CRUD
		$scope.deleteEvent = function (skipConfirm) {
			if (skipConfirm || confirm('Are you sure you want to permanently delete this event?')) {
				$scope.event.$remove().then(function () {
					$state.go('roster', {roster: $scope.roster.$id});
					
					$mdToast.showSimple({
						content: 'Event deleted.',
					});
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
						$mdToast.showSimple({
							content: 'Event saved.',
						});
					});
				},
			});
		};
		$scope.cloneEvent = function () {
			var event = {};
			angular.forEach($scope.event, function (v, k) {
				event[k] = v;
			});
			return $firebaseHelper.array($scope.roster, 'events').$add(event).then(function (eventRef) {
				$state.go('event', {roster: $scope.roster.$id, event: eventRef.key()});
				
				$mdToast.showSimple({
					content: 'Event cloned.',
				});
			});
		};
	})
	
	.controller('InviteCtrl', function ($rootScope, $scope, $firebaseHelper, $state, $q, Auth, $mdToast, $mdDialog) {
		$rootScope.roster = $rootScope.event = null;
		
		$scope.invite = $firebaseHelper.object('data/invites', $state.params.invite);
		$scope.invite.$loaded().then(function (invite) {
			if (invite.$value !== null) {
				$scope.roster  = $firebaseHelper.object('data/rosters', invite.to.params.roster);
				$scope.inviter = $firebaseHelper.object('data/users', invite.by);
				
				$q.all([$scope.roster.$loaded(), $scope.inviter.$loaded()]).then(function () {
					$scope.invite.$$loaded = true;
				});
			} else {
				// invite doesn't exist
				$scope.notFound = true;
			}
		});
		
		$scope.acceptInvite = function () {
			$scope.$authThen();
		};
		Auth.$onAuth(function (authData) {
			$scope.invite.$loaded().then(function (invite) {
				if (invite.accepted) {
					// notify user
					$mdToast.showSimple({
						content: 'Invitation already accepted.',
					});
					
					// redirect
					return $state.go(invite.to.name, invite.to.params);
				}
				if (authData) {
					if( ! $scope.notFound) {
						$scope.$me.$loaded().then(function (me) {
							if ((STRICT_INVITE_CHECK && invite.email === me.email) || ! STRICT_INVITE_CHECK) {
								$scope.roster.$loaded().then(function () {
									// update user model
									var rosters = {};
									rosters[invite.to.params.roster] = invite.to.params.roster;
									$scope.$me.$ref().update({
										email:   invite.email || me.facebook.email,
										name:    invite.name || me.facebook.displayName,
										gender:  (me.facebook.cachedUserProfile ? me.facebook.cachedUserProfile.gender : false) || 'male',
										rosters: rosters,
									});
									
									// update roster
									if($scope.roster.invites) delete $scope.roster.invites[invite.$id];
									if( ! $scope.roster.participants) $scope.roster.participants = {};
									$scope.roster.participants[me.uid] = me.uid;
									$scope.roster.$save().then(function () {
										// update invite
										$scope.invite.accepted = moment().format();
										$scope.invite.$save().then(function () {
											// notify user
											$mdToast.showSimple({
												content: 'Invitation accepted.',
											});
											
											// redirect
											return $state.go(invite.to.name, invite.to.params);
										});
									});
								});
							} else {
								// emails don't match
								
								// notify user
								$mdDialog.show($mdDialog.alert({
									content: 'Sorry, your Facebook email (' + me.email + ') does not match the email this invite was sent to (' + invite.email + ').',
									ok: 'OK',
								}));
							}
						});
					}
				}
			});
		});
	})
	
	.controller('UserCtrl', function ($rootScope, $scope, $firebaseHelper, $state, $mdToast, $mdDialogForm) {
		$rootScope.roster = $rootScope.event = null;
		
		$scope.user    = $firebaseHelper.object('data/users', $state.params.user);
		$scope.rosters = $firebaseHelper.join([$scope.user, 'rosters'], 'data/rosters');
		
		
		$scope.editUser = function () {
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Edit user',
				contentUrl:    'views/template/user.html',
				ok:            'Save',
				onSubmit: function () {
					return $scope.user.$save().then(function () {
						$mdToast.showSimple({
							content: 'User saved.',
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
								$mdToast.showSimple({content: 'Your RSVP saved as: "' + $statuses[status].name + '"'});
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
				readonly: '=',
			},
			restrict: 'E',
			templateUrl: 'views/directive/rsvp.html',
			controller: function ($scope, RSVP) {
				$scope.RSVP = RSVP;
				$scope.mdSwipeItem = $scope.$parent.mdSwipeItem;
			}
		};
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
				return (moment().diff(item.date) < 0 ? 'upcoming' : 'past') === timegroup;
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
	.factory('Api', function ($http, $q) {
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
					
				var getStyle = function (el, prop) {
					if (typeof getComputedStyle !== 'undefined') {
						return getComputedStyle(el, null).getPropertyValue(prop);
					} else {
						return el.currentStyle[prop];
					}
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
								
								var children   = $right.children();
									firstChild = children[0];
								width.right = $actions[0].offsetWidth - firstChild.offsetLeft + parseInt(getStyle(firstChild, 'margin-left'));
								
								if (x < -72) {
									$element.addClass('md-swiping-left-triggered');
									triggered.left = true;
								} else {
									$element.removeClass('md-swiping-left-triggered');
									triggered.left = false;
								}
								
								angular.forEach($right.children(), function(el) {
									var $el         = angular.element(el),
										w           = el.clientWidth,
										offsetRight = $right[0].offsetWidth - el.offsetLeft - w;
									
									var transform = 'scale(' + Math.max(0,  Math.min((Math.abs(x) - offsetRight) / w, 1) ) + ')';
									$el.css({
										transform:       transform,
										webkitTransform: transform,
									});
								});
								
								if (x < -$actions[0].offsetWidth * 0.66) {
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
								
								var children  = $left.children(),
									lastChild = children[children.length - 1];
								width.left = lastChild.offsetLeft + lastChild.offsetWidth + parseInt(getStyle(lastChild, 'margin-right'));
								
								if (x > 72) {
									$element.addClass('md-swiping-right-triggered');
									triggered.right = true;
								} else {
									$element.removeClass('md-swiping-right-triggered');
									triggered.right = false;
								}
								
								angular.forEach($left.children(), function(el) {
									var $el         = angular.element(el),
										w           = el.clientWidth,
										offsetRight = $left[0].offsetWidth - el.offsetLeft - w;
									
									var transform = 'scale(' + Math.max(0,  Math.min((Math.abs(x) - el.offsetLeft) / w, 1) ) + ')';
									$el.css({
										transform:       transform,
										webkitTransform: transform,
									});
								});
								
								if (x > $actions[0].offsetWidth * 0.66) {
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
								move(-width.right);
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