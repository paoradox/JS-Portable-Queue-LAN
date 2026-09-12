/*
 * admin.js — Admin page controller
 *
 * Depends on: auth.js, queue.js, ui.js, bootstrap.js.
 */
(function (window, document) {
    'use strict';

    var STORAGE_RECONCILE_DEBOUNCE_MS = 75;

    var session = null;
    var el = {};
    var editTargetUserId = null;
    var resetTargetUserId = null;
    var passwordConfirmCallback = null;
    var stopClock = null;
    var sessionReconcileTimer = null;

    function $(id) { return document.getElementById(id); }

    function cacheElements() {
        el.activeUser          = $('activeUser');
        el.logoutBtn           = $('logoutBtn');
        el.noAccessGate        = $('noAccessGate');
        el.datetime            = $('datetime');

        el.authGate             = $('authGate');
        el.firstRunForm         = $('firstRunForm');
        el.firstRunUsername     = $('firstRunUsername');
        el.firstRunPassword     = $('firstRunPassword');
        el.firstRunPasswordCfm  = $('firstRunPasswordConfirm');
        el.firstRunError        = $('firstRunError');
        el.firstRunSubmit       = $('firstRunSubmit');

        el.loginGateForm        = $('loginGateForm');
        el.gateUsername          = $('gateUsername');
        el.gatePassword          = $('gatePassword');
        el.gateLoginError        = $('gateLoginError');
        el.gateLoginSubmit       = $('gateLoginSubmit');

        el.usersTableBody      = $('usersTableBody');
        el.usersError          = $('usersError');
        el.openCreateUser      = $('openCreateUser');

        el.createUserModal     = $('createUserModal');
        el.newUserUsername     = $('newUserUsername');
        el.newUserPassword     = $('newUserPassword');
        el.newUserCounter      = $('newUserCounter');
        el.newUserIsAdmin      = $('newUserIsAdmin');
        el.createUserError     = $('createUserError');
        el.createUserSubmit    = $('createUserSubmit');
        el.createUserX         = $('createUserX');

        el.editUserModal       = $('editUserModal');
        el.editUserUsername    = $('editUserUsername');
        el.editUserCounter     = $('editUserCounter');
        el.editUserIsAdmin     = $('editUserIsAdmin');
        el.editUserError       = $('editUserError');
        el.editUserSubmit      = $('editUserSubmit');
        el.editUserX           = $('editUserX');

        el.resetPasswordModal    = $('resetPasswordModal');
        el.resetPasswordUsername = $('resetPasswordUsername');
        el.resetPasswordNew      = $('resetPasswordNew');
        el.resetPasswordConfirm  = $('resetPasswordConfirm');
        el.resetPasswordError    = $('resetPasswordError');
        el.resetPasswordSubmit   = $('resetPasswordSubmit');
        el.resetPasswordX        = $('resetPasswordX');

        el.passwordConfirmModal    = $('passwordConfirmModal');
        el.passwordConfirmModalLabel = $('passwordConfirmModalLabel');
        el.passwordConfirmMessage  = $('passwordConfirmMessage');
        el.passwordConfirmInput    = $('passwordConfirmInput');
        el.passwordConfirmError    = $('passwordConfirmError');
        el.passwordConfirmSubmit   = $('passwordConfirmSubmit');
        el.passwordConfirmX        = $('passwordConfirmX');

        el.resetAllBtn         = $('resetAllBtn');
        el.resetError          = $('resetError');

        el.logTableBody        = $('logTableBody');
        el.clearLogBtn         = $('clearLogBtn');
        el.exportLogBtn        = $('exportLogBtn');
        el.exportReportBtn     = $('exportReportBtn');
    }

    function ensureModal(element) {
        var M = window.bootstrap.Modal;
        if (typeof M.getOrCreateInstance === 'function') {
            return M.getOrCreateInstance(element);
        }
        if (typeof M.getInstance === 'function') {
            var existing = M.getInstance(element);
            if (existing) { return existing; }
        }
        return new M(element);
    }

    function openModal(modalEl) {
        if (!window.bootstrap || !window.bootstrap.Modal || !modalEl) {
            console.error('admin.js: Bootstrap Modal is not available.');
            return false;
        }
        ensureModal(modalEl).show();
        return true;
    }

    function closeModal(modalEl) {
        if (!modalEl) { return; }

        var bootstrapped = false;
        try {
            if (window.bootstrap && window.bootstrap.Modal) {
                var M = window.bootstrap.Modal;
                var inst = (typeof M.getInstance === 'function')
                    ? M.getInstance(modalEl) : null;
                if (inst) {
                    inst.hide();
                    bootstrapped = true;
                }
            }
        } catch (e) {
            console.error('admin.js: Bootstrap hide failed.', e);
        }

        window.setTimeout(function () {
            if (!modalEl.classList.contains('show')) { return; }

            modalEl.classList.remove('show');
            modalEl.style.display = 'none';
            modalEl.setAttribute('aria-hidden', 'true');
            modalEl.removeAttribute('aria-modal');
            modalEl.removeAttribute('role');

            if (!document.querySelector('.modal.show')) {
                document.body.classList.remove('modal-open');
                document.body.style.removeProperty('overflow');
                document.body.style.removeProperty('padding-right');
            }
            document.querySelectorAll('.modal-backdrop').forEach(function (b) {
                b.remove();
            });
        }, bootstrapped ? 250 : 0);
    }

    // ---------------------------------------------------------------
    // Sidebar auth button: "Login" when logged out, "Logout" when in
    // ---------------------------------------------------------------

    function renderAuthButton() {
        if (!el.logoutBtn) { return; }
        el.logoutBtn.textContent = window.JSQ_Auth.isLoggedIn() ? 'Logout' : 'Login';
    }

    function showError(element, message) { element.textContent = message || ''; }
    function clearError(element) { element.textContent = ''; }

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

        window.JSQ_Auth.createUser({
            username: username,
            password: password,
            isAdmin: true
        }).then(function () {
            return window.JSQ_Auth.login(username, password);
        }).then(function () {
            el.firstRunSubmit.disabled = false;
            hideAuthGate();
            renderAuthButton();
            boot();
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
            boot();
        }).catch(function (err) {
            el.gateLoginSubmit.disabled = false;
            showError(el.gateLoginError, err.message || 'Login failed.');
        });
    }

    // ---------------------------------------------------------------
    // Sidebar button: "Login" or "Logout" depending on state
    // ---------------------------------------------------------------

    function handleAuthButtonClick(e) {
        if (e) { e.preventDefault(); }

        if (!window.JSQ_Auth.isLoggedIn()) {
            showLoginGate();
            return;
        }

        window.JSQ_Auth.logout();
        if (stopClock) { stopClock(); stopClock = null; }
        if (sessionReconcileTimer) {
            window.clearTimeout(sessionReconcileTimer);
            sessionReconcileTimer = null;
        }
        window.location.href = 'index.html';
    }

    // ---------------------------------------------------------------
    // Small helpers
    // ---------------------------------------------------------------

    function counterLabel(counterId) {
        if (!counterId) { return '—'; }
        var c = window.JSQ_Queue.COUNTERS.find(function (x) { return x.id === counterId; });
        return c ? c.label : counterId;
    }

    function fillCounterSelect(selectEl, includeNone) {
        selectEl.innerHTML = '';
        if (includeNone) {
            var none = document.createElement('option');
            none.value = '';
            none.textContent = '— Unassigned —';
            selectEl.appendChild(none);
        }
        window.JSQ_Queue.COUNTERS.forEach(function (c) {
            var opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.label;
            selectEl.appendChild(opt);
        });
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderSessionLabels() {
        if (!session) { return; }
        el.activeUser.textContent = session.username;
    }

    // ---------------------------------------------------------------
    // Password confirmation modal
    // ---------------------------------------------------------------

    // opts.danger: true renders the message in warning red instead of
    // the default muted gray. Used for destructive queue resets.
    function openPasswordConfirm(opts) {
        el.passwordConfirmModalLabel.textContent = opts.title || 'Confirm';
        el.passwordConfirmMessage.textContent = opts.message || '';
        el.passwordConfirmMessage.classList.toggle('text-danger', !!opts.danger);
        el.passwordConfirmMessage.classList.toggle('text-muted', !opts.danger);
        el.passwordConfirmSubmit.textContent = opts.confirmLabel || 'Confirm';
        el.passwordConfirmInput.value = '';
        el.passwordConfirmError.textContent = '';
        passwordConfirmCallback = opts.onConfirm;

        if (openModal(el.passwordConfirmModal)) {
            window.setTimeout(function () { el.passwordConfirmInput.focus(); }, 200);
        }
    }

    function closePasswordConfirm() {
        passwordConfirmCallback = null;
        el.passwordConfirmInput.value = '';
        el.passwordConfirmError.textContent = '';
        closeModal(el.passwordConfirmModal);
    }

    function handlePasswordConfirmSubmit() {
        el.passwordConfirmError.textContent = '';

        var pw = el.passwordConfirmInput.value;
        if (!pw) {
            el.passwordConfirmError.textContent = 'Enter your password.';
            return;
        }

        var currentSession = window.JSQ_Auth.getSession();
        if (!currentSession || !currentSession.id) {
            el.passwordConfirmError.textContent = 'No active session — please log in again.';
            return;
        }

        el.passwordConfirmSubmit.disabled = true;

        window.JSQ_Auth.verifyPassword(currentSession.id, pw).then(function (valid) {
            el.passwordConfirmSubmit.disabled = false;
            if (!valid) {
                el.passwordConfirmError.textContent = 'Incorrect password.';
                return;
            }
            var cb = passwordConfirmCallback;
            closePasswordConfirm();
            if (typeof cb === 'function') { cb(); }
        }).catch(function (err) {
            console.error('admin.js: verifyPassword failed', err);
            el.passwordConfirmSubmit.disabled = false;
            el.passwordConfirmError.textContent = 'Could not verify password.';
        });
    }

    // ---------------------------------------------------------------
    // Users table
    // ---------------------------------------------------------------

    function renderUsers() {
        var users = window.JSQ_Auth.listUsers();
        var tbody = el.usersTableBody;
        tbody.innerHTML = '';

        if (users.length === 0) {
            var row = document.createElement('tr');
            var cell = document.createElement('td');
            cell.colSpan = 5;
            cell.className = 'text-muted';
            cell.textContent = 'No accounts.';
            row.appendChild(cell);
            tbody.appendChild(row);
            return;
        }

        users.forEach(function (u) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + escapeHtml(u.username) + '</td>' +
                '<td>' + (u.isAdmin ? '<span class="badge text-bg-primary">Admin</span>'
                                    : '<span class="badge text-bg-secondary">Staff</span>') + '</td>' +
                '<td>' + escapeHtml(counterLabel(u.counter)) + '</td>' +
                '<td class="small text-muted">' + escapeHtml(window.JSQ_UI.formatAbsolute(u.createdAt)) + '</td>' +
                '<td>' +
                    '<button class="btn btn-sm btn-outline-secondary" data-action="edit" data-user-id="' + escapeHtml(u.id) + '">Edit</button> ' +
                    '<button class="btn btn-sm btn-outline-secondary" data-action="reset" data-user-id="' + escapeHtml(u.id) + '">Reset pw</button> ' +
                    '<button class="btn btn-sm btn-danger" data-action="delete" data-user-id="' + escapeHtml(u.id) + '">Delete</button>' +
                '</td>';
            tbody.appendChild(tr);
        });
    }

    function handleUsersTableClick(e) {
        var btn = e.target.closest('button[data-action]');
        if (!btn) { return; }

        var action = btn.getAttribute('data-action');
        var userId = btn.getAttribute('data-user-id');
        if (!userId) { return; }

        if (action === 'edit')   { openEditUser(userId); }
        if (action === 'reset')  { openResetPassword(userId); }
        if (action === 'delete') { confirmDeleteUser(userId); }
    }

    // ---------------------------------------------------------------
    // Create user
    // ---------------------------------------------------------------

    function openCreateUserModal() {
        el.newUserUsername.value = '';
        el.newUserPassword.value = '';
        el.newUserIsAdmin.checked = false;
        el.newUserCounter.value = '';
        el.createUserError.textContent = '';

        if (openModal(el.createUserModal)) {
            window.setTimeout(function () { el.newUserUsername.focus(); }, 200);
        }
    }

    function handleCreateUserSubmit() {
        el.createUserError.textContent = '';

        var username = el.newUserUsername.value.trim();
        var password = el.newUserPassword.value;
        var counter  = el.newUserCounter.value || null;
        var isAdmin  = el.newUserIsAdmin.checked;

        el.createUserSubmit.disabled = true;

        window.JSQ_Auth.createUser({
            username: username,
            password: password,
            isAdmin: isAdmin,
            counter: counter
        }).then(function () {
            el.createUserSubmit.disabled = false;
            closeModal(el.createUserModal);
            renderUsers();
        }).catch(function (err) {
            el.createUserSubmit.disabled = false;
            el.createUserError.textContent = err.message || 'Could not create user.';
        });
    }

    // ---------------------------------------------------------------
    // Edit user
    // ---------------------------------------------------------------

    function openEditUser(userId) {
        var user = window.JSQ_Auth.getUserById(userId);
        if (!user) { return; }

        editTargetUserId = userId;
        el.editUserUsername.value = user.username;
        el.editUserCounter.value = user.counter || '';
        el.editUserIsAdmin.checked = user.isAdmin;
        el.editUserError.textContent = '';

        openModal(el.editUserModal);
    }

    function handleEditUserSubmit() {
        el.editUserError.textContent = '';

        var userId = editTargetUserId;
        if (!userId) { return; }

        var current = window.JSQ_Auth.getUserById(userId);
        if (!current) {
            el.editUserError.textContent = 'User no longer exists.';
            return;
        }

        var newUsername = el.editUserUsername.value.trim();
        var newCounter  = el.editUserCounter.value || null;
        var newIsAdmin  = el.editUserIsAdmin.checked;

        var errors = [];

        if (newUsername !== current.username) {
            try {
                window.JSQ_Auth.renameUser(userId, newUsername);
            } catch (e) {
                errors.push(e.message || 'Could not rename user.');
            }
        }

        if (newCounter !== current.counter) {
            try {
                window.JSQ_Auth.setUserCounter(userId, newCounter);
            } catch (e) {
                errors.push(e.message || 'Could not set counter.');
            }
        }

        if (newIsAdmin !== current.isAdmin) {
            try {
                window.JSQ_Auth.setUserIsAdmin(userId, newIsAdmin);
            } catch (e) {
                errors.push(e.message || 'Could not change admin flag.');
            }
        }

        renderUsers();
        session = window.JSQ_Auth.getSession();
        renderSessionLabels();

        if (errors.length) {
            el.editUserError.textContent = errors.join(' ');
            return;
        }

        closeModal(el.editUserModal);
    }

    // ---------------------------------------------------------------
    // Reset password
    // ---------------------------------------------------------------

    function openResetPassword(userId) {
        var user = window.JSQ_Auth.getUserById(userId);
        if (!user) { return; }

        resetTargetUserId = userId;
        el.resetPasswordUsername.textContent = user.username;
        el.resetPasswordNew.value = '';
        el.resetPasswordConfirm.value = '';
        el.resetPasswordError.textContent = '';

        openModal(el.resetPasswordModal);
    }

    function handleResetPasswordSubmit() {
        el.resetPasswordError.textContent = '';

        var userId = resetTargetUserId;
        if (!userId) { return; }

        var pw = el.resetPasswordNew.value;
        var confirm = el.resetPasswordConfirm.value;

        if (pw !== confirm) {
            el.resetPasswordError.textContent = 'Passwords do not match.';
            return;
        }

        el.resetPasswordSubmit.disabled = true;

        window.JSQ_Auth.adminResetPassword(userId, pw).then(function () {
            el.resetPasswordSubmit.disabled = false;
            closeModal(el.resetPasswordModal);
        }).catch(function (err) {
            el.resetPasswordSubmit.disabled = false;
            el.resetPasswordError.textContent = err.message || 'Could not reset password.';
        });
    }

    // ---------------------------------------------------------------
    // Delete user
    // ---------------------------------------------------------------

    function confirmDeleteUser(userId) {
        var user = window.JSQ_Auth.getUserById(userId);
        if (!user) { return; }

        openPasswordConfirm({
            title: 'Delete account',
            message: 'Delete "' + user.username + '"? This cannot be undone.',
            confirmLabel: 'Delete user',
            onConfirm: function () {
                try {
                    window.JSQ_Auth.deleteUser(userId);
                    renderUsers();
                } catch (err) {
                    el.usersError.textContent = err.message || 'Could not delete user.';
                }
            }
        });
    }

    // ---------------------------------------------------------------
    // Queue reset
    // ---------------------------------------------------------------

    function currentActor() {
        var s = window.JSQ_Auth.getSession();
        if (!s) { return null; }
        return { userId: s.id, username: s.username };
    }

    function handleResetPool(poolName, label) {
        el.resetError.textContent = '';
        openPasswordConfirm({
            title: 'Reset ' + label,
            message: 'Clear all counters in this pool and restart numbering?',
            confirmLabel: 'Reset',
            danger: true,
            onConfirm: function () {
                try {
                    window.JSQ_Queue.resetPool(poolName, currentActor());
                    renderLog();
                } catch (err) {
                    el.resetError.textContent = err.message || 'Could not reset.';
                }
            }
        });
    }

    function handleResetAll() {
        el.resetError.textContent = '';
        openPasswordConfirm({
            title: 'Reset all counters',
            message: 'Clear every counter (C1–C6, PWD, ESCAL) and restart numbering?',
            confirmLabel: 'Reset all',
            danger: true,
            onConfirm: function () {
                try {
                    window.JSQ_Queue.resetAll(currentActor());
                    renderLog();
                } catch (err) {
                    el.resetError.textContent = err.message || 'Could not reset.';
                }
            }
        });
    }

    // ---------------------------------------------------------------
    // Audit log
    // ---------------------------------------------------------------

    function describeLogEntry(entry) {
        var cLabel;
        switch (entry.action) {
            case 'issue':
                cLabel = counterLabel(entry.counterId);
                return cLabel + ' → ' + entry.value;
            case 'set':
                cLabel = counterLabel(entry.counterId);
                return cLabel + ' set to ' + entry.value;
            case 'resetPool':
                return 'Reset pool: ' + (entry.pool || '?');
            case 'resetAll':
                return 'Reset all pools';
            default:
                return '—';
        }
    }

    function renderLog() {
        var log = window.JSQ_Queue.getLog();
        var tbody = el.logTableBody;
        tbody.innerHTML = '';

        if (log.length === 0) {
            var row = document.createElement('tr');
            var cell = document.createElement('td');
            cell.colSpan = 4;
            cell.className = 'text-muted text-center';
            cell.textContent = 'No actions logged yet.';
            row.appendChild(cell);
            tbody.appendChild(row);
            return;
        }

        log.forEach(function (entry) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td class="small text-muted">' + escapeHtml(window.JSQ_UI.formatAbsolute(entry.ts)) + '</td>' +
                '<td>' + escapeHtml(entry.username || '—') + '</td>' +
                '<td>' + escapeHtml(entry.action) + '</td>' +
                '<td class="log-details">' + escapeHtml(describeLogEntry(entry)) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function handleClearLog() {
        openPasswordConfirm({
            title: 'Clear audit log',
            message: 'Clear the entire audit log? This cannot be undone.',
            confirmLabel: 'Clear log',
            onConfirm: function () {
                window.JSQ_Queue.clearLog();
                renderLog();
            }
        });
    }

    // ---------------------------------------------------------------
    // CSV export
    // ---------------------------------------------------------------

    function csvEscape(v) {
        var s = String(v == null ? '' : v);
        if (/[",\r\n]/.test(s)) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function csvRow(cells) {
        return cells.map(csvEscape).join(',') + '\r\n';
    }

    function downloadCsv(filename, content) {
        var blob = new Blob(['\ufeff' + content], {
            type: 'text/csv;charset=utf-8;'
        });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 200);
    }

    function fileDateStamp() {
        var d = new Date();
        return d.getFullYear() + '-' +
               String(d.getMonth() + 1).padStart(2, '0') + '-' +
               String(d.getDate()).padStart(2, '0');
    }

    function fileMonthStamp() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    function handleExportLog() {
        var log = window.JSQ_Queue.getLog();
        if (log.length === 0) {
            window.alert('The audit log is empty.');
            return;
        }

        var rows = [csvRow([
            'Time', 'User', 'Action', 'Counter', 'Value', 'Pool'
        ])];

        log.forEach(function (entry) {
            rows.push(csvRow([
                window.JSQ_UI.formatAbsolute(entry.ts),
                entry.username || '',
                entry.action || '',
                entry.counterId ? counterLabel(entry.counterId) : '',
                entry.value != null ? entry.value : '',
                entry.pool || ''
            ]));
        });

        downloadCsv('audit-log-' + fileDateStamp() + '.csv', rows.join(''));
    }

    function handleExportReport() {
        var log = window.JSQ_Queue.getLog();
        var now = new Date();
        var targetYear = now.getFullYear();
        var targetMonth = now.getMonth();

        var isThisMonth = function (iso) {
            var d = new Date(iso);
            return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
        };

        var issued = log.filter(function (e) {
            return e.action === 'issue' && isThisMonth(e.ts);
        }).reverse();

        if (issued.length === 0) {
            window.alert('No tickets have been issued this month.');
            return;
        }

        var byCounter = {};
        window.JSQ_Queue.COUNTERS.forEach(function (c) {
            byCounter[c.id] = {
                label: c.label, count: 0,
                firstTs: null, firstVal: null,
                lastTs: null, lastVal: null
            };
        });

        issued.forEach(function (e) {
            var b = byCounter[e.counterId];
            if (!b) { return; }
            b.count++;
            if (b.firstTs === null) {
                b.firstTs = e.ts;
                b.firstVal = e.value;
            }
            b.lastTs = e.ts;
            b.lastVal = e.value;
        });

        var rows = [];
        rows.push(csvRow(['Monthly Queue Report', fileMonthStamp()]));
        rows.push('');
        rows.push(csvRow([
            'Counter', 'Tickets Issued',
            'First Ticket', 'First At',
            'Last Ticket', 'Last At'
        ]));

        window.JSQ_Queue.COUNTERS.forEach(function (c) {
            var b = byCounter[c.id];
            rows.push(csvRow([
                b.label, b.count,
                b.firstVal != null ? b.firstVal : '',
                b.firstTs ? window.JSQ_UI.formatAbsolute(b.firstTs) : '',
                b.lastVal != null ? b.lastVal : '',
                b.lastTs ? window.JSQ_UI.formatAbsolute(b.lastTs) : ''
            ]));
        });

        rows.push('');
        rows.push(csvRow(['Total tickets issued this month', issued.length]));

        downloadCsv('monthly-report-' + fileMonthStamp() + '.csv', rows.join(''));
    }

    // ---------------------------------------------------------------
    // Cross-tab reaction to user changes
    // ---------------------------------------------------------------

    function handleUsersStorageChange() {
        session = window.JSQ_Auth.getSession();
        if (!session) {
            window.location.href = 'index.html';
            return;
        }
        if (!session.isAdmin) {
            el.noAccessGate.classList.remove('d-none');
            return;
        }
        renderSessionLabels();
        renderUsers();
    }

    function scheduleUsersReconcile() {
        if (sessionReconcileTimer) {
            window.clearTimeout(sessionReconcileTimer);
        }
        sessionReconcileTimer = window.setTimeout(function () {
            sessionReconcileTimer = null;
            handleUsersStorageChange();
        }, STORAGE_RECONCILE_DEBOUNCE_MS);
    }

    // ---------------------------------------------------------------
    // Event wiring
    // ---------------------------------------------------------------

    var eventsWired = false;

    function wireEvents() {
        if (eventsWired) { return; }
        eventsWired = true;

        el.logoutBtn.addEventListener('click', handleAuthButtonClick);

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

        el.usersTableBody.addEventListener('click', handleUsersTableClick);

        el.openCreateUser.addEventListener('click', openCreateUserModal);
        el.createUserSubmit.addEventListener('click', handleCreateUserSubmit);

        el.editUserSubmit.addEventListener('click', handleEditUserSubmit);
        el.resetPasswordSubmit.addEventListener('click', handleResetPasswordSubmit);

        el.createUserX.addEventListener('click', function () { closeModal(el.createUserModal); });
        el.editUserX.addEventListener('click', function () { closeModal(el.editUserModal); });
        el.resetPasswordX.addEventListener('click', function () { closeModal(el.resetPasswordModal); });

        el.passwordConfirmX.addEventListener('click', closePasswordConfirm);
        el.passwordConfirmSubmit.addEventListener('click', handlePasswordConfirmSubmit);
        el.passwordConfirmInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                handlePasswordConfirmSubmit();
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') { return; }
            [el.createUserModal, el.editUserModal,
             el.resetPasswordModal, el.passwordConfirmModal]
                .forEach(function (m) {
                    if (!m || !m.classList.contains('show')) { return; }
                    if (m === el.passwordConfirmModal) {
                        closePasswordConfirm();
                    } else {
                        closeModal(m);
                    }
                });
        });

        el.resetAllBtn.addEventListener('click', handleResetAll);
        document.querySelectorAll('[data-reset-pool]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var pool = btn.getAttribute('data-reset-pool');
                var labels = { c: 'C1–C6 pool', pwd: 'PWD pool', escal: 'ESCAL pool' };
                handleResetPool(pool, labels[pool] || pool);
            });
        });

        el.clearLogBtn.addEventListener('click', handleClearLog);
        el.exportLogBtn.addEventListener('click', handleExportLog);
        el.exportReportBtn.addEventListener('click', handleExportReport);

        window.addEventListener('storage', function (e) {
            if (e.key === 'jsq.users') { scheduleUsersReconcile(); }
        });
    }

    // ---------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------

    function boot() {
        cacheElements();
        wireEvents();

        renderAuthButton();

        if (!window.JSQ_Auth.hasAnyUser()) {
            showFirstRunForm();
            return;
        }

        session = window.JSQ_Auth.getSession();

        if (!session) {
            showLoginGate();
            return;
        }

        hideAuthGate();

        if (!session.isAdmin) {
            el.noAccessGate.classList.remove('d-none');
            return;
        }

        renderSessionLabels();

        fillCounterSelect(el.newUserCounter, true);
        fillCounterSelect(el.editUserCounter, true);

        window.JSQ_UI.wireSidebar();

        if (stopClock) { stopClock(); }
        stopClock = window.JSQ_UI.startClock(el.datetime);

        renderUsers();
        renderLog();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.addEventListener('beforeunload', function () {
        if (stopClock) { stopClock(); stopClock = null; }
        if (sessionReconcileTimer) {
            window.clearTimeout(sessionReconcileTimer);
            sessionReconcileTimer = null;
        }
    });

})(window, document);