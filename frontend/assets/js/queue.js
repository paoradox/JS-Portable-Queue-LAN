/*
 * queue.js � Queue system data module
 *
 * Public API: window.JSQ_Queue
 *
 * Storage:
 *   jsq.queue ? { pools: { c, pwd, escal }, counters: { c1..c6, pwd, escal } }
 *   jsq.log   ? [ { ts, action, userId, username, ... }, ... ]  (cap 100)
 */
(function (window) {
    'use strict';

    var STATE_KEY = 'jsq.queue';
    var LOG_KEY   = 'jsq.log';
    var LOG_MAX   = 100;

    var POOLS = {
        c:     { prefix: ''  },
        pwd:   { prefix: 'P' },
        escal: { prefix: 'E' }
    };

    var COUNTERS = [
        { id: 'c1',    label: 'C1',    pool: 'c'     },
        { id: 'c2',    label: 'C2',    pool: 'c'     },
        { id: 'c3',    label: 'C3',    pool: 'c'     },
        { id: 'c4',    label: 'C4',    pool: 'c'     },
        { id: 'c5',    label: 'C5',    pool: 'c'     },
        { id: 'c6',    label: 'C6',    pool: 'c'     },
        { id: 'pwd',   label: 'PWD',   pool: 'pwd'   },
        { id: 'escal', label: 'ESCAL', pool: 'escal' }
    ];

    function emptyState() {
        var state = { pools: {}, counters: {} };
        Object.keys(POOLS).forEach(function (p) {
            state.pools[p] = { lastIssued: 0 };
        });
        COUNTERS.forEach(function (c) {
            state.counters[c.id] = {
                value: null,
                updatedAt: null,
                updatedBy: null
            };
        });
        return state;
    }

    function readState() {
        var raw = window.localStorage.getItem(STATE_KEY);
        if (!raw) { return emptyState(); }

        var parsed;
        try { parsed = JSON.parse(raw); }
        catch (e) {
            console.warn('JSQ_Queue: jsq.queue corrupted, resetting.');
            return emptyState();
        }
        if (!parsed || typeof parsed !== 'object') { return emptyState(); }

        var base = emptyState();
        if (parsed.pools) {
            Object.keys(parsed.pools).forEach(function (k) {
                if (base.pools[k]) { base.pools[k] = parsed.pools[k]; }
            });
        }
        if (parsed.counters) {
            Object.keys(parsed.counters).forEach(function (k) {
                if (base.counters[k]) { base.counters[k] = parsed.counters[k]; }
            });
        }
        return base;
    }

    function writeState(state) {
        window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
        notifyChange();
    }

    function readLog() {
        var raw = window.localStorage.getItem(LOG_KEY);
        if (!raw) { return []; }
        try {
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }

    function appendLog(entry) {
        var log = readLog();
        log.push(entry);
        if (log.length > LOG_MAX) {
            log = log.slice(log.length - LOG_MAX);
        }
        window.localStorage.setItem(LOG_KEY, JSON.stringify(log));
    }

    function makeLogEntry(action, actor, extra) {
        var entry = {
            ts: new Date().toISOString(),
            action: action,
            userId: actor ? actor.userId : null,
            username: actor ? actor.username : null
        };
        if (extra) {
            Object.keys(extra).forEach(function (k) { entry[k] = extra[k]; });
        }
        return entry;
    }

    var subscribers = [];

    function notifyChange() {
        subscribers.slice().forEach(function (cb) {
            try { cb(); } catch (e) { console.error('JSQ_Queue subscriber:', e); }
        });
    }

    window.addEventListener('storage', function (e) {
        if (e.key === STATE_KEY) { notifyChange(); }
    });

    function findCounterMeta(id) {
        for (var i = 0; i < COUNTERS.length; i++) {
            if (COUNTERS[i].id === id) { return COUNTERS[i]; }
        }
        return null;
    }

    function formatValue(counterId, value) {
        var meta = findCounterMeta(counterId);
        if (!meta) { return ''; }
        var prefix = POOLS[meta.pool].prefix;
        if (value === null || value === undefined) {
            return prefix ? prefix + '\u2014' : '\u2014';
        }
        return prefix + value;
    }

    function counterView(meta, counterState) {
        return {
            id: meta.id,
            label: meta.label,
            pool: meta.pool,
            prefix: POOLS[meta.pool].prefix,
            value: counterState.value,
            display: formatValue(meta.id, counterState.value),
            updatedAt: counterState.updatedAt,
            updatedBy: counterState.updatedBy
        };
    }

    function parseInput(counterId, rawInput) {
        var meta = findCounterMeta(counterId);
        if (!meta) { throw new Error('Unknown counter.'); }

        var s = String(rawInput == null ? '' : rawInput).trim();
        if (!s) { throw new Error('Enter a number.'); }

        var prefix = POOLS[meta.pool].prefix;
        if (prefix && s.charAt(0).toUpperCase() === prefix.toUpperCase()) {
            s = s.slice(1).trim();
        }

        if (!/^\d+$/.test(s)) {
            throw new Error('Enter a whole number.');
        }
        var n = parseInt(s, 10);
        if (n < 1) { throw new Error('Number must be at least 1.'); }
        return n;
    }

    function getState() {
        return JSON.parse(JSON.stringify(readState()));
    }

    function getCounter(id) {
        var meta = findCounterMeta(id);
        if (!meta) { return null; }
        var state = readState();
        return counterView(meta, state.counters[id]);
    }

    function getAllCounters() {
        var state = readState();
        return COUNTERS.map(function (meta) {
            return counterView(meta, state.counters[meta.id]);
        });
    }

    function getPoolSummary(poolName) {
        if (!POOLS[poolName]) { return null; }
        var state = readState();
        return {
            pool: poolName,
            prefix: POOLS[poolName].prefix,
            lastIssued: state.pools[poolName].lastIssued
        };
    }

    function issueNext(counterId, actor) {
        var meta = findCounterMeta(counterId);
        if (!meta) { throw new Error('Unknown counter.'); }

        var state = readState();
        var pool = state.pools[meta.pool];
        var next = pool.lastIssued + 1;
        pool.lastIssued = next;

        state.counters[counterId] = {
            value: next,
            updatedAt: new Date().toISOString(),
            updatedBy: actor ? actor.userId : null
        };
        writeState(state);

        appendLog(makeLogEntry('issue', actor, {
            counterId: counterId,
            pool: meta.pool,
            value: next
        }));

        return getCounter(counterId);
    }

    function setCounterValue(counterId, rawInput, actor) {
        var meta = findCounterMeta(counterId);
        if (!meta) { throw new Error('Unknown counter.'); }

        var n = parseInput(counterId, rawInput);

        var state = readState();
        state.counters[counterId] = {
            value: n,
            updatedAt: new Date().toISOString(),
            updatedBy: actor ? actor.userId : null
        };
        writeState(state);

        appendLog(makeLogEntry('set', actor, {
            counterId: counterId,
            pool: meta.pool,
            value: n
        }));

        return getCounter(counterId);
    }

    function resetPool(poolName, actor) {
        if (!POOLS[poolName]) { throw new Error('Unknown pool.'); }

        var now = new Date().toISOString();
        var actorId = actor ? actor.userId : null;

        var state = readState();
        state.pools[poolName].lastIssued = 0;
        COUNTERS.forEach(function (meta) {
            if (meta.pool === poolName) {
                state.counters[meta.id] = {
                    value: null,
                    updatedAt: now,
                    updatedBy: actorId
                };
            }
        });
        writeState(state);

        appendLog(makeLogEntry('resetPool', actor, { pool: poolName }));
    }

    function resetAll(actor) {
        var now = new Date().toISOString();
        var actorId = actor ? actor.userId : null;

        var state = emptyState();
        Object.keys(state.counters).forEach(function (id) {
            state.counters[id].updatedAt = now;
            state.counters[id].updatedBy = actorId;
        });
        writeState(state);

        appendLog(makeLogEntry('resetAll', actor, {}));
    }

    function getLog() {
        return readLog().slice().reverse();
    }

    function clearLog() {
        window.localStorage.removeItem(LOG_KEY);
    }

    function onChange(callback) {
        if (typeof callback !== 'function') { return function () {}; }
        subscribers.push(callback);
        return function () {
            var i = subscribers.indexOf(callback);
            if (i > -1) { subscribers.splice(i, 1); }
        };
    }

    window.JSQ_Queue = {
        POOLS: POOLS,
        COUNTERS: COUNTERS,

        getState: getState,
        getCounter: getCounter,
        getAllCounters: getAllCounters,
        getPoolSummary: getPoolSummary,
        formatValue: formatValue,
        parseInput: parseInput,

        issueNext: issueNext,
        setCounterValue: setCounterValue,
        resetPool: resetPool,
        resetAll: resetAll,

        getLog: getLog,
        clearLog: clearLog,

        onChange: onChange
    };

})(window);