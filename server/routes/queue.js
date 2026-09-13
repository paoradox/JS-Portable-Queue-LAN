/*
 * server/routes/queue.js — /api/queue/* endpoints.
 *
 * Authorization matches what the old app actually did, not a
 * hypothetical stricter version of it:
 *   - Reads (state/counters/logs) are PUBLIC. index.html (the public
 *     display board) has no login at all — it read jsq.queue and
 *     jsq.log straight out of localStorage before, so it must be able
 *     to read the same data from the server now.
 *   - "Issue next" and "set value" require a logged-in session — same
 *     as encoder.js, which only shows its counter controls once a
 *     counter operator has logged in.
 *   - Reset (single pool or all) and clearing the log are admin-only —
 *     those buttons only ever existed in admin.html, behind its
 *     "confirm your password" modal (still enforced client-side in
 *     Step 7-9; the server just adds a second real check here).
 *
 * Note on naming: OVERALL-TASK.md's suggested endpoint list includes
 * both /api/queue/issue and /api/queue/call as separate endpoints.
 * The actual queue.js never had two different actions here — "Call
 * Next" in encoder.html's UI calls the same issueNext() function as
 * everything else. So there's one /issue endpoint below, not two,
 * to match what the app actually does rather than inventing a second
 * action that doesn't exist in the original code.
 */

'use strict';

const express = require('express');
const queueService = require('../services/queueService');
const session = require('../middleware/session');

const router = express.Router();

function sendError(res, err) {
    res.status(400).json({ error: err.message || 'Something went wrong.' });
}

function actorFromSession(req) {
    if (!req.session) { return null; }
    return { userId: req.session.id, username: req.session.username };
}

// ---------------------------------------------------------------
// Reads — public, no login required
// ---------------------------------------------------------------

// GET /api/queue/state — full snapshot (pools + every counter).
router.get('/state', (req, res) => {
    res.json(queueService.getState());
});

// GET /api/queue/counters — just the counters, as an array.
router.get('/counters', (req, res) => {
    res.json({ counters: queueService.getAllCounters() });
});

// GET /api/queue/counters/:id — a single counter.
router.get('/counters/:id', (req, res) => {
    const counter = queueService.getCounter(req.params.id);
    if (!counter) {
        res.status(404).json({ error: 'Unknown counter.' });
        return;
    }
    res.json({ counter });
});

// GET /api/queue/logs — audit log, newest first, capped at 100.
router.get('/logs', (req, res) => {
    res.json({ logs: queueService.getLog() });
});

// ---------------------------------------------------------------
// Mutations — require a logged-in counter operator
// ---------------------------------------------------------------

// POST /api/queue/issue
// body: { counterId }
router.post('/issue', session.requireAuth, (req, res) => {
    try {
        const counter = queueService.issueNext(req.body.counterId, actorFromSession(req));
        res.json({ counter });
    } catch (err) {
        sendError(res, err);
    }
});

// POST /api/queue/update
// body: { counterId, value } — value is the raw typed string (e.g.
// "12" or "P12"); queueService.parseInput() validates it the same way
// the old client-side code did.
router.post('/update', session.requireAuth, (req, res) => {
    try {
        const counter = queueService.setCounterValue(
            req.body.counterId,
            req.body.value,
            actorFromSession(req)
        );
        res.json({ counter });
    } catch (err) {
        sendError(res, err);
    }
});

// ---------------------------------------------------------------
// Destructive, admin-only
// ---------------------------------------------------------------

// POST /api/queue/reset-pool
// body: { pool }
router.post('/reset-pool', session.requireAdmin, (req, res) => {
    try {
        queueService.resetPool(req.body.pool, actorFromSession(req));
        res.json({ ok: true });
    } catch (err) {
        sendError(res, err);
    }
});

// POST /api/queue/reset-all
router.post('/reset-all', session.requireAdmin, (req, res) => {
    queueService.resetAll(actorFromSession(req));
    res.json({ ok: true });
});

// POST /api/queue/logs/clear
router.post('/logs/clear', session.requireAdmin, (req, res) => {
    queueService.clearLog();
    res.json({ ok: true });
});

module.exports = router;
