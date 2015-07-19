window.STRICT_INVITE_CHECK = false;

angular.module('roster-io', ['ui.router', 'ngMaterial', 'firebaseHelper', 'ngTouch'])
	
	.config(["$urlRouterProvider", "$stateProvider", "$firebaseHelperProvider", "$sceProvider", function ($urlRouterProvider, $stateProvider, $firebaseHelperProvider, $sceProvider) {
		// routing
		$urlRouterProvider.when('',  '/');
		$urlRouterProvider.when('/',  '/rosters'); // @TEMP?
		$stateProvider
			// pages
			.state('rosters', {
				url: '/rosters',
				templateUrl: 'views/page/rosters.html',
				resolve: {
					currentAuth:  ["Auth", function (Auth) {
						return Auth.$waitForMe();
					}],
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
			});
		
		// data
		$firebaseHelperProvider.namespace('roster-io');
		
		// security
		$sceProvider.enabled(false);
	}])
	
	.factory('Auth', ["$rootScope", "$firebaseHelper", "$q", function ($rootScope, $firebaseHelper, $q) {
		var Auth = $firebaseHelper.auth();
		
		$rootScope.$me = {};
		Auth.$onAuth(function (authData) {
			if (authData) {
				// logging in
				$rootScope.$me = $firebaseHelper.object('data/users/' + authData.uid); // fetch existing user profile
				$rootScope.$me.$ref().update(authData); // update it w/ any changes since last login
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
	}])
	.controller('AppCtrl', ["$rootScope", "$state", "$firebaseHelper", "Auth", function ($rootScope, $state, $firebaseHelper, Auth) {
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
		$rootScope.canEdit = function (uid, adminUids) {
			// returns false if not logged in
			// returns true if any of the following:
			// - adminUids specified and currently logged in user is in it
			// - uid is specified and is the currently logged in user
			// - nothing is specified but the currently logged in user is an admin
			if (angular.isArray(adminUids) && adminUids.indexOf($rootScope.$me.$id) >= 0) return true;
			if (angular.isObject(adminUids) && adminUids[$rootScope.$me.$id]) return true;
			return uid ? uid === $rootScope.$me.$id : $rootScope.$me.admin;
		};
		$rootScope.avatar = function (userId) {
			return '//graph.facebook.com/' + (userId ? userId + '/' : '') + 'picture?type=square';
		};
	}])
	
	
	
	.controller('RostersCtrl', ["$scope", "$rootScope", "$firebaseHelper", "Auth", "$mdDialogForm", "$mdToast", function ($scope, $rootScope, $firebaseHelper, Auth, $mdDialogForm, $mdToast) {
		Auth.$onAuth(function (authData) {
			if (authData) {
				$scope.rosters = $firebaseHelper.join([$scope.$me, 'rosters'], 'data/rosters');
			}
		});
		$rootScope.roster = $rootScope.event = null;
/*
		$scope.threads = [];
		$scope.loadThreads = function () {
			$scope.$authThen(function (authData) {
				FB.api('/me/threads', 'get', {access_token: authData.facebook.accessToken}, function (res) {
					if (res.error) return console.error(res);
					
					$scope.$apply(function () {
						$scope.threads = res.data;
					});
				});
			});
		};
		
		$scope.importParticipants = function (thread) {
			var participants = {};
			angular.forEach(thread.participants.data, function (participant) {
				participants['facebook:' + participant.id] = {
					id:   participant.id,
					name: participant.name
				};
			});
			
			var admins = {};
			admins[$scope.$me.$id] = $scope.$me.$id;
			$firebaseHelper.array('data/rosters').$add({
				admins:       admins,
				thread:       thread.id,
				participants: participants
			});
		};
*/
		
		$scope.newRoster = function () {
			$scope.roster = {};
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Add new roster',
				contentUrl:    'views/template/roster.html',
				ok:            'Create',
				onSubmit: function (scope) {
					return $scope.rosters.$add(scope.roster).then(function () {
						$mdToast.showSimple({
							content: 'Roster created.',
						});
					});
				},
			});
		};
	}])
	
	.controller('RosterCtrl', ["$scope", "$rootScope", "$firebaseHelper", "$mdDialogForm", "$state", "$mdToast", "$q", "Api", "RSVP", function ($scope, $rootScope, $firebaseHelper, $mdDialogForm, $state, $mdToast, $q, Api, RSVP) {
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
				$scope.roster.$remove().then(function () {
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
		
/*
		$scope.addUser = function () {
			$scope.users = $firebaseHelper.array('data/users');
			
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Add user',
				contentUrl:    'views/template/user.html',
				ok:            'Add',
				onSubmit: function (scope) {
					return $scope.participants.$ref().child(scope.selectedUser.$id).set(scope.selectedUser.$id, function () {
						$mdToast.showSimple({
							content: '"' + $scope.user.name + '" added.',
						});
					});
				},
			});
		};
*/
		$scope.removeUser = function (skipConfirm, participant, participants) {
			participants = participants || $scope.participants;
			
			if (skipConfirm || confirm('Are you sure you want to remove this user from this roster?')) {
				var name = participant.name;
				participants.$unlink(participant).then(function () {
					$mdToast.showSimple({
						content: '"' + name + '" removed.',
					});
				});
			}
		};
		
		
		$scope.inviteUser = function (name) {
			$scope.invite = {
				by: $scope.$me.$id,
				to: {
					name: $state.current.name,
					params: $state.params,
				},
			};
			if (name){
				// Title Case in case of illiterate users
				$scope.invite.name = name.replace(/\b\w+/g, function (text) {
					return text.charAt(0).toUpperCase() + text.substr(1);
				});
			}
			
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Invite new user',
				contentUrl:    'views/template/invite.html',
				ok:            'Invite',
				onSubmit: function (scope) {
					var deferred = $q.defer();
					
					$firebaseHelper.array('data/invites').$add($scope.invite).then(function (inviteSnap) {
						var inviteId = inviteSnap.key();
						
						Api.post('email/invite', undefined, {params: {invite: inviteId}})
							.then(function () {
								$firebaseHelper.object($scope.roster, 'invites').$loaded().then(function (invites) {
									invites[inviteId] = inviteId;
									invites.$save().then(function () {
										deferred.resolve();
										
										$mdToast.showSimple({
											content: 'Invitation email sent to "' + (scope.invite.name ? scope.invite.name + ' ' : '') + '<' + scope.invite.email + '>".',
										});
									});
								});
							})
							.catch(function (err) {
								deferred.reject(err);
								
								$mdToast.showSimple({
									content: 'Error ' + err.code + ': ' + err.message + '.',
								});
							});
					});
					
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
						content: '"' + name + '" rescinded.',
					});
				});
			}
		};
	}])
		
	.controller('EventCtrl', ["$scope", "$rootScope", "$firebaseHelper", "$mdDialogForm", "$state", "$mdToast", "Auth", "RSVP", "$location", function ($scope, $rootScope, $firebaseHelper, $mdDialogForm, $state, $mdToast, Auth, RSVP, $location) {
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
	}])
	
	.controller('InviteCtrl', ["$scope", "$firebaseHelper", "$state", "$q", "Auth", "$mdToast", "$mdDialog", function ($scope, $firebaseHelper, $state, $q, Auth, $mdToast, $mdDialog) {
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
										gender:  me.facebook.gender || 'male',
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
	}])
	
	
	
	.factory('RSVP', ["$firebaseHelper", "$q", "$mdToast", function ($firebaseHelper, $q, $mdToast) {
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
					
					var deferred = $q.defer();
					
					return $firebaseHelper.object($rsvps, participantId).$loaded().then(function ($rsvp) {
						$rsvp.status = status; // clear it if trying to set to same value, or set it otherwise
						$rsvp.updated = moment().format();
						
						return $rsvp.$save().then(function () {
							deferred.resolve();
							
							if(options.showToast) {
								$statuses.$loaded().then(function () {
									$mdToast.showSimple({content: 'Your RSVP saved as: "' + $statuses[$rsvp.status].name + '"'});
								});
							}
						});
					});
					
					return deferred.promise;
				},
			};
		};
	}])
	.directive('rsvp', function () {
		return {
			scope: {
				event: '=',
				participant: '=',
				readonly: '=',
			},
			restrict: 'E',
			templateUrl: 'views/directive/rsvp.html',
			controller: ["$scope", "RSVP", function ($scope, RSVP) {
				$scope.RSVP = RSVP;
			}]
		};
	})
	
	
	
	.filter('filterByRsvp', function () {
		return function (array, rsvps, rsvp) {
			if ( ! angular.isArray(array) || ! angular.isObject(rsvps)) return array;
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
	
	
	
	.factory('$mdDialogForm', ["$mdDialog", "$q", function ($mdDialog, $q) {
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
	}])
	.factory('Api', ["$http", "$q", function ($http, $q) {
		var BASE_URL = '/api/v1/';
		return {
			post: function (method, data, config) {
				var deferred = $q.defer();
				
				$http.post(BASE_URL + method.replace(/^\/+/, ''), data, config)
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
	}])
	
	
	.directive('loading', function () {
		return {
			restrict: 'E',
			replace: true,
			template: ['<div flex layout="column" layout-align="center center">',
				'<md-progress-circular md-mode="indeterminate"></md-progress-circular>',
			'</div>'].join(''),
		}
	})
	
	.directive('mdSwipeItem', ["$swipe", "$timeout", "$parse", function ($swipe, $timeout, $parse) {
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
								
								if (x < -48) {
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
								
								if (x > 48) {
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
	}]);