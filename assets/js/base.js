angular.module('roster-io', ['ui.router', 'ngMaterial', 'firebaseHelper'])
	
	.config(["$urlRouterProvider", "$stateProvider", "$firebaseHelperProvider", function ($urlRouterProvider, $stateProvider, $firebaseHelperProvider) {
		// routing
		$urlRouterProvider.when('',  '/');
		$urlRouterProvider.when('/',  '/rosters'); // @TEMP
		$stateProvider
			// pages
			.state('rosters', {
				url: '/rosters',
				templateUrl: 'views/rosters.html',
				controller: ["$rootScope", "$firebaseHelper", function ($rootScope, $firebaseHelper) {
					$rootScope.rosters = $firebaseHelper.array('rosters');
					$rootScope.roster = $rootScope.event = undefined;
				}],
			})
			.state('roster', {
				url: '/roster/:roster',
				templateUrl: 'views/roster.html',
				controller: ["$rootScope", "$firebaseHelper", "$stateParams", function ($rootScope, $firebaseHelper, $stateParams) {
					$rootScope.roster = $firebaseHelper.object('rosters', $stateParams.roster);
					$rootScope.event  = undefined;
				}],
			})
			.state('event', {
				url: '/roster/:roster/:event',
				templateUrl: 'views/event.html',
				controller: ["$rootScope", "$firebaseHelper", "$stateParams", function ($rootScope, $firebaseHelper, $stateParams) {
					$rootScope.roster = $firebaseHelper.object('rosters', $stateParams.roster);
					$rootScope.event  = $firebaseHelper.object($rootScope.roster, 'events', $stateParams.event);
				}],
			});
		
		// data
		$firebaseHelperProvider.namespace('roster-io');
	}])
	
	.factory('Auth', ["$firebaseHelper", function ($firebaseHelper) {
		return $firebaseHelper.auth();
	}])
	.controller('AppCtrl', ["$rootScope", "$state", "$firebaseHelper", "Auth", function ($rootScope, $state, $firebaseHelper, Auth) {
		$rootScope.$state = $state;
		$rootScope.$firebaseHelper = $firebaseHelper;
		
		// auth
		var refreshAuthState = function () {
			if ( ! $rootScope.$me || ! $rootScope.$me.$loaded) return;
			
			$rootScope.$me.$loaded().then(function (me) {
				
			});
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
				Auth['$authWithOAuth' + (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ? 'Redirect' : 'Popup')]('facebook', {scope: 'read_mailbox'}).then(function (authData) {
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
	}])
	.controller('RostersCtrl', ["$scope", "$firebaseHelper", function ($scope, $firebaseHelper) {
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
		
		$scope.newRoster = function (thread) {
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
	}])
	.controller('RosterCtrl', ["$scope", "$firebaseHelper", "$state", function ($scope, $firebaseHelper, $state) {
		$scope.participants = $firebaseHelper.array($scope.roster, 'participants');
		$scope.events       = $firebaseHelper.array($scope.roster, 'events');		
	}])
	.controller('EventCtrl', ["$scope", "$firebaseHelper", "$state", function ($scope, $firebaseHelper, $state) {
		$scope.participants = $firebaseHelper.array($scope.roster, 'participants');
		$scope.rsvps        = $firebaseHelper.object($scope.event, 'rsvps');
		$scope.statuses     = $firebaseHelper.array('statuses'); // constant
		
		$scope.rsvp = function (participantId, to) {
			return $firebaseHelper.object($scope.event, 'rsvps', participantId).$loaded().then(function ($rsvp) {
				$rsvp.status = $rsvp.status === to ? null : to;
				return $rsvp.$save();
			});
		};
	}])
	
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
	});