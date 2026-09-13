/*
 * server/services/queueService.js — Queue business logic.
 *
 * This is the server-side replacement for the old queue.js's read/write
 * logic (jsq.queue, jsq.log). Every rule is preserved exactly:
 *   - Regular pool numbers are plain integers, PWD gets a "P" prefix,
 *     ESCAL gets an "E" prefix (POOLS, seeded in Step 2).
 *   - "Issue next" increments that counter's pool, independently of
 *     any other pool.
 *   - Manually setting a counter's value accepts the same input format
 *     as before — typing "P12" for the PWD counter still works, so
 *     does typing "12" (the prefix is optional on input).
 *   - The audit log keeps only the most recent 100 entries, newest
 *     first — identical cap and ordering to the old jsq.log.
 *
 * Like authService.js, this file has no Express code in it — routes
 * live in server/routes/queue.js and just translate these results
 * into HTTP responses.
 */

'use strict';

const { db, POOLS, COUNTERS } = require('../db');

const LOG_MAX = 100;

const POOL_BY_NAME = {};
POOLS.forEach((p) => { POOL_BY_NAME[p.name] = p; });

function findCounterMeta(id) {
    return COUNTERS.find((c) => c.id === id) || null;
}

// ---------------------------------------------------------------
// Formatting / parsing (identical rules to the old queue.js)
// ---------------------------------------------------------------

function formatValue(counterId, value) {
    const meta = findCounterMeta(counterId);
    if (!meta) { return ''; }
    const prefix = POOL_BY_NAME[meta.pool].prefix;
    if (value === null || value === undefined) {
        return prefix ? prefix + '\u2014' : '\u2014';
    }
    return prefix + value;
}

// Accepts "12", "p12", or "P12" for a PWD counter (the prefix is
// optional and case-insensitive on input) — same as the old
// client-side parseInput().
function parseInput(counterId, rawInput) {
    const meta = findCounterMeta(counterId);
    if (!meta) { throw new Error('Unknown counter.'); }

    let s = String(rawInput == null ? '' : rawInput).trim();
    if (!s) { throw new Error('Enter a number.'); }

    const prefix = POOL_BY_NAME[meta.pool].prefix;
    if (prefix && s.charAt(0).toUpperCase() === prefix.toUpperCase()) {
        s = s.slice(1).trim();
    }

    if (!/^\d+$/.test(s)) { throw new Error('Enter a whole number.'); }
    const n = parseInt(s, 10);
    if (n < 1) { throw new Error('Number must be at least 1.'); }
    return n;
}

// ---------------------------------------------------------------
// Reads
// ---------------------------------------------------------------

function counterView(meta) {
    const row = db.prepare('SELECT * FROM queue_counters WHERE id = ?').get(meta.id);
    return {
        id: meta.id,
        label: meta.label,
        pool: meta.pool,
        prefix: POOL_BY_NAME[meta.pool].prefix,
        value: row.value,
        display: formatValue(meta.id, row.value),
        updatedAt: row.updated_at,
        updatedBy: row.updated_by
    };
}

function getCounter(id) {
    const meta = findCounterMeta(id);
    return meta ? counterView(meta) : null;
}

function getAllCounters() {
    return COUNTERS.map(counterView);
}

function getPoolSummary(poolName) {
    const pool = POOL_BY_NAME[poolName];
    if (!pool) { return null; }
    const row = db.prepare('SELECT last_issued FROM queue_pools WHERE name = ?').get(poolName);
    return { pool: poolName, prefix: pool.prefix, lastIssued: row.last_issued };
}

// Full snapshot — used by the frontend (Step 6) to fill its local
// cache once on page load, then kept fresh after that by Socket.IO
// "queueUpdated" events instead of re-fetching this on every read.
function getState() {
    const pools = {};
    POOLS.forEach((p) => {
        const row = db.prepare('SELECT last_issued FROM queue_pools WHERE name = ?').get(p.name);
        pools[p.name] = { prefix: p.prefix, lastIssued: row.last_issued };
    });
    return { pools, counters: getAllCounters() };
}

// ---------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------

// "extra" fields (counterId, pool, value, etc.) are stored as one JSON
// string per row, then flattened back out in getLog() so the frontend
// sees the exact same flat shape it always has: entry.counterId,
// entry.pool, entry.value at the top level, not nested.
function appendLog(action, actor, extra) {
    const ts = new Date().toISOString();
    db.prepare(
        'INSERT INTO queue_logs (ts, action, user_id, username, extra) VALUES (?, ?, ?, ?, ?)'
    ).run(ts, action, actor ? actor.userId : null, actor ? actor.username : null, JSON.stringify(extra || {}));

    // Same 100-entry cap as the old jsq.log — trim the oldest rows
    // past that, every time a new one is added.
    const countRow = db.prepare('SELECT COUNT(*) AS n FROM queue_logs').get();
    if (countRow.n > LOG_MAX) {
        db.prepare(
            'DELETE FROM queue_logs WHERE id IN ' +
            '(SELECT id FROM queue_logs ORDER BY id ASC LIMIT ?)'
        ).run(countRow.n - LOG_MAX);
    }
}

function getLog() {
    const rows = db.prepare('SELECT * FROM queue_logs ORDER BY id DESC').all();
    return rows.map((row) => {
        let extra = {};
        try { extra = JSON.parse(row.extra || '{}'); } catch (e) { extra = {}; }
        return Object.assign(
            { ts: row.ts, action: row.action, userId: row.user_id, username: row.username },
            extra
        );
    });
}

function clearLog() {
    db.exec('DELETE FROM queue_logs');
}

// ---------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------

function issueNext(counterId, actor) {
    const meta = findCounterMeta(counterId);
    if (!meta) { throw new Error('Unknown counter.'); }

    const poolRow = db.prepare('SELECT last_issued FROM queue_pools WHERE name = ?').get(meta.pool);
    const next = poolRow.last_issued + 1;
    const now = new Date().toISOString();

    db.exec('BEGIN');
    try {
        db.prepare('UPDATE queue_pools SET last_issued = ? WHERE name = ?').run(next, meta.pool);
        db.prepare(
            'UPDATE queue_counters SET value = ?, updated_at = ?, updated_by = ? WHERE id = ?'
        ).run(next, now, actor ? actor.userId : null, counterId);
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }

    appendLog('issue', actor, { counterId, pool: meta.pool, value: next });
    return getCounter(counterId);
}

function setCounterValue(counterId, rawInput, actor) {
    const meta = findCounterMeta(counterId);
    if (!meta) { throw new Error('Unknown counter.'); }

    const n = parseInput(counterId, rawInput);
    const now = new Date().toISOString();

    db.prepare(
        'UPDATE queue_counters SET value = ?, updated_at = ?, updated_by = ? WHERE id = ?'
    ).run(n, now, actor ? actor.userId : null, counterId);

    appendLog('set', actor, { counterId, pool: meta.pool, value: n });
    return getCounter(counterId);
}

function resetPool(poolName, actor) {
    if (!POOL_BY_NAME[poolName]) { throw new Error('Unknown pool.'); }

    const now = new Date().toISOString();
    const actorId = actor ? actor.userId : null;

    db.exec('BEGIN');
    try {
        db.prepare('UPDATE queue_pools SET last_issued = 0 WHERE name = ?').run(poolName);
        COUNTERS.filter((c) => c.pool === poolName).forEach((c) => {
            db.prepare(
                'UPDATE queue_counters SET value = NULL, updated_at = ?, updated_by = ? WHERE id = ?'
            ).run(now, actorId, c.id);
        });
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }

    appendLog('resetPool', actor, { pool: poolName });
}

function resetAll(actor) {
    const now = new Date().toISOString();
    const actorId = actor ? actor.userId : null;

    db.exec('BEGIN');
    try {
        POOLS.forEach((p) => {
            db.prepare('UPDATE queue_pools SET last_issued = 0 WHERE name = ?').run(p.name);
        });
        COUNTERS.forEach((c) => {
            db.prepare(
                'UPDATE queue_counters SET value = NULL, updated_at = ?, updated_by = ? WHERE id = ?'
            ).run(now, actorId, c.id);
        });
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }

    appendLog('resetAll', actor, {});
}

module.exports = {
    POOLS,
    COUNTERS,
    getState,
    getCounter,
    getAllCounters,
    getPoolSummary,
    formatValue,
    parseInput,
    issueNext,
    setCounterValue,
    resetPool,
    resetAll,
    getLog,
    clearLog
};
