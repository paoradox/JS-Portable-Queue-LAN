/*
 * authCache.js — Frontend session/user cache, backed by the
 * /api/auth/* and /api/users/* REST endpoints instead of localStorage.
 *
 * Public API: window.JSQ_AuthService
 *
 * This is NOT wired into window.JSQ_Auth yet — that swap happens in
 * Step 7. Right now this file just sits alongside the old auth.js,
 * unused, so it can be tested on its own first.
 *
 * Why some reads stay synchronous and others don't:
 *   getSession() / isLoggedIn() / isAdmin() / hasAnyUser() /
 *   listUsers() / getUserById() / getUserByUsername() all read from
 *   an in-memory cache instead of calling the network — same as
 *   before, admin.js and encoder.js call these directly without
 *   awaiting anything. Call init() once at page boot (and loadUsers()
 *   once on the admin page) to fill that cache before relying on it.
 *
 * IMPORTANT for Step 9 (updating admin.js's call sites): in the old
 * auth.js, renameUser(), setUserCounter(), setUserIsAdmin(), and
 * deleteUser() were synchronous — they returned immediately, no
 * .then() needed. Here they're real network calls, so they return
 * Promises now. Any admin.js code that calls them without .then()/
 * await will need that added — flagging this now so it isn't a
 * surprise when Step 9 gets to it.
 */
(function (window) {
    'use strict';

    var api = window.JSQ_ApiClient;

    const cache = {
        hasAnyUser: false,
        session: null,   // current logged-in user view, or null
        users: []        // admin-panel-only cache, filled by loadUsers()
    };

    function replaceOrAddUser(user) {
        for (let i = 0; i < cache.users.length; i++) {
            if (cache.users[i].id === user.id) {
                cache.users[i] = user;
                return;
            }
        }
        cache.users.push(user);
    }

    // ---------------------------------------------------------------
    // Boot: call once per page load, before relying on the sync reads
    // below. Mirrors what the old code got "for free" from
    // localStorage always being immediately readable.
    // ---------------------------------------------------------------

    function init() {
        return api.get('/api/auth/session').then((res) => {
            cache.session = res.user || null;
            return api.get('/api/auth/has-any-user');
        }).then((res) => {
            cache.hasAnyUser = !!res.hasAnyUser;
        });
    }

    // Admin-only. Call once on admin.html before using listUsers() /
    // getUserById() / getUserByUsername() — those three stay
    // synchronous by reading this cache, same contract as before.
    function loadUsers() {
        return api.get('/api/users').then((res) => {
            cache.users = res.users;
            return cache.users.slice();
        });
    }

    // ---------------------------------------------------------------
    // Synchronous reads
    // ---------------------------------------------------------------

    function hasAnyUser() { return cache.hasAnyUser; }
    function getSession() { return cache.session; }
    function isLoggedIn() { return cache.session !== null; }
    function isAdmin() { return !!(cache.session && cache.session.isAdmin); }

    function listUsers() { return cache.users.slice(); }

    function getUserById(id) {
        return cache.users.find((u) => u.id === id) || null;
    }

    function getUserByUsername(name) {
        const needle = String(name || '').trim().toLowerCase();
        return cache.users.find((u) => u.username.toLowerCase() === needle) || null;
    }

    // ---------------------------------------------------------------
    // Session mutations
    // ---------------------------------------------------------------

    // Combines the old two-call flow (createUser({isAdmin:true}) then
    // login()) into the one request server/routes/auth.js already
    // exposes for this exact purpose.
    function firstRunSetup(username, password) {
        return api.post('/api/auth/first-run-setup', { username, password }).then((res) => {
            cache.session = res.user;
            cache.hasAnyUser = true;
            return res.user;
        });
    }

    function login(username, password) {
        return api.post('/api/auth/login', { username, password }).then((res) => {
            cache.session = res.user;
            return res.user;
        });
    }

    function logout() {
        return api.post('/api/auth/logout', {}).then(() => {
            cache.session = null;
        });
    }

    function verifyPassword(password) {
        return api.post('/api/auth/verify-password', { password }).then((res) => !!res.valid);
    }

    function changeOwnPassword(oldPassword, newPassword) {
        return api.post('/api/auth/change-password', { oldPassword, newPassword });
    }

    // Self-service counter pick (encoder.js) — always targets your own
    // session server-side, never another user's.
    function setOwnCounter(counterId) {
        return api.patch('/api/auth/counter', { counter: counterId }).then((res) => {
            cache.session = res.user;
            return res.user;
        });
    }

    // ---------------------------------------------------------------
    // Admin user management — all async now (see file header note)
    // ---------------------------------------------------------------

    function createUser(opts) {
        return api.post('/api/users', opts || {}).then((res) => {
            cache.users.push(res.user);
            return res.user;
        });
    }

    function renameUser(userId, newUsername) {
        return api.patch('/api/users/' + userId, { username: newUsername }).then((res) => {
            replaceOrAddUser(res.user);
            return res.user;
        });
    }

    function setUserCounter(userId, counterId) {
        return api.patch('/api/users/' + userId, { counter: counterId }).then((res) => {
            replaceOrAddUser(res.user);
            return res.user;
        });
    }

    function setUserIsAdmin(userId, isAdminFlag) {
        return api.patch('/api/users/' + userId, { isAdmin: isAdminFlag === true }).then((res) => {
            replaceOrAddUser(res.user);
            return res.user;
        });
    }

    function adminResetPassword(userId, newPassword) {
        return api.post('/api/users/' + userId + '/reset-password', { newPassword });
    }

    function deleteUser(userId) {
        return api.del('/api/users/' + userId).then(() => {
            cache.users = cache.users.filter((u) => u.id !== userId);
        });
    }

    window.JSQ_AuthService = {
        init,
        loadUsers,

        hasAnyUser,
        getSession,
        isLoggedIn,
        isAdmin,
        listUsers,
        getUserById,
        getUserByUsername,

        firstRunSetup,
        login,
        logout,
        verifyPassword,
        changeOwnPassword,
        setOwnCounter,

        createUser,
        renameUser,
        setUserCounter,
        setUserIsAdmin,
        adminResetPassword,
        deleteUser
    };

})(window);
