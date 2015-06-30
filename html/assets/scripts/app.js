window.STRICT_INVITE_CHECK = false;

angular.module('roster-io', ['ui.router', 'ngMaterial', 'firebaseHelper'])
	
	.config(function ($urlRouterProvider, $stateProvider, $firebaseHelperProvider, $sceProvider) {
		// routing
		$urlRouterProvider.when('',  '/');
		$urlRouterProvider.when('/',  '/rosters'); // @TEMP
		$stateProvider
			// pages
			.state('rosters', {
				url: '/rosters',
				templateUrl: 'views/page/rosters.html',
				controller: function ($rootScope, $firebaseHelper) {
					$rootScope.rosters = $firebaseHelper.join([$rootScope.$me, 'rosters'], 'rosters');
					$rootScope.roster = $rootScope.event = undefined;
				},
			})
			.state('roster', {
				url: '/roster/:roster',
				templateUrl: 'views/page/roster.html',
				controller: function ($rootScope, $firebaseHelper, $stateParams) {
					$rootScope.roster = $firebaseHelper.object('rosters', $stateParams.roster);
					$rootScope.event  = undefined;
				},
			})
			.state('event', {
				url: '/roster/:roster/:event',
				templateUrl: 'views/page/event.html',
				controller: function ($rootScope, $firebaseHelper, $stateParams) {
					$rootScope.roster = $firebaseHelper.object('rosters', $stateParams.roster);
					$rootScope.event  = $firebaseHelper.object($rootScope.roster, 'events', $stateParams.event);
				},
			})
			.state('invite', {
				url: '/invite/:invite',
				templateUrl: 'views/page/invite.html',
				controller: function ($rootScope, $firebaseHelper, $stateParams, $q) {
					$rootScope.invite = $firebaseHelper.object('invites', $stateParams.invite);
					$rootScope.invite.$loaded().then(function (invite) {
						if (invite.$value !== null) {
							$rootScope.roster  = $firebaseHelper.object('rosters', invite.to.params.roster);
							$rootScope.inviter = $firebaseHelper.object('users', invite.by);
							
							$q.all([$rootScope.roster.$loaded(), $rootScope.inviter.$loaded()]).then(function () {
								$rootScope.invite.$$loaded = true;
							});
						} else {
							// invite doesn't exist
							$rootScope.notFound = true;
						}
					});
				},
			});
		
		// data
		$firebaseHelperProvider.namespace('roster-io');
		
		// security
		$sceProvider.enabled(false);
	})
	
	.factory('Auth', function ($firebaseHelper) {
		return $firebaseHelper.auth();
	})
	.controller('AppCtrl', function ($rootScope, $state, $firebaseHelper, Auth) {
		$rootScope.$state          = $state;
		$rootScope.$firebaseHelper = $firebaseHelper;
		$rootScope.console         = console;
		
		$rootScope.$on('$stateChangeSuccess', function(e, toState, toParams, fromState, fromParams){
			$state.$previous = fromState;
			$state.$previous.params = fromParams;
		});
		
		// auth
		var refreshAuthState = function () {
/*
			if ( ! $rootScope.$me || ! $rootScope.$me.$loaded) return;
			
			$rootScope.$me.$loaded().then(function (me) {
				
			});
*/
		};
		$rootScope.$me = {};
		$rootScope.$unauth = Auth.$unauth;
		Auth.$onAuth(function (authData) {
			if (authData) {
				// logging in
				$rootScope.$me = $firebaseHelper.object('users/' + authData.uid); // fetch existing user profile
				$rootScope.$me.$ref().update(authData); // update it w/ any changes since last login
				refreshAuthState();
			} else {
				// page loaded or refreshed while not logged in, or logging out
				$rootScope.$me = {};
			}
		});
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
		
		$rootScope.canEdit = function (uid, adminUids) {
			if (angular.isArray(adminUids) && adminUids.indexOf($rootScope.$me.uid) >= 0) return true;
			if (angular.isObject(adminUids) && adminUids[$rootScope.$me.uid]) return true;
			return uid ? uid === $rootScope.$me.uid : $rootScope.$me.admin;
		};
		
		$rootScope.avatar = function (userId) {
			return '//graph.facebook.com/' + (userId ? userId + '/' : '') + 'picture?type=square';
		};
	})
	.controller('RostersCtrl', function ($scope, $firebaseHelper, $mdDialogForm, $mdToast) {
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
			admins[$scope.$me.uid] = $scope.$me.uid;
			$firebaseHelper.array('rosters').$add({
				admins:       admins,
				thread:       thread.id,
				participants: participants
			});
		};
		
		$scope.newRoster = function () {
			$scope.roster = {};
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Add new roster',
				contentUrl:    'views/template/roster.html',
				ok:            'Create',
				onSubmit: function (scope) {
					this.loading = true;
					
					return $scope.rosters.$add(scope.roster).then(function () {
						this.loading = false;
						
						$mdToast.showSimple({
							content: 'Roster created.',
						});
					});
				},
			});
		};
	})
	.controller('RosterCtrl', function ($scope, $firebaseHelper, $mdDialogForm, $state, $mdToast) {
		$scope.invitees     = $firebaseHelper.object($scope.roster, 'invites');
		$scope.invites      = $firebaseHelper.join([$scope.roster, 'invites'], 'invites');
		$scope.participants = $firebaseHelper.join([$scope.roster, 'participants'], 'users');
		$scope.events       = $firebaseHelper.array($scope.roster, 'events');	
		$scope.users        = $firebaseHelper.array('users');	

		
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
					this.loading = true;
					
					return $scope.roster.$save().then(function () {
						this.loading = false;
						
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
					this.loading = true;
					
					scope.event.date = moment(scope.event.$date).format();
					
					return $scope.events.$add(scope.event).then(function () {
						this.loading = false;
						
						$mdToast.showSimple({
							content: 'Event created.',
						});
					});
				},
			});
		};
		
		$scope.inviteUser = function (name) {
			$scope.invite = {
				by: $scope.$me.uid,
				to: {
					name: $state.current.name,
					params: $state.params,
				},
				name: (name || '').replace(/\b\w+/g, function (text) { return text.charAt(0).toUpperCase() + text.substr(1); }), // Title Case in case of illiterate users
			};
			
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Invite new user',
				contentUrl:    'views/template/invite.html',
				ok:            'Invite',
				onSubmit: function (scope) {
					this.loading = true;
					
					return $firebaseHelper.array('invites').$add($scope.invite).then(function (inviteSnap) {
						var inviteId = inviteSnap.key();
						$scope.invitees[inviteId] = inviteId;
						$scope.invitees.$save().then(function () {
							this.loading = false;
							
							$mdToast.showSimple({
								content: 'Invitation email sent to "' + scope.invite.name + ' <' + scope.invite.email + '>".',
							});
						});
					});
				},
			});
		};
		
