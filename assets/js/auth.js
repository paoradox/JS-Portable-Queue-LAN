/*
 * auth.js — Queue system authentication module
 *
 * Public API: window.JSQ_Auth
 */
(function (window) {
    'use strict';

    var USERS_KEY   = 'jsq.users';
    var SESSION_KEY = 'jsq.session';
    var ATTEMPTS_KEY = 'jsq.loginAttempts';
    var COUNTER_KEY_PREFIX = 'jsq.encoder.counter.';

    var MIN_USERNAME_LEN = 3;
    var MAX_USERNAME_LEN = 20;
    var MIN_PASSWORD_LEN = 6;
    var USERNAME_RE = /^[A-Za-z0-9_-]+$/;

    // Login lockout: MAX_LOGIN_ATTEMPTS failures for the same username
    // within a lockout window trigger a LOCKOUT_MS cooldown before that
    // username can try again. This is a client-side speed bump only —
    // anyone with DevTools access can clear jsq.loginAttempts directly.
    var MAX_LOGIN_ATTEMPTS = 5;
    var LOCKOUT_MS = 30000; // 30 seconds

    function readUsers() {
        var raw = window.localStorage.getItem(USERS_KEY);
        if (!raw) { return []; }
        try {
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.warn('JSQ_Auth: jsq.users was corrupted, resetting.');
            window.localStorage.setItem(USERS_KEY, '[]');
            return [];
        }
    }

    function writeUsers(users) {
        window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    function readRawSession() {
        var raw = window.localStorage.getItem(SESSION_KEY);
        if (!raw) { return null; }
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function writeRawSession(record) {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(record));
    }

    function clearRawSession() {
        window.localStorage.removeItem(SESSION_KEY);
    }

    // ---------------------------------------------------------------
    // Login attempt tracking (lockout)
    // ---------------------------------------------------------------

    function readAttempts() {
        var raw = window.localStorage.getItem(ATTEMPTS_KEY);
        if (!raw) { return {}; }
        try {
            var parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) { return {}; }
    }

    function writeAttempts(map) {
        window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(map));
    }

    function attemptKey(username) {
        return String(username || '').trim().toLowerCase();
    }

    // Returns milliseconds remaining on an active lockout for this
    // username, or 0 if not locked (including expired lockouts).
    function getLockoutRemainingMs(username) {
        var map = readAttempts();
        var record = map[attemptKey(username)];
        if (!record || !record.lockedUntil) { return 0; }
        var remaining = record.lockedUntil - Date.now();
        return remaining > 0 ? remaining : 0;
    }

    function recordFailedAttempt(username) {
        var key = attemptKey(username);
        var map = readAttempts();
        var record = map[key] || { count: 0, lockedUntil: null };

        // A previous lockout that has already expired starts fresh.
        if (record.lockedUntil && record.lockedUntil <= Date.now()) {
            record = { count: 0, lockedUntil: null };
        }

        record.count += 1;
        if (record.count >= MAX_LOGIN_ATTEMPTS) {
            record.lockedUntil = Date.now() + LOCKOUT_MS;
            record.count = 0;
        }

        map[key] = record;
        writeAttempts(map);
    }

    function clearAttempts(username) {
        var key = attemptKey(username);
        var map = readAttempts();
        if (map[key]) {
            delete map[key];
            writeAttempts(map);
        }
    }

    function randomSaltHex() {
        var bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
    }

    async function sha256Hex(input) {
        if (!window.crypto || !window.crypto.subtle) {
            throw new Error(
                'JSQ_Auth: Web Crypto API is unavailable. Serve this app ' +
                'over http://localhost or https:// — not file://.'
            );
        }
        var buf = new TextEncoder().encode(input);
        var digest = await window.crypto.subtle.digest('SHA-256', buf);
        var view = new Uint8Array(digest);
        var hex = '';
        for (var i = 0; i < view.length; i++) {
            hex += view[i].toString(16).padStart(2, '0');
        }
        return hex;
    }

    function hashPassword(password, saltHex) {
        return sha256Hex(saltHex + ':' + password);
    }

    function newUserId() {
        return 'u_' + Date.now().toString(36) + '_' +
               Math.random().toString(36).slice(2, 10);
    }

    function validateUsername(name) {
        if (typeof name !== 'string') { throw new Error('Username is required.'); }
        name = name.trim();
        if (name.length < MIN_USERNAME_LEN) {
            throw new Error('Username must be at least ' + MIN_USERNAME_LEN + ' characters.');
        }
        if (name.length > MAX_USERNAME_LEN) {
            throw new Error('Username must be at most ' + MAX_USERNAME_LEN + ' characters.');
        }
        if (!USERNAME_RE.test(name)) {
            throw new Error('Username may only contain letters, numbers, underscore, and dash.');
        }
        return name;
    }

    function validatePassword(pw) {
        if (typeof pw !== 'string') { throw new Error('Password is required.'); }
        if (pw.length < MIN_PASSWORD_LEN) {
            throw new Error('Password must be at least ' + MIN_PASSWORD_LEN + ' characters.');
        }
        return pw;
    }

    function findUserByName(users, name) {
        var needle = name.trim().toLowerCase();
        for (var i = 0; i < users.length; i++) {
            if (users[i].username.toLowerCase() === needle) { return users[i]; }
        }
        return null;
    }

    function findUserById(users, id) {
        for (var i = 0; i < users.length; i++) {
            if (users[i].id === id) { return users[i]; }
        }
        return null;
    }

    // Includes `userId` as an alias of `id` for backward compatibility.
    // `counterChangedAt` is a timestamp bumped every time the counter
    // assignment changes — used by encoder.js to detect admin resets.
    function publicView(user) {
        return {
            id: user.id,
            userId: user.id,
            username: user.username,
            isAdmin: user.isAdmin === true,
            counter: user.counter || null,
            counterChangedAt: user.counterChangedAt || null,
            createdAt: user.createdAt
        };
    }

    function hasAnyUser() { return readUsers().length > 0; }

    function listUsers() { return readUsers().map(publicView); }

    function getUserById(id) {
        var user = findUserById(readUsers(), id);
        return user ? publicView(user) : null;
    }

    function getUserByUsername(name) {
        var user = findUserByName(readUsers(), name);
        return user ? publicView(user) : null;
    }

    async function createUser(opts) {
        opts = opts || {};
        var username = validateUsername(opts.username);
        var password = validatePassword(opts.password);
        var isAdmin  = opts.isAdmin === true;
        var counter  = opts.counter || null;

        var users = readUsers();
        if (findUserByName(users, username)) {
            throw new Error('That username is already taken.');
        }

        var salt = randomSaltHex();
        var hash = await hashPassword(password, salt);

        var user = {
            id: newUserId(),
            username: username,
            salt: salt,
            hash: hash,
            isAdmin: isAdmin,
            counter: counter,
            counterChangedAt: counter ? new Date().toISOString() : null,
            createdAt: new Date().toISOString()
        };
        users.push(user);
        writeUsers(users);
        return publicView(user);
    }

    async function login(username, password) {
        if (typeof username !== 'string' || typeof password !== 'string') {
            throw new Error('Invalid username or password.');
        }

        var remainingMs = getLockoutRemainingMs(username);
        if (remainingMs > 0) {
            throw new Error(
                'Too many failed attempts. Try again in ' +
                Math.ceil(remainingMs / 1000) + 's.'
            );
        }

        var users = readUsers();
        var user = findUserByName(users, username);

        if (!user) {
            recordFailedAttempt(username);
            throw new Error('Invalid username or password.');
        }

        var candidate = await hashPassword(password, user.salt);
        if (candidate !== user.hash) {
            recordFailedAttempt(username);
            throw new Error('Invalid username or password.');
        }

        clearAttempts(username);

        writeRawSession({
            userId: user.id,
            loggedInAt: new Date().toISOString()
        });

        return publicView(user);
    }

    function logout() { clearRawSession(); }

    function getSession() {
        var raw = readRawSession();
        if (!raw || !raw.userId) { return null; }

        var user = findUserById(readUsers(), raw.userId);
        if (!user) {
            clearRawSession();
            return null;
        }

        var view = publicView(user);
        view.loggedInAt = raw.loggedInAt || null;
        return view;
    }

    function isLoggedIn() { return getSession() !== null; }
    function isAdmin() {
        var s = getSession();
        return !!(s && s.isAdmin);
    }

    async function verifyPassword(userId, password) {
        if (typeof password !== 'string') { return false; }
        var users = readUsers();
        var user = findUserById(users, userId);
        if (!user) { return false; }
        var candidate = await hashPassword(password, user.salt);
        return candidate === user.hash;
    }

    async function changeOwnPassword(userId, oldPassword, newPassword) {
        validatePassword(newPassword);

        var users = readUsers();
        var user = findUserById(users, userId);
        if (!user) { throw new Error('Account not found.'); }

        var candidate = await hashPassword(oldPassword, user.salt);
        if (candidate !== user.hash) {
            throw new Error('Current password is incorrect.');
        }

        var newSalt = randomSaltHex();
        user.salt = newSalt;
        user.hash = await hashPassword(newPassword, newSalt);
        writeUsers(users);
    }

    async function adminResetPassword(userId, newPassword) {
        validatePassword(newPassword);

        var users = readUsers();
        var user = findUserById(users, userId);
        if (!user) { throw new Error('Account not found.'); }

        var newSalt = randomSaltHex();
        user.salt = newSalt;
        user.hash = await hashPassword(newPassword, newSalt);
        writeUsers(users);
    }

    function renameUser(userId, newUsername) {
        newUsername = validateUsername(newUsername);

        var users = readUsers();
        var user = findUserById(users, userId);
        if (!user) { throw new Error('Account not found.'); }

        var existing = findUserByName(users, newUsername);
        if (existing && existing.id !== userId) {
            throw new Error('That username is already taken.');
        }

        user.username = newUsername;
        writeUsers(users);
    }

    // Sets the counter and bumps counterChangedAt. The timestamp lets
    // the encoder page detect when the assignment was changed by admin,
    // so it can clear the user's local counter preference.
    function setUserCounter(userId, counterId) {
        var users = readUsers();
        var user = findUserById(users, userId);
        if (!user) { throw new Error('Account not found.'); }

        user.counter = counterId || null;
        user.counterChangedAt = new Date().toISOString();
        writeUsers(users);
        return publicView(user);
    }

    function setUserIsAdmin(userId, isAdmin) {
        var users = readUsers();
        var user = findUserById(users, userId);
        if (!user) { throw new Error('Account not found.'); }

        if (!isAdmin && user.isAdmin) {
            var adminCount = users.filter(function (u) { return u.isAdmin; }).length;
            if (adminCount <= 1) {
                throw new Error('Cannot remove admin from the last admin account.');
            }
        }

        user.isAdmin = isAdmin === true;
        writeUsers(users);
        return publicView(user);
    }

    function deleteUser(userId) {
        var users = readUsers();
        var user = findUserById(users, userId);
        if (!user) { throw new Error('Account not found.'); }

        var session = getSession();
        if (session && session.id === userId) {
            throw new Error('You cannot delete the account you are logged in as.');
        }

        if (user.isAdmin) {
            var adminCount = users.filter(function (u) { return u.isAdmin; }).length;
            if (adminCount <= 1) {
                throw new Error('Cannot delete the last admin account.');
            }
        }

        users = users.filter(function (u) { return u.id !== userId; });
        writeUsers(users);

        window.localStorage.removeItem(COUNTER_KEY_PREFIX + userId);
        window.localStorage.removeItem('jsq.encoder.counterChangedAt.' + userId);
    }

    window.JSQ_Auth = {
        hasAnyUser: hasAnyUser,
        listUsers: listUsers,
        getUserById: getUserById,
        getUserByUsername: getUserByUsername,
        createUser: createUser,
        login: login,
        logout: logout,
        getSession: getSession,
        isLoggedIn: isLoggedIn,
        isAdmin: isAdmin,
        verifyPassword: verifyPassword,
        changeOwnPassword: changeOwnPassword,
        adminResetPassword: adminResetPassword,
        renameUser: renameUser,
        setUserCounter: setUserCounter,
        setUserIsAdmin: setUserIsAdmin,
        deleteUser: deleteUser
    };

})(window);