/*
 * server/routes/users.js — /api/users/* endpoints.
 *
 * Everything here is admin-only (session.requireAdmin on every route)
 * because these are exactly the actions admin.js used to perform
 * directly against JSQ_Auth: creating accounts, renaming, assigning a
 * counter, granting/revoking admin, resetting a password, deleting an
 * account.
 */

'use strict';

const express = require('express');
const authService = require('../services/authService');
const session = require('../middleware/session');

const router = express.Router();

function sendError(res, err) {
    res.status(400).json({ error: err.message || 'Something went wrong.' });
}

router.use(session.requireAdmin);

// GET /api/users — list every account (admin.js's user table).
router.get('/', (req, res) => {
    res.json({ users: authService.listUsers() });
});

// POST /api/users — create a new account.
// body: { username, password, isAdmin, counter }
router.post('/', (req, res) => {
    try {
        const user = authService.createUser({
            username: req.body.username,
            password: req.body.password,
            isAdmin: req.body.isAdmin === true,
            counter: req.body.counter || null
        });
        res.json({ user });
    } catch (err) {
        sendError(res, err);
    }
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
