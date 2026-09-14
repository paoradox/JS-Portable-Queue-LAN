/*
 * server/routes/users.js — /api/users/* endpoints.
 *
 * Everything here is admin-only, EXCEPT one narrow, deliberate
 * exception on POST / (create account): if no user exists in the
 * database at all yet, that one call is allowed without being logged
 * in, and always creates an admin account, regardless of what the
 * request body says.
 *
 * Why: the ORIGINAL admin.js bootstrapped the very first admin by
 * calling createUser({ isAdmin: true, ... }) and then login() as two
 * separate steps — there was no session yet at that point, since
 * there was no user to log in as. Requiring an admin session on every
 * POST / call (a version I wrote and then caught while testing Step 7)
 * would have permanently broken that exact flow. This keeps it
 * working exactly as it did before, with the bootstrap window closing
 * itself the instant the first account exists — every call after that
 * requires a real admin session, same as every other route below.
 */

'use strict';

const express = require('express');
const authService = require('../services/authService');
const session = require('../middleware/session');

const router = express.Router();

function sendError(res, err) {
    res.status(400).json({ error: err.message || 'Something went wrong.' });
}

function doCreateUser(req, res, forceAdmin) {
    try {
        const user = authService.createUser({
            username: req.body.username,
            password: req.body.password,
            isAdmin: forceAdmin ? true : req.body.isAdmin === true,
            counter: req.body.counter || null
        });
        res.json({ user });
    } catch (err) {
        sendError(res, err);
    }
}

// POST /api/users — create a new account.
// body: { username, password, isAdmin, counter }
router.post('/', (req, res) => {
    if (!authService.hasAnyUser()) {
        // Bootstrap case — see file header. No session exists yet,
        // and none is required; the new account is always an admin.
        doCreateUser(req, res, true);
        return;
    }
    // Normal case — requires an admin session, same as every other
    // route in this file.
    session.requireAdmin(req, res, () => doCreateUser(req, res, false));
});

// Every route below always requires an admin session — there's no
// bootstrap exception for any of these, only for creating the very
// first account above.
router.use(session.requireAdmin);

// GET /api/users — list every account (admin.js's user table).
router.get('/', (req, res) => {
    res.json({ users: authService.listUsers() });
});

// GET /api/users/:id — a single account (admin.js's edit-user modal).
router.get('/:id', (req, res) => {
    const user = authService.getUserById(req.params.id);
    if (!user) {
        res.status(404).json({ error: 'Account not found.' });
        return;
    }
    res.json({ user });
});

// PATCH /api/users/:id — edit username / counter / admin flag.
// body: any of { username, counter, isAdmin } — only the fields
// present are changed, matching admin.js's single "edit user" form
// that lets you change any combination of the three at once.
router.patch('/:id', (req, res) => {
    try {
        let user = null;
        if (typeof req.body.username === 'string') {
            user = authService.renameUser(req.params.id, req.body.username);
        }
        if ('counter' in req.body) {
            user = authService.setUserCounter(req.params.id, req.body.counter);
        }
        if (typeof req.body.isAdmin === 'boolean') {
            user = authService.setUserIsAdmin(req.params.id, req.body.isAdmin);
        }
        res.json({ user: user || authService.getUserById(req.params.id) });
    } catch (err) {
        sendError(res, err);
    }
});

// POST /api/users/:id/reset-password — admin resets someone's password.
// body: { newPassword }
router.post('/:id/reset-password', (req, res) => {
    try {
        authService.adminResetPassword(req.params.id, req.body.newPassword);
        res.json({ ok: true });
    } catch (err) {
        sendError(res, err);
    }
});

// DELETE /api/users/:id — remove an account.
router.delete('/:id', (req, res) => {
    try {
        authService.deleteUser(req.params.id, req.session.id);
        res.json({ ok: true });
    } catch (err) {
        sendError(res, err);
    }
});

module.exports = router;