/*
		$scope.addUser = function () {
			$scope.users = $firebaseHelper.array('users');
			
			$mdDialogForm.show({
				scope:         $scope,
				title:         'Add user',
				contentUrl:    'views/template/user.html',
				ok:            'Add',
				onSubmit: function (scope) {
					this.loading = true;
					
					return $scope.participants.$ref().child(scope.selectedUser.$id).set(scope.selectedUser.$id, function () {
						this.loading = false;
						
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
	})
		
	.controller('EventCtrl', function ($scope, $firebaseHelper, $mdDialogForm, $state, $mdToast) {
		$scope.urlencode = window.encodeURIComponent;
		
		$scope.participants = $firebaseHelper.join([$scope.roster, 'participants'], 'users');
		$scope.rsvps        = $firebaseHelper.object($scope.event, 'rsvps');
		$scope.statuses     = $firebaseHelper.array('statuses'); // constant
		
		$scope.rsvp = function (participantId, to) {
			return $firebaseHelper.object($scope.event, 'rsvps', participantId).$loaded().then(function ($rsvp) {
				$rsvp.status = $rsvp.status === to ? -2 : to;
				$rsvp.updated = moment().format();
				return $rsvp.$save();
			});
		};
		
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
					this.loading = true;
					
					scope.event.date = moment(scope.event.$date).format();
					
					return $scope.event.$save().then(function () {
						this.loading = false;
						
						$mdToast.showSimple({
							content: 'Event saved.',
						});
					});
				},
			});
		};
	})
	.controller('InviteCtrl', function ($scope, $firebaseHelper, Auth, $state, $mdToast, $mdDialog) {
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
	})
	
	
	.filter('filterByRsvp', function () {
		return function (array, rsvps, rsvp) {
			if ( ! angular.isArray(array) || ! angular.isObject(rsvps)) return array;
			rsvp = parseInt(rsvp);
			
			return array.filter(function (item) {
				return rsvps[item.$id] ? rsvps[item.$id].status === rsvp : rsvp === -2;
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
								'<md-button type="submit" ng-disabled="dialogForm.$invalid || dialog.loading" ng-click="dialog.onSubmit(this).then(dialog.hide)" class="md-primary">',
									'{{ dialog.ok }}',
								'</md-button>',
							'</div>',
							'<md-dialog-footer>',
								'<md-progress-circular md-mode="indeterminate"></md-progress-circular>',
							'</md-dialog-footer>',
						'</md-dialog>'
					].join(''),
					onSubmit:      function onSubmit(scope) {
						var deferred = $q.defer();
						this.loading = true;
						
						if (scope.dialogForm.$valid) {
							this.loading = false;
							deferred.resolve();
						} else {
							this.loading = false;
							deferred.reject();
						}
						
						return deferred.promise;
					},
				}, options || {})));
			},
		};
	});