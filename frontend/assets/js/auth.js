/*
 * auth.js — Queue system authentication module (Step 7 of the LAN
 * migration).
 *
 * Public API: window.JSQ_Auth — same function names as before. What
 * changed is what's INSIDE these functions: they used to read/write
 * localStorage directly; now they all delegate to JSQ_AuthService
 * (frontend/assets/js/services/authCache.js), which talks to the
 * server's SQLite-backed /api/auth/* and /api/users/* endpoints
 * instead.
 *
 * THREE THINGS THIS CHANGE REQUIRES IN admin.js/encoder.js — fixed
 * together with this same file, in this same step, so the app doesn't
 * pass through a knowingly-broken state:
 *
 * 1. NEW: JSQ_Auth.init() must be awaited once, before anything else
 *    in this file is trusted. localStorage was always synchronously
 *    ready; a server-backed cache needs one round trip first. Both
 *    encoder.js's and admin.js's boot sequences now do this.
 *
 * 2. NEW: JSQ_Auth.loadUsers() must be awaited once on admin.html
 *    before listUsers()/getUserById()/getUserByUsername() return
 *    anything meaningful (they read a cache that starts empty).
 *    admin.js's boot() now does this before its first renderUsers().
 *
 * 3. Functions that used to be synchronous — renameUser, setUserCounter,
 *    setUserIsAdmin, deleteUser, logout — are ALL Promises now, since
 *    they're real network requests. createUser/login/verifyPassword/
 *    adminResetPassword were ALREADY Promise-based even before this
 *    migration (the old code hashed passwords with the browser's
 *    Web Crypto API, which is async even purely locally), so those
 *    call sites needed no changes at all. The five listed above DID
 *    need their call sites converted from try/catch to .then()/.catch()
 *    — done in this step, in admin.js and encoder.js.
 *
 * getSession(), isLoggedIn(), isAdmin(), hasAnyUser(), listUsers(),
 * getUserById(), getUserByUsername() stay synchronous, same as
 * before — they just read an in-memory cache instead of localStorage,
 * once it's been filled by init()/loadUsers().
 */
(function (window) {
    'use strict';

    var service = window.JSQ_AuthService;
    if (!service) {
        throw new Error(
            'JSQ_Auth: JSQ_AuthService is not defined. Make sure ' +
            '<script src="assets/js/services/apiClient.js"> and ' +
            '<script src="assets/js/services/authCache.js"> are both ' +
            'loaded BEFORE auth.js in this page\'s <script> tags.'
        );
    }

    // ---------------------------------------------------------------
    // Bootstrap (new in Step 7 — see file header, point 1)
    // ---------------------------------------------------------------

    function init() {
        return service.init();
    }

    // Admin-panel only (see file header, point 2).
    function loadUsers() {
        return service.loadUsers();
    }

    // ---------------------------------------------------------------
    // Reads — synchronous, same contract as before
    // ---------------------------------------------------------------

    function hasAnyUser() { return service.hasAnyUser(); }
    function listUsers() { return service.listUsers(); }
    function getUserById(id) { return service.getUserById(id); }
    function getUserByUsername(name) { return service.getUserByUsername(name); }
    function getSession() { return service.getSession(); }
    function isLoggedIn() { return service.isLoggedIn(); }
    function isAdmin() { return service.isAdmin(); }

    // ---------------------------------------------------------------
    // Mutations — same names/parameter order as the old auth.js.
    // Every one of these now returns a Promise (see file header,
    // point 3), including several that used to be synchronous.
    // ---------------------------------------------------------------

    // IMPORTANT: this is NOT the same as createUser({isAdmin:true})
    // followed by login(). The server requires an existing ADMIN
    // session to create any user via createUser() (POST /api/users) —
    // correct for every case except the very first account, since
    // there's no admin yet to be logged in as. This hits a dedicated
    // endpoint (POST /api/auth/first-run-setup) built specifically to
    // create-and-log-in the first account in one step, with no prior
    // session required. Use this ONLY for the first-run "Set up admin"
    // form; every other "create a user" flow (admin.html's "Add user"
    // button, reached only once an admin is already logged in) still
    // uses createUser() below, unchanged.
    function firstRunSetup(username, password) {
        return service.firstRunSetup(username, password);
    }

    function createUser(opts) { return service.createUser(opts); }
    function login(username, password) { return service.login(username, password); }
    function logout() { return service.logout(); }

    // The old signature took a userId, since the CALLER built its own
    // "current session" object to check against. The server doesn't
    // work that way — it always verifies the password of whoever's
    // ACTUALLY logged in (from the session cookie), regardless of what
    // id is passed here. The parameter is kept only so this function's
    // signature doesn't change and Step 9 doesn't need to touch its
    // call sites; passing a different user's id can't check their
    // password, only the current session's own.
    function verifyPassword(userId, password) {
        return service.verifyPassword(password);
    }

    function changeOwnPassword(userId, oldPassword, newPassword) {
        return service.changeOwnPassword(oldPassword, newPassword);
    }

    function adminResetPassword(userId, newPassword) {
        return service.adminResetPassword(userId, newPassword);
    }

    function renameUser(userId, newUsername) {
        return service.renameUser(userId, newUsername);
    }

    // Admin editing someone ELSE's counter (admin.html's user table).
    // A user picking their OWN counter (encoder.html) uses
    // setOwnCounter() below instead — the server itself uses a
    // different, non-admin endpoint for that case (see
    // server/routes/auth.js's PATCH /api/auth/counter). encoder.js's
    // call site was switched to setOwnCounter() in this same step.
    function setUserCounter(userId, counterId) {
        return service.setUserCounter(userId, counterId);
    }

    function setUserIsAdmin(userId, isAdminFlag) {
        return service.setUserIsAdmin(userId, isAdminFlag);
    }

    function deleteUser(userId) {
        return service.deleteUser(userId);
    }

    // ---------------------------------------------------------------
    // NEW in Step 7 — self-service counter selection. See the
    // setUserCounter() comment just above for when to use which.
    // ---------------------------------------------------------------

    function setOwnCounter(counterId) {
        return service.setOwnCounter(counterId);
    }

    window.JSQ_Auth = {
        init: init,
        loadUsers: loadUsers,

        hasAnyUser: hasAnyUser,
        listUsers: listUsers,
        getUserById: getUserById,
        getUserByUsername: getUserByUsername,
        getSession: getSession,
        isLoggedIn: isLoggedIn,
        isAdmin: isAdmin,

        firstRunSetup: firstRunSetup,
        createUser: createUser,
        login: login,
        logout: logout,
        verifyPassword: verifyPassword,
        changeOwnPassword: changeOwnPassword,
        adminResetPassword: adminResetPassword,
        renameUser: renameUser,
        setUserCounter: setUserCounter,
        setUserIsAdmin: setUserIsAdmin,
        deleteUser: deleteUser,
        setOwnCounter: setOwnCounter
    };

})(window);
