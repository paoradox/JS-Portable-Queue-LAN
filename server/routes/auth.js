/*
 * server/routes/auth.js — /api/auth/* endpoints.
 *
 * Every handler here does the same three things: read the request,
 * call authService (the real logic), translate the result/error into
 * an HTTP response. No business rules live in this file on purpose —
 * that way authService can be reused (or tested) without needing a
 * running Express server.
 */

'use strict';

const express = require('express');
const authService = require('../services/authService');
const session = require('../middleware/session');

const router = express.Router();

// Small helper: authService throws plain Error objects with a
// human-readable .message (e.g. "Invalid username or password.").
// Those messages are already safe to show the user, so we just pass
// them straight through as a 400 response.
function sendError(res, err) {
    res.status(400).json({ error: err.message || 'Something went wrong.' });
}

// GET /api/auth/has-any-user
// Used by admin.html/encoder.html on boot to decide whether to show
// the normal login form or the first-run "create the first admin
// account" form — same check hasAnyUser() did client-side before.
router.get('/has-any-user', (req, res) => {
    res.json({ hasAnyUser: authService.hasAnyUser() });
});

// POST /api/auth/first-run-setup
// body: { username, password }
// Only works while there are zero users in the database. Creates the
// first account as an admin and logs it in immediately — mirrors the
// old admin.js first-run flow (createUser({isAdmin:true, ...}) then
// login()) as a single request instead of two.
router.post('/first-run-setup', (req, res) => {
    if (authService.hasAnyUser()) {
        res.status(400).json({ error: 'Setup has already been completed.' });
        return;
    }
    try {
        authService.createUser({
            username: req.body.username,
            password: req.body.password,
            isAdmin: true
        });
        const { user, token } = authService.login(req.body.username, req.body.password);
        session.setSessionCookie(res, token);
        res.json({ user });
    } catch (err) {
        sendError(res, err);
    }
});

// POST /api/auth/login
// body: { username, password }
router.post('/login', (req, res) => {
    try {
        const { user, token } = authService.login(req.body.username, req.body.password);
        session.setSessionCookie(res, token);
        res.json({ user });
    } catch (err) {
        sendError(res, err);
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    authService.logout(req.sessionToken);
    session.clearSessionCookie(res);
    res.json({ ok: true });
});

// GET /api/auth/session
// Never errors — returns { user: null } if nobody is logged in, same
// as the old getSession() returning null instead of throwing.
router.get('/session', (req, res) => {
    res.json({ user: req.session || null });
});

// POST /api/auth/change-password
// body: { oldPassword, newPassword }
router.post('/change-password', session.requireAuth, (req, res) => {
    try {
        authService.changeOwnPassword(req.session.id, req.body.oldPassword, req.body.newPassword);
        res.json({ ok: true });
    } catch (err) {
        sendError(res, err);
    }
});

// POST /api/auth/verify-password
// body: { password }
// Used by admin.html's "confirm your password" modal before sensitive
// actions — same purpose as the old client-side verifyPassword().
router.post('/verify-password', session.requireAuth, (req, res) => {
    const valid = authService.verifyPassword(req.session.id, req.body.password);
    res.json({ valid });
});

// PATCH /api/auth/counter
// body: { counter }
// Self-service only — always targets the logged-in session's own
// account (req.session.id), never a URL param, so a non-admin encoder
// operator can pick their own counter (encoder.js's normal flow) but
// can never touch anyone else's. Admin edits to OTHER users' counters
// still go through the admin-only PATCH /api/users/:id route.
router.patch('/counter', session.requireAuth, (req, res) => {
    try {
        const user = authService.setUserCounter(req.session.id, req.body.counter);
        res.json({ user });
    } catch (err) {
        sendError(res, err);
    }
});

module.exports = router;
