/*
 * server/services/authService.js — Auth business logic.
 *
 * This is the server-side replacement for the read/write logic that
 * used to live in the browser's auth.js (jsq.users, jsq.session,
 * jsq.loginAttempts). Every rule from the old file is preserved:
 *   - Same username/password validation rules.
 *   - Same login lockout behavior (5 failed attempts -> 30s lockout).
 *   - Same "can't remove/delete the last admin" guard.
 *
 * What's different, and why:
 *   - Passwords are hashed with bcrypt (via bcryptjs) instead of the
 *     browser doing SHA-256 client-side. Hashing now happens on the
 *     server, which is the whole point of moving auth off the client.
 *   - A session is no longer "the one session this browser has" — it's
 *     a row in the `sessions` table, looked up by a random token sent
 *     in an httpOnly cookie. Multiple devices can each hold their own
 *     valid session at the same time.
 *
 * This file has no Express code in it (no req/res) — server/routes/
 * auth.js and users.js call these functions and translate the results
 * into HTTP responses. Keeping them separate means the login/queue
 * rules can be tested or reused without needing a running web server.
 */

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 20;
const MIN_PASSWORD_LEN = 6;
const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

// Same lockout numbers as the old auth.js: 5 failed attempts locks
// that username out for 30 seconds.
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 30000;

// bcrypt's "cost factor" — how many rounds of hashing it does. 10 is
// bcrypt's own recommended default: strong enough, fast enough that a
// login doesn't feel slow.
const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------
// Validation (identical rules to the old auth.js)
// ---------------------------------------------------------------

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

function newUserId() {
    return 'u_' + Date.now().toString(36) + '_' +
           Math.random().toString(36).slice(2, 10);
}

// A session token is just a long random string — not a JWT, not
// signed with any secret. It's meaningless on its own; it only works
// because the server looks it up in the `sessions` table. That's why
// this migration doesn't need a session-signing secret.
function newSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------
// Row lookups
// ---------------------------------------------------------------

function findUserRowByUsername(username) {
    return db.prepare(
        'SELECT * FROM users WHERE LOWER(username) = LOWER(?)'
    ).get(String(username || '').trim());
}

function findUserRowById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Same shape the frontend already expects from auth.js's publicView():
// id, userId (alias of id), username, isAdmin, counter,
// counterChangedAt, createdAt. Never includes password_hash.
function publicView(row) {
    if (!row) { return null; }
    return {
        id: row.id,
        userId: row.id,
        username: row.username,
        isAdmin: row.is_admin === 1,
        counter: row.counter || null,
        counterChangedAt: row.counter_changed_at || null,
        createdAt: row.created_at
    };
}

// ---------------------------------------------------------------
// Login attempt tracking (lockout) — same rules as old auth.js
// ---------------------------------------------------------------

function attemptKey(username) {
    return String(username || '').trim().toLowerCase();
}

function getLockoutRemainingMs(username) {
    const row = db.prepare(
        'SELECT locked_until FROM login_attempts WHERE username = ?'
    ).get(attemptKey(username));
    if (!row || !row.locked_until) { return 0; }
    const remaining = row.locked_until - Date.now();
    return remaining > 0 ? remaining : 0;
}

function recordFailedAttempt(username) {
    const key = attemptKey(username);
    const existing = db.prepare(
        'SELECT count, locked_until FROM login_attempts WHERE username = ?'
    ).get(key);

    let count = existing ? existing.count : 0;
    let lockedUntil = existing ? existing.locked_until : null;

    // A previous lockout that already expired starts fresh, same as
    // the old client-side logic.
    if (lockedUntil && lockedUntil <= Date.now()) {
        count = 0;
        lockedUntil = null;
    }

    count += 1;
    if (count >= MAX_LOGIN_ATTEMPTS) {
        lockedUntil = Date.now() + LOCKOUT_MS;
        count = 0;
    }

    db.prepare(
        'INSERT INTO login_attempts (username, count, locked_until) VALUES (?, ?, ?) ' +
        'ON CONFLICT(username) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until'
    ).run(key, count, lockedUntil);
}

function clearAttempts(username) {
    db.prepare('DELETE FROM login_attempts WHERE username = ?').run(attemptKey(username));
}

// ---------------------------------------------------------------
// Users
// ---------------------------------------------------------------

function hasAnyUser() {
    const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
    return row.n > 0;
}

function listUsers() {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
    return rows.map(publicView);
}

function getUserById(id) {
    return publicView(findUserRowById(id));
}

function getUserByUsername(name) {
    return publicView(findUserRowByUsername(name));
}

function createUser(opts) {
    opts = opts || {};
    const username = validateUsername(opts.username);
    const password = validatePassword(opts.password);
    const isAdmin = opts.isAdmin === true;
    const counter = opts.counter || null;

    if (findUserRowByUsername(username)) {
        throw new Error('That username is already taken.');
    }

    const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const id = newUserId();
    const createdAt = new Date().toISOString();
    const counterChangedAt = counter ? createdAt : null;

    db.prepare(
        'INSERT INTO users (id, username, password_hash, is_admin, counter, counter_changed_at, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, username, passwordHash, isAdmin ? 1 : 0, counter, counterChangedAt, createdAt);

    return publicView(findUserRowById(id));
}

// ---------------------------------------------------------------
// Login / session
// ---------------------------------------------------------------

// Returns { user, token } on success. Throws on bad credentials or
// lockout — same error messages as the old auth.js so any frontend
// code that shows err.message doesn't need to change.
function login(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') {
        throw new Error('Invalid username or password.');
    }

    const remainingMs = getLockoutRemainingMs(username);
    if (remainingMs > 0) {
        throw new Error(
            'Too many failed attempts. Try again in ' +
            Math.ceil(remainingMs / 1000) + 's.'
        );
    }

    const row = findUserRowByUsername(username);
    if (!row) {
        recordFailedAttempt(username);
        throw new Error('Invalid username or password.');
    }

    const valid = bcrypt.compareSync(password, row.password_hash);
    if (!valid) {
        recordFailedAttempt(username);
        throw new Error('Invalid username or password.');
    }

    clearAttempts(username);

    // New login wins: any session(s) this user already had elsewhere are
    // invalidated. The other device finds out on its next request (any
    // authenticated call there will start failing with 401 "Not logged
    // in.") — the frontend's apiClient.js watches for that and redirects
    // back to the login screen automatically.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);

    const token = newSessionToken();
    const loggedInAt = new Date().toISOString();
    db.prepare(
        'INSERT INTO sessions (token, user_id, logged_in_at) VALUES (?, ?, ?)'
    ).run(token, row.id, loggedInAt);

    const user = publicView(row);
    user.loggedInAt = loggedInAt;
    return { user, token };
}

function logout(token) {
    if (!token) { return; }
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Returns the public user view (with loggedInAt attached) for a valid
// session token, or null if the token is missing/unknown/stale.
function getSessionUser(token) {
    if (!token) { return null; }

    const row = db.prepare(
        'SELECT sessions.logged_in_at AS logged_in_at, users.* ' +
        'FROM sessions JOIN users ON users.id = sessions.user_id ' +
        'WHERE sessions.token = ?'
    ).get(token);

    if (!row) { return null; }

    const user = publicView(row);
    user.loggedInAt = row.logged_in_at;
    return user;
}

function verifyPassword(userId, password) {
    if (typeof password !== 'string') { return false; }
    const row = findUserRowById(userId);
    if (!row) { return false; }
    return bcrypt.compareSync(password, row.password_hash);
}

function changeOwnPassword(userId, oldPassword, newPassword) {
    validatePassword(newPassword);

    const row = findUserRowById(userId);
    if (!row) { throw new Error('Account not found.'); }

    if (!bcrypt.compareSync(oldPassword, row.password_hash)) {
        throw new Error('Current password is incorrect.');
    }

    const newHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
}

function adminResetPassword(userId, newPassword) {
    validatePassword(newPassword);

    const row = findUserRowById(userId);
    if (!row) { throw new Error('Account not found.'); }

    const newHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
}

function renameUser(userId, newUsername) {
    newUsername = validateUsername(newUsername);

    const row = findUserRowById(userId);
    if (!row) { throw new Error('Account not found.'); }

    const existing = findUserRowByUsername(newUsername);
    if (existing && existing.id !== userId) {
        throw new Error('That username is already taken.');
    }

    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, userId);
    return publicView(findUserRowById(userId));
}

// Sets the counter and bumps counter_changed_at, same as old auth.js —
// encoder.js (Step 8/9) uses this timestamp to detect an admin-driven
// reassignment and clear its own cached counter choice.
function setUserCounter(userId, counterId) {
    const row = findUserRowById(userId);
    if (!row) { throw new Error('Account not found.'); }

    const now = new Date().toISOString();
    db.prepare(
        'UPDATE users SET counter = ?, counter_changed_at = ? WHERE id = ?'
    ).run(counterId || null, now, userId);

    return publicView(findUserRowById(userId));
}

function setUserIsAdmin(userId, isAdmin) {
    const row = findUserRowById(userId);
    if (!row) { throw new Error('Account not found.'); }

    if (!isAdmin && row.is_admin === 1) {
        const adminCount = db.prepare(
            'SELECT COUNT(*) AS n FROM users WHERE is_admin = 1'
        ).get().n;
        if (adminCount <= 1) {
            throw new Error('Cannot remove admin from the last admin account.');
        }
    }

    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?')
        .run(isAdmin === true ? 1 : 0, userId);

    return publicView(findUserRowById(userId));
}

// requestingUserId is whoever is logged in and making this call — used
// for the "you can't delete the account you're logged in as" guard,
// same as the old auth.js checked against its own getSession().
function deleteUser(userId, requestingUserId) {
    const row = findUserRowById(userId);
    if (!row) { throw new Error('Account not found.'); }

    if (requestingUserId && requestingUserId === userId) {
        throw new Error('You cannot delete the account you are logged in as.');
    }

    if (row.is_admin === 1) {
        const adminCount = db.prepare(
            'SELECT COUNT(*) AS n FROM users WHERE is_admin = 1'
        ).get().n;
        if (adminCount <= 1) {
            throw new Error('Cannot delete the last admin account.');
        }
    }

    // Foreign keys are ON (see server/db/index.js), so this also
    // deletes any of this user's rows in `sessions` automatically.
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

module.exports = {
    hasAnyUser,
    listUsers,
    getUserById,
    getUserByUsername,
    createUser,
    login,
    logout,
    getSessionUser,
    verifyPassword,
    changeOwnPassword,
    adminResetPassword,
    renameUser,
    setUserCounter,
    setUserIsAdmin,
    deleteUser
};
