/*
 * encoder.js — Encoder page controller
 *
 * Depends on: auth.js, queue.js, ui.js, bootstrap.js.
 */
(function (window, document) {
    'use strict';

    var SPEAK_LABELS = {
        c1:    'Station 1',
        c2:    'Station 2',
        c3:    'Station 3',
        c4:    'Station 4',
        c5:    'Station 5',
        c6:    'Station 6',
        pwd:   'Priority station',
        escal: 'Escalation station'
    };

    var session = null;
    var activeCounterId = null;
    var unsubscribeQueue = null;
    var stopClock = null;
    var el = {};

    function $(id) { return document.getElementById(id); }

    function cacheElements() {
        el.authGate            = $('authGate');
        el.firstRunForm        = $('firstRunForm');
        el.firstRunUsername    = $('firstRunUsername');
        el.firstRunPassword    = $('firstRunPassword');
        el.firstRunPasswordCfm = $('firstRunPasswordConfirm');
        el.firstRunError       = $('firstRunError');
        el.firstRunSubmit      = $('firstRunSubmit');

        el.loginGateForm       = $('loginGateForm');
        el.gateUsername        = $('gateUsername');
        el.gatePassword        = $('gatePassword');
        el.gateLoginError      = $('gateLoginError');
        el.gateLoginSubmit     = $('gateLoginSubmit');

        el.activeUser          = $('activeUser');
        el.logoutBtn           = $('logoutBtn');
        el.adminNavItem        = $('adminNavItem');
        el.datetime            = $('datetime');

        el.counterPicker       = $('counterPicker');
        el.counterPickerSelect = $('counterPickerSelect');
        el.counterDash         = $('counterDash');
        el.dashCounterLabel    = $('dashCounterLabel');
        el.dashCurrentValue    = $('dashCurrentValue');
        el.dashLastUpdated     = $('dashLastUpdated');
        el.dashPrefix          = $('dashPrefix');
        el.dashManualInput     = $('dashManualInput');
        el.dashSetBtn          = $('dashSetBtn');
        el.dashNextBtn         = $('dashNextBtn');
        el.dashError           = $('dashError');
        el.dashSpeakBtn        = $('dashSpeakBtn');
    }

    function showError(element, message) { element.textContent = message || ''; }
    function clearError(element) { element.textContent = ''; }

    // ---------------------------------------------------------------
    // Sidebar auth button: "Login" when logged out, "Logout" when in
    // ---------------------------------------------------------------

    function renderAuthButton() {
        if (!el.logoutBtn) { return; }
        el.logoutBtn.textContent = window.JSQ_Auth.isLoggedIn() ? 'Logout' : 'Login';
    }

    // ---------------------------------------------------------------
    // Auth gate: "Set up admin" (no accounts) or "Login" (accounts
    // exist, no session). Only one card is ever visible at a time.
    // ---------------------------------------------------------------

    function showFirstRunForm() {
        el.loginGateForm.classList.add('d-none');
        el.firstRunForm.classList.remove('d-none');
        el.authGate.classList.remove('d-none');
    }

    function showLoginGate() {
        el.firstRunForm.classList.add('d-none');
        el.loginGateForm.classList.remove('d-none');
        el.authGate.classList.remove('d-none');
    }

    function hideAuthGate() {
        el.authGate.classList.add('d-none');
    }

    function handleFirstRunSubmit() {
        clearError(el.firstRunError);

        var username = el.firstRunUsername.value.trim();
        var password = el.firstRunPassword.value;
        var confirm  = el.firstRunPasswordCfm.value;

        if (password !== confirm) {
            showError(el.firstRunError, 'Passwords do not match.');
            return;
        }

        el.firstRunSubmit.disabled = true;

        // Uses the dedicated first-run endpoint, not createUser()+login() —
        // there's no admin session yet to authorize a regular createUser()
        // call with. See the comment on JSQ_Auth.firstRunSetup in auth.js.
        window.JSQ_Auth.firstRunSetup(username, password).then(function () {
            el.firstRunSubmit.disabled = false;
            hideAuthGate();
            renderAuthButton();
            beginSession();
        }).catch(function (err) {
            el.firstRunSubmit.disabled = false;
            showError(el.firstRunError, err.message || 'Could not create account.');
        });
    }

    // ---------------------------------------------------------------
    // Login (full-page gate, not a modal)
    // ---------------------------------------------------------------

    function handleLoginSubmit() {
        clearError(el.gateLoginError);

        var username = el.gateUsername.value.trim();
        var password = el.gatePassword.value;

        if (!username || !password) {
            showError(el.gateLoginError, 'Enter both username and password.');
            return;
        }

        el.gateLoginSubmit.disabled = true;

        window.JSQ_Auth.login(username, password).then(function () {
            el.gateLoginSubmit.disabled = false;
            el.gatePassword.value = '';
            hideAuthGate();
            renderAuthButton();
            beginSession();
        }).catch(function (err) {
            el.gateLoginSubmit.disabled = false;
            showError(el.gateLoginError, err.message || 'Login failed.');
        });
    }

    // ---------------------------------------------------------------
    // Session lifecycle
    // ---------------------------------------------------------------

    function updateAdminLink(isAdmin) {
        if (!el.adminNavItem) { return; }
        el.adminNavItem.classList.toggle('d-none', !isAdmin);
    }

    function beginSession() {
        session = window.JSQ_Auth.getSession();
        if (!session) {
            renderAuthButton();
            showLoginGate();
            return;
        }

        el.activeUser.textContent = session.username;
        updateAdminLink(session.isAdmin);
        hideAuthGate();

        activeCounterId = resolveActiveCounter();
        renderCounterOrPicker();
        subscribeQueueChanges();
    }

    function endSession() {
        // NEW in Step 7: logout used to be an instant localStorage
        // write; it's a network request now. The .catch() just logs a
        // failed request — the redirect still happens either way,
        // since index.html has no login gate to be stuck behind.
        window.JSQ_Auth.logout().catch(function (err) {
            console.error('encoder.js: logout request failed', err);
        }).then(function () {
            unsubscribeQueueChanges();
            if (stopClock) { stopClock(); stopClock = null; }
            session = null;
            activeCounterId = null;
            window.location.href = 'index.html';
        });
    }

    function isValidCounterId(id) {
        if (!id) { return false; }
        return window.JSQ_Queue.COUNTERS.some(function (c) { return c.id === id; });
    }

    function resolveActiveCounter() {
        if (!session) { return null; }
        if (session.counter && isValidCounterId(session.counter)) {
            return session.counter;
        }
        return null;
    }

    function buildCounterPicker() {
        var sel = el.counterPickerSelect;
        sel.innerHTML = '<option value="">— Choose a station —</option>';
        window.JSQ_Queue.COUNTERS.forEach(function (c) {
            var opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.label;
            sel.appendChild(opt);
        });
    }

    function renderCounterOrPicker() {
        if (isValidCounterId(activeCounterId)) {
            el.counterPicker.classList.add('d-none');
            el.counterDash.classList.remove('d-none');
            renderCounter();
        } else {
            el.counterDash.classList.add('d-none');
            el.counterPicker.classList.remove('d-none');
            el.counterPickerSelect.value = '';
        }
    }

    function renderCounter() {
        if (!isValidCounterId(activeCounterId)) { return; }

        var counter = window.JSQ_Queue.getCounter(activeCounterId);
        if (!counter) { return; }

        el.dashCounterLabel.textContent = counter.label;
        el.dashCurrentValue.textContent = counter.display;

        if (counter.updatedAt) {
            el.dashLastUpdated.textContent =
                'Last updated: ' + window.JSQ_UI.formatAbsolute(counter.updatedAt);
        } else {
            el.dashLastUpdated.textContent = 'No value issued yet.';
        }

        if (counter.prefix) {
            el.dashPrefix.textContent = counter.prefix;
            el.dashPrefix.classList.remove('d-none');
        } else {
            el.dashPrefix.classList.add('d-none');
        }
    }

    function renderAll() {
        renderCounter();
        window.JSQ_UI.renderBoard();
    }

    function handleCounterPick() {
        var chosen = el.counterPickerSelect.value;
        if (!isValidCounterId(chosen)) { return; }
        clearError(el.dashError);

        // NEW in Step 7: switched from setUserCounter(session.userId, chosen)
        // to setOwnCounter(chosen) — the server has a separate endpoint for
        // "the logged-in user picks their own counter" (no admin rights
        // needed) versus "an admin edits someone else's counter" (admin
        // rights required). setUserCounter() now always means the latter.
        // Also now async — was an instant localStorage write before.
        window.JSQ_Auth.setOwnCounter(chosen).then(function () {
            session = window.JSQ_Auth.getSession();
            activeCounterId = resolveActiveCounter();
            renderCounterOrPicker();
        }).catch(function (err) {
            showError(el.dashError, err.message || 'Could not save your station.');
        });
    }

    // getActor() was removed here in Step 8 — its only two call sites
    // (issueNext/setCounterValue below) no longer need it, since the
    // server determines who performed an action from the session
    // cookie, not from a client-supplied actor object.

    function handleIssueNext() {
        if (!isValidCounterId(activeCounterId)) { return; }
        clearError(el.dashError);

        // NEW in Step 8: issueNext used to be an instant localStorage
        // write; it's a network request now.
        window.JSQ_Queue.issueNext(activeCounterId).then(function () {
            renderAll();
        }).catch(function (err) {
            showError(el.dashError, err.message || 'Could not issue next.');
        });
    }

    function handleSetValue() {
        if (!isValidCounterId(activeCounterId)) { return; }
        clearError(el.dashError);

        var raw = el.dashManualInput.value;
        window.JSQ_Queue.setCounterValue(activeCounterId, raw).then(function () {
            el.dashManualInput.value = '';
            renderAll();
        }).catch(function (err) {
            showError(el.dashError, err.message || 'Could not set value.');
        });
    }

    function buildSpeakText(counter) {
        var label = SPEAK_LABELS[counter.id] || ('Station ' + counter.label);

        if (counter.value == null) {
            return label + ', no number yet';
        }
        if (counter.prefix) {
            return label + ', now serving ' + counter.prefix + ', ' + counter.value;
        }
        return label + ', now serving number ' + counter.value;
    }

    function handleSpeak() {
        if (!('speechSynthesis' in window)) {
            showError(el.dashError, 'Your browser does not support text-to-speech.');
            return;
        }
        if (!isValidCounterId(activeCounterId)) { return; }

        var counter = window.JSQ_Queue.getCounter(activeCounterId);
        if (!counter) { return; }

        var text = buildSpeakText(counter);

        window.speechSynthesis.cancel();
        var utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = 1;
        window.speechSynthesis.speak(utterance);
    }

    function subscribeQueueChanges() {
        if (unsubscribeQueue) { return; }
        unsubscribeQueue = window.JSQ_Queue.onChange(renderAll);
    }

    function unsubscribeQueueChanges() {
        if (unsubscribeQueue) {
            unsubscribeQueue();
            unsubscribeQueue = null;
        }
    }

    // Step 9 cleanup: handleUsersStorageChange/scheduleUsersReconcile
    // used to live here, reacting to the browser's native 'storage'
    // event on the 'jsq.users' localStorage key. User data hasn't
    // lived in localStorage since Step 7, so that event could never
    // fire again — removed along with the listener below.

    // ---------------------------------------------------------------
    // Sidebar button: "Login" or "Logout" depending on state
    // ---------------------------------------------------------------

    function handleAuthButtonClick(e) {
        if (e) { e.preventDefault(); }

        if (!window.JSQ_Auth.isLoggedIn()) {
            showLoginGate();
            return;
        }
        endSession();
    }

    // ---------------------------------------------------------------
    // Event wiring
    // ---------------------------------------------------------------

    function wireEvents() {
        el.firstRunSubmit.addEventListener('click', handleFirstRunSubmit);
        el.firstRunPasswordCfm.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleFirstRunSubmit();
            }
        });

        el.gateLoginSubmit.addEventListener('click', handleLoginSubmit);
        el.gatePassword.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleLoginSubmit();
            }
        });

        el.activeUser.addEventListener('click', function (e) {
            e.preventDefault();
            if (!window.JSQ_Auth.isLoggedIn()) { showLoginGate(); }
        });

        el.logoutBtn.addEventListener('click', handleAuthButtonClick);

        el.counterPickerSelect.addEventListener('change', handleCounterPick);

        el.dashNextBtn.addEventListener('click', handleIssueNext);
        el.dashSetBtn.addEventListener('click', handleSetValue);
        el.dashSpeakBtn.addEventListener('click', handleSpeak);

        el.dashManualInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSetValue();
            }
        });

        el.dashManualInput.addEventListener('focus', function () {
            this.select();
        });
    }

    // ---------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------

    function boot() {
        cacheElements();
        wireEvents();
        window.JSQ_UI.wireSidebar();
        buildCounterPicker();

        stopClock = window.JSQ_UI.startClock(el.datetime);
        window.JSQ_UI.renderBoard();

        if (!window.JSQ_Auth.hasAnyUser()) {
            showFirstRunForm();
            renderAuthButton();
            return;
        }

        renderAuthButton();

        if (!window.JSQ_Auth.isLoggedIn()) {
            showLoginGate();
            return;
        }

        beginSession();
    }

    // NEW in Step 7/8: JSQ_Auth.init() and JSQ_Queue.init() each do a
    // round trip to the server (session/first-run status, and the
    // current queue snapshot + log) before anything above can be
    // trusted — localStorage never needed this, it was always
    // synchronously ready. Run together via Promise.all since neither
    // depends on the other. boot() still runs even if init() fails, so
    // the page doesn't stay blank; its own guards (hasAnyUser/session)
    // fall back to the safest view (the login gate) in that case.
    function start() {
        Promise.all([
            window.JSQ_Auth.init(),
            window.JSQ_Queue.init()
        ]).then(function () {
            boot();
        }).catch(function (err) {
            console.error('encoder.js: failed to initialize', err);
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
    });

})(window, document);