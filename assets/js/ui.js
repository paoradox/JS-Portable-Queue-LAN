/*
 * ui.js — Shared UI helpers
 *
 * Small, page-agnostic behaviours that every page controller needs:
 *   - Sidebar toggle + custom scrollbar
 *   - Fixed-format datetime clock for navbar badges
 *   - Fixed-format absolute timestamp formatter (for log tables)
 *   - Public queue board renderer (updates [data-counter-id] elements)
 *
 * Public API: window.JSQ_UI
 *
 * Load order: after auth.js and queue.js, before the page controller.
 */
(function (window, document) {
    'use strict';

    // Fixed-format datetime strings. Deliberately not locale-aware so
    // the display is identical on every machine.
    var DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // ---------------------------------------------------------------
    // Formatters
    // ---------------------------------------------------------------

    // "Thu, Sep 11 · 3:18:12 PM"
    function formatDate(d) {
        var h = d.getHours();
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        if (h === 0) { h = 12; }

        return DAYS[d.getDay()] + ', ' +
               MONTHS[d.getMonth()] + ' ' +
               d.getDate() + ' \u00B7 ' +
               h + ':' +
               String(d.getMinutes()).padStart(2, '0') + ':' +
               String(d.getSeconds()).padStart(2, '0') + ' ' + ampm;
    }

    function formatNow() {
        return formatDate(new Date());
    }

    // Same format, for a past/absolute ISO timestamp. Returns "—"
    // for null/undefined so table cells render consistently.
    function formatAbsolute(iso) {
        if (!iso) { return '\u2014'; }
        return formatDate(new Date(iso));
    }

    // ---------------------------------------------------------------
    // Sidebar
    // ---------------------------------------------------------------

    // Wires the sidebar toggle and (optionally) the custom scrollbar.
    // The scrollbar plugin is jQuery-based; if jQuery or the plugin
    // is missing, the sidebar still works — just without the styled rail.
    function wireSidebar() {
        var sidebar = document.getElementById('sidebar');
        var content = document.getElementById('content');
        var btn     = document.getElementById('sidebarCollapse');

        if (window.jQuery && window.jQuery.fn &&
            window.jQuery.fn.mCustomScrollbar) {
            window.jQuery('#sidebar').mCustomScrollbar({ theme: 'minimal' });
        }

        if (btn && sidebar && content) {
            btn.addEventListener('click', function () {
                sidebar.classList.toggle('active');
                content.classList.toggle('active');
            });
        }
    }

    // ---------------------------------------------------------------
    // Clock
    // ---------------------------------------------------------------

    // Starts a 1-second clock that writes the formatted datetime into
    // the given element. Returns a stop function. If the element is
    // missing, returns a no-op stop so callers don't need to guard.
    function startClock(element) {
        if (!element) { return function () {}; }

        function tick() { element.textContent = formatNow(); }
        tick();

        var timerId = window.setInterval(tick, 1000);

        return function stop() {
            if (timerId !== null) {
                window.clearInterval(timerId);
                timerId = null;
            }
        };
    }

    // ---------------------------------------------------------------
    // Public queue board
    // ---------------------------------------------------------------

    // Updates every [data-counter-id] element on the page (used by
    // both index.html's public board and encoder.html's queue list)
    // with the current "now serving" value from JSQ_Queue.
    // Safe to call on any page: elements that don't exist are skipped,
    // and it no-ops entirely if JSQ_Queue isn't loaded yet.
    function renderBoard() {
        if (!window.JSQ_Queue || typeof window.JSQ_Queue.getAllCounters !== 'function') {
            return;
        }

        var counters = window.JSQ_Queue.getAllCounters();
        counters.forEach(function (counter) {
            var el = document.querySelector('[data-counter-id="' + counter.id + '"]');
            if (el) { el.textContent = counter.display; }
        });
    }

    // ---------------------------------------------------------------
    // Export
    // ---------------------------------------------------------------

    window.JSQ_UI = {
        formatNow: formatNow,
        formatAbsolute: formatAbsolute,
        wireSidebar: wireSidebar,
        startClock: startClock,
        renderBoard: renderBoard
    };

})(window, document);