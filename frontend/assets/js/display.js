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
    // Commercial video playlist (index.html only). This whole block
    // is a safe no-op on encoder.html/admin.html — they don't have a
    // #commercialFrame element, so initCommercialPlaylist() returns
    // immediately without doing anything.
    //
    // Reads frontend/videos.txt — one YouTube video ID or full URL
    // per line. Cycles through all of them, advancing the moment each
    // one actually ends (via the YouTube IFrame Player API's real
    // onStateChange event, not a guessed timer), wrapping back to the
    // first after the last. A single-video list "wraps" back to
    // itself, which is what produces the original loop=1 behavior —
    // one mechanism handles both cases, nothing special-cased.
    //
    // Failure handling (every one of these keeps the rest of the
    // display board — queue tables, clock — working regardless; only
    // this video panel is affected):
    //   - videos.txt missing/unreadable -> falls back to one default
    //     video (the original hardcoded one).
    //   - a line that isn't a recognizable video ID/URL -> skipped.
    //   - the YouTube IFrame API itself fails to load (e.g. no real
    //     internet access on this device — note this feature, unlike
    //     the rest of the app, genuinely needs real internet access,
    //     the same way the original hardcoded iframe embed always
    //     did) -> logged to console, video panel just stays empty.
    //   - one specific video errors during playback (deleted, embedding
    //     disabled, etc.) -> skipped, advances to the next one instead
    //     of getting stuck.
    // ---------------------------------------------------------------

    var DEFAULT_VIDEO_ID = 'ZvVAPboLLVM'; // the original single video

    function extractVideoId(line) {
        line = line.trim();
        if (!line || line.charAt(0) === '#') { return null; } // blank or comment line
        var match = line.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
        if (match) { return match[1]; }
        if (/^[A-Za-z0-9_-]{11}$/.test(line)) { return line; }
        return null; // not recognizable as a video ID or URL — skipped
    }

    function loadVideoList() {
        return fetch('videos.txt').then(function (res) {
            if (!res.ok) { throw new Error('videos.txt not found (' + res.status + ').'); }
            return res.text();
        }).then(function (text) {
            var ids = text.split('\n')
                .map(function (line) { return extractVideoId(line); })
                .filter(function (id) { return !!id; });
            return ids.length > 0 ? ids : [DEFAULT_VIDEO_ID];
        }).catch(function (err) {
            console.warn('display.js: could not load videos.txt, using the default video.', err);
            return [DEFAULT_VIDEO_ID];
        });
    }

    function loadYouTubeApi() {
        return new Promise(function (resolve, reject) {
            if (window.YT && window.YT.Player) { resolve(); return; }

            var timedOut = false;
            var timer = window.setTimeout(function () {
                timedOut = true;
                reject(new Error('YouTube IFrame API did not load in time (no internet access?).'));
            }, 10000);

            window.onYouTubeIframeAPIReady = function () {
                if (timedOut) { return; }
                window.clearTimeout(timer);
                resolve();
            };

            var tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.onerror = function () {
                if (timedOut) { return; }
                window.clearTimeout(timer);
                reject(new Error('Could not load the YouTube IFrame API script.'));
            };
            document.head.appendChild(tag);
        });
    }

    function startCommercialPlaylist(ids) {
        var index = 0;

        function advance() {
            index = (index + 1) % ids.length; // wraps to 0 after the last
            player.loadVideoById(ids[index]);
        }

        var player = new window.YT.Player('commercialFrame', {
            width: '800',
            height: '480',
            videoId: ids[0],
            playerVars: { autoplay: 1, mute: 1, playsinline: 1 },
            events: {
                onStateChange: function (e) {
                    if (e.data === window.YT.PlayerState.ENDED) { advance(); }
                },
                onError: function () { advance(); }
            }
        });
    }

    function initCommercialPlaylist() {
        if (!$('commercialFrame')) { return; }

        loadVideoList().then(function (ids) {
            return loadYouTubeApi().then(function () {
                startCommercialPlaylist(ids);
            });
        }).catch(function (err) {
            console.error('display.js: commercial playlist unavailable.', err);
        });
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
        initCommercialPlaylist();
    }

    // NEW in Step 8: JSQ_Queue.init() does a round trip to the server
    // (current queue snapshot + log) before anything above can be
    // trusted — localStorage never needed this, it was always
    // synchronously ready. This page has no login, so there's no
    // JSQ_Auth to wait on here — just the queue data.
    function start() {
        window.JSQ_Queue.init().then(function () {
            boot();
        }).catch(function (err) {
            console.error('display.js: failed to initialize', err);
            boot();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.addEventListener('beforeunload', function () {
        if (stopClock) { stopClock(); stopClock = null; }
        if (unsubscribeQueue) {
            unsubscribeQueue();
            unsubscribeQueue = null;
        }
    });

})(window, document);