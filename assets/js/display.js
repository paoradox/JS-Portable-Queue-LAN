/*
 * display.js — Public display board controller
 *
 * Depends on: queue.js, ui.js.
 * No login/auth capability on this page — it's the public "now
 * serving" board. Staff access encoder.html / admin.html directly.
 */
(function (window, document) {
    'use strict';

    var stopClock = null;
    var unsubscribeQueue = null;

    var dingCtx = null;
    var lastDingAt = 0;
    var lastSeenLogTs = null;

    function $(id) { return document.getElementById(id); }

    function cacheElements() {
        el.datetime = $('datetime');
    }

    var el = {};

    // ---------------------------------------------------------------
    // Sound cue
    // ---------------------------------------------------------------

    function getAudioCtx() {
        if (dingCtx) { return dingCtx; }
        try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) { return null; }
            dingCtx = new Ctx();
        } catch (e) {
            console.warn('display.js: Web Audio unavailable.', e);
            dingCtx = null;
        }
        return dingCtx;
    }

    function playDing() {
        var now = Date.now();
        if (now - lastDingAt < 500) { return; }
        lastDingAt = now;

        var ctx = getAudioCtx();
        if (!ctx) { return; }
        if (ctx.state === 'suspended') { ctx.resume(); }

        var t = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(1320, t + 0.12);

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);

        osc.start(t);
        osc.stop(t + 0.7);
    }

    function installAudioUnlock() {
        document.addEventListener('click', function unlock() {
            var ctx = getAudioCtx();
            if (ctx && ctx.state === 'suspended') { ctx.resume(); }
        }, { once: true });
    }

    // ---------------------------------------------------------------
    // Board subscription
    // ---------------------------------------------------------------

    function checkForNewIssue() {
        var log = window.JSQ_Queue.getLog();
        if (!log || log.length === 0) { return; }

        var newestTs = log[0].ts;

        if (lastSeenLogTs === null) {
            lastSeenLogTs = newestTs;
            return;
        }
        if (newestTs === lastSeenLogTs) { return; }

        var sawIssue = false;
        for (var i = 0; i < log.length; i++) {
            if (log[i].ts === lastSeenLogTs) { break; }
            if (log[i].action === 'issue') { sawIssue = true; }
        }
        lastSeenLogTs = newestTs;

        if (sawIssue) { playDing(); }
    }

    function onQueueChange() {
        window.JSQ_UI.renderBoard();
        checkForNewIssue();
    }

    function subscribeBoard() {
        if (unsubscribeQueue) { return; }
        unsubscribeQueue = window.JSQ_Queue.onChange(onQueueChange);
    }

    // ---------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------

    function boot() {
        cacheElements();
        window.JSQ_UI.wireSidebar();
        installAudioUnlock();

        stopClock = window.JSQ_UI.startClock(el.datetime);

        var log = window.JSQ_Queue.getLog();
        if (log && log.length > 0) {
            lastSeenLogTs = log[0].ts;
        }

        window.JSQ_UI.renderBoard();
        subscribeBoard();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.addEventListener('beforeunload', function () {
        if (stopClock) { stopClock(); stopClock = null; }
        if (unsubscribeQueue) {
            unsubscribeQueue();
            unsubscribeQueue = null;
        }
    });

})(window, document);