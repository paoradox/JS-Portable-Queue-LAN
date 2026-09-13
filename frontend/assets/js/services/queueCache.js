/*
 * queueCache.js — Frontend queue/log cache, backed by the
 * /api/queue/* REST endpoints for reads/writes and Socket.IO's
 * 'queueUpdated' event for live sync, instead of localStorage +
 * window.storage events.
 *
 * Public API: window.JSQ_QueueService
 *
 * Not wired into window.JSQ_Queue yet — that swap is Step 8. This
 * file sits alongside the old queue.js, unused, until then.
 *
 * Why reads stay synchronous: ui.js's renderBoard(), display.js, and
 * admin.js all call getAllCounters()/getCounter()/getLog() directly,
 * with no .then()/await anywhere. Keeping those synchronous against
 * an in-memory cache — refreshed automatically by Socket.IO — means
 * none of that rendering code has to change in Step 9. Call init()
 * once at page boot to fill the cache before relying on it; after
 * that, onChange() fires the same way the old onChange() did any time
 * the data changes, whether the change happened in this tab or
 * another device entirely.
 *
 * Why mutations dropped their `actor` parameter: the old
 * issueNext(counterId, actor) / setCounterValue(id, raw, actor) took
 * an actor object the CALLER built (from whatever it considered "the
 * logged-in user" at the time). The server no longer trusts that —
 * it reads the actor from the session cookie itself. That's both
 * simpler here and safer server-side (a caller can't claim to be
 * someone else). Step 9 will remove the now-unused currentActor()/
 * getActor() arguments at each call site.
 */
(function (window) {
    'use strict';

    const api = window.JSQ_ApiClient;

    // Static layout — identical to the old queue.js's POOLS/COUNTERS
    // and to server/db/index.js's copy of the same data. This never
    // changes at runtime, so it's safe to hardcode here for instant,
    // synchronous access before init() has even resolved (admin.js
    // reads window.JSQ_Queue.COUNTERS this way today).
    const POOLS = {
        c:     { prefix: '' },
        pwd:   { prefix: 'P' },
        escal: { prefix: 'E' }
    };

    const COUNTERS = [
        { id: 'c1',    label: 'C1',    pool: 'c'     },
        { id: 'c2',    label: 'C2',    pool: 'c'     },
        { id: 'c3',    label: 'C3',    pool: 'c'     },
        { id: 'c4',    label: 'C4',    pool: 'c'     },
        { id: 'c5',    label: 'C5',    pool: 'c'     },
        { id: 'c6',    label: 'C6',    pool: 'c'     },
        { id: 'pwd',   label: 'PWD',   pool: 'pwd'   },
        { id: 'escal', label: 'ESCAL', pool: 'escal' }
    ];

    const cache = { state: null, logs: [] };
    const subscribers = [];
    let socket = null;

    function notify() {
        subscribers.slice().forEach((cb) => {
            try { cb(); } catch (e) { console.error('JSQ_QueueService subscriber:', e); }
        });
    }

    function applyPayload(payload) {
        cache.state = payload.state;
        cache.logs = payload.logs;
        notify();
    }

    function ensureSocket() {
        if (socket) { return socket; }
        if (typeof window.io !== 'function') {
            throw new Error(
                'JSQ_QueueService: the Socket.IO client script is missing from this page ' +
                '(expected <script src="/socket.io/socket.io.js"> before queueCache.js).'
            );
        }
        socket = window.io();
        socket.on('queueUpdated', applyPayload);
        return socket;
    }

    // Call once at page boot. Fetches the current snapshot via REST
    // immediately (so the very first render has real data without
    // waiting on a socket handshake), then keeps the cache fresh from
    // that point on via Socket.IO — including changes made from other
    // devices entirely.
    function init() {
        ensureSocket();
        return Promise.all([
            api.get('/api/queue/state'),
            api.get('/api/queue/logs')
        ]).then(([state, logsRes]) => {
            cache.state = state;
            cache.logs = logsRes.logs;
        });
    }

    // ---------------------------------------------------------------
    // Synchronous reads
    // ---------------------------------------------------------------

    function getState() {
        return cache.state ? JSON.parse(JSON.stringify(cache.state)) : { pools: {}, counters: [] };
    }

    function getCounter(id) {
        if (!cache.state) { return null; }
        return cache.state.counters.find((c) => c.id === id) || null;
    }

    function getAllCounters() {
        return cache.state ? cache.state.counters.slice() : [];
    }

    function getPoolSummary(poolName) {
        if (!cache.state || !cache.state.pools[poolName]) { return null; }
        const p = cache.state.pools[poolName];
        return { pool: poolName, prefix: p.prefix, lastIssued: p.lastIssued };
    }

    function getLog() {
        return cache.logs.slice();
    }

    function onChange(callback) {
        if (typeof callback !== 'function') { return () => {}; }
        subscribers.push(callback);
        return () => {
            const i = subscribers.indexOf(callback);
            if (i > -1) { subscribers.splice(i, 1); }
        };
    }

    // ---------------------------------------------------------------
    // Mutations (async; see file header re: dropped `actor` param)
    // ---------------------------------------------------------------

    function issueNext(counterId) {
        return api.post('/api/queue/issue', { counterId }).then((res) => res.counter);
    }

    function setCounterValue(counterId, rawInput) {
        return api.post('/api/queue/update', { counterId, value: rawInput }).then((res) => res.counter);
    }

    function resetPool(poolName) {
        return api.post('/api/queue/reset-pool', { pool: poolName });
    }

    function resetAll() {
        return api.post('/api/queue/reset-all', {});
    }

    function clearLog() {
        return api.post('/api/queue/logs/clear', {});
    }

    window.JSQ_QueueService = {
        POOLS,
        COUNTERS,

        init,
        getState,
        getCounter,
        getAllCounters,
        getPoolSummary,
        getLog,
        onChange,

        issueNext,
        setCounterValue,
        resetPool,
        resetAll,
        clearLog
    };

})(window);
