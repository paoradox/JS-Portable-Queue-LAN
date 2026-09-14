/*
 * queue.js — Queue system data module (Step 8 of the LAN migration).
 *
 * Public API: window.JSQ_Queue — same function names as before. What
 * changed is what's INSIDE these functions: they used to read/write
 * localStorage directly (and listen for the browser's native
 * 'storage' event to catch changes from other tabs); now they all
 * delegate to JSQ_QueueService (frontend/assets/js/services/
 * queueCache.js), which talks to the server's SQLite-backed
 * /api/queue/* endpoints and listens for Socket.IO's 'queueUpdated'
 * event instead — which catches changes from other DEVICES on the
 * LAN, not just other tabs on the same browser.
 *
 * WHAT THIS MEANS FOR CALLERS (admin.js/encoder.js/display.js/ui.js —
 * all updated together with this file, in this same step):
 *
 * 1. NEW: JSQ_Queue.init() must be called once, before anything else
 *    here is trusted — same reasoning as JSQ_Auth.init() in Step 7.
 *    Every page that uses JSQ_Queue (encoder.html, admin.html,
 *    index.html) now awaits this at boot.
 *
 * 2. getState(), getCounter(), getAllCounters(), getPoolSummary(),
 *    getLog(), COUNTERS, POOLS, and onChange() all stay exactly as
 *    synchronous as they were — they read an in-memory cache instead
 *    of localStorage, kept fresh automatically by Socket.IO. ui.js's
 *    renderBoard() needed ZERO changes because of this.
 *
 * 3. issueNext, setCounterValue, resetPool, resetAll, and clearLog are
 *    ALL Promises now, since they're real network requests — every
 *    one of these was synchronous before (queue.js never used any
 *    async browser API the way the old auth.js's password hashing
 *    did), so every call site using them needed try/catch converted
 *    to .then()/.catch(). Done in this step, in admin.js/encoder.js.
 *
 * 4. The `actor` parameter (issueNext(id, actor), etc.) is gone. The
 *    old code built its own "who's doing this" object client-side and
 *    passed it in; the server doesn't trust that anymore — it reads
 *    the actor from the session cookie itself. Passing an actor here
 *    wouldn't do anything, so call sites just stopped passing one.
 *
 * formatValue() and parseInput() were part of the old public API but
 * were never actually called by admin.js/encoder.js/display.js/ui.js
 * (checked directly, not assumed) — the server does this validation
 * now (see server/services/queueService.js), so they're not carried
 * forward here. If some future page needs client-side preview
 * formatting, it can be added back against the cached data.
 */
(function (window) {
    'use strict';

    var service = window.JSQ_QueueService;

    function init() { return service.init(); }

    // ---------------------------------------------------------------
    // Reads — synchronous, same as before
    // ---------------------------------------------------------------

    function getState() { return service.getState(); }
    function getCounter(id) { return service.getCounter(id); }
    function getAllCounters() { return service.getAllCounters(); }
    function getPoolSummary(poolName) { return service.getPoolSummary(poolName); }
    function getLog() { return service.getLog(); }
    function onChange(callback) { return service.onChange(callback); }

    // ---------------------------------------------------------------
    // Mutations — all Promises now (see file header, point 3)
    // ---------------------------------------------------------------

    function issueNext(counterId) { return service.issueNext(counterId); }
    function setCounterValue(counterId, rawInput) { return service.setCounterValue(counterId, rawInput); }
    function resetPool(poolName) { return service.resetPool(poolName); }
    function resetAll() { return service.resetAll(); }
    function clearLog() { return service.clearLog(); }

    window.JSQ_Queue = {
        POOLS: service.POOLS,
        COUNTERS: service.COUNTERS,

        init: init,

        getState: getState,
        getCounter: getCounter,
        getAllCounters: getAllCounters,
        getPoolSummary: getPoolSummary,
        getLog: getLog,
        onChange: onChange,

        issueNext: issueNext,
        setCounterValue: setCounterValue,
        resetPool: resetPool,
        resetAll: resetAll,
        clearLog: clearLog
    };

})(window);
