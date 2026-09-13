/*
 * server/middleware/session.js — Reads the session cookie on every
 * request and figures out who (if anyone) is logged in.
 *
 * Cookie name: jsq_session. Its value is just the random token from
 * authService.newSessionToken() — meaningless without the sessions
 * table, so there's nothing to "crack" even if someone saw it.
 */

'use strict';

const authService = require('../services/authService');

const COOKIE_NAME = 'jsq_session';

// 30 days, in milliseconds. Old auth.js sessions had no fixed expiry
// (only cleared on logout) — a 30-day cookie mimics "stays logged in"
// behavior without living forever.
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// secure:false because this app is meant to run over plain http on a
// local network, not https. httpOnly:true means frontend JavaScript
// can never read this cookie directly — only the server can, which is
// what keeps the token safe from being stolen via an XSS bug.
function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: COOKIE_MAX_AGE_MS,
        path: '/'
    };
}

function setSessionCookie(res, token) {
    res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Runs on every request. Doesn't block anything by itself — it just
// makes req.session available (or null) so route handlers can check
// it. requireAuth/requireAdmin below are what actually block a route.
function attachSession(req, res, next) {
    const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
    req.sessionToken = token || null;
    req.session = token ? authService.getSessionUser(token) : null;
    next();
}

function requireAuth(req, res, next) {
    if (!req.session) {
        res.status(401).json({ error: 'Not logged in.' });
        return;
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session) {
        res.status(401).json({ error: 'Not logged in.' });
        return;
    }
    if (!req.session.isAdmin) {
        res.status(403).json({ error: 'Admin access required.' });
        return;
    }
    next();
}

module.exports = {
    COOKIE_NAME,
    setSessionCookie,
    clearSessionCookie,
    attachSession,
    requireAuth,
    requireAdmin
};
