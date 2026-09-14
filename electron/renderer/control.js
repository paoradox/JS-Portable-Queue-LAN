/*
 * electron/renderer/control.js — Runs inside the control window.
 *
 * Only ever talks to window.queueApp (exposed by preload.js) — never
 * touches Node.js or Electron APIs directly, since this window has
 * contextIsolation on and nodeIntegration off (the secure default).
 */

(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function renderConnectionInfo(info) {
        $('statusLine').textContent = 'Listening on port ' + info.port;
        $('portInput').value = info.port;

        var urlList = $('urlList');
        urlList.innerHTML = '';

        var urls = info.urls.length > 0 ? info.urls : [info.localUrl];

        urls.forEach(function (url) {
            var row = document.createElement('div');
            row.className = 'url-box';

            var input = document.createElement('input');
            input.type = 'text';
            input.readOnly = true;
            input.value = url;

            var copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            copyBtn.className = 'secondary';
            copyBtn.addEventListener('click', function () {
                window.queueApp.copyUrl(url);
                copyBtn.textContent = 'Copied!';
                window.setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
            });

            row.appendChild(input);
            row.appendChild(copyBtn);
            urlList.appendChild(row);
        });

        if (info.urls.length === 0) {
            var warning = document.createElement('div');
            warning.className = 'hint';
            warning.textContent = 'No LAN network address detected — other devices may not be able to connect. ' +
                'Local access still works at ' + info.localUrl + '.';
            urlList.appendChild(warning);
        }
    }

    function loadConnectionInfo() {
        window.queueApp.getConnectionInfo().then(renderConnectionInfo);
    }

    $('openDisplayBtn').addEventListener('click', function () {
        window.queueApp.openDisplay();
    });

    $('openAdminBtn').addEventListener('click', function () {
        window.queueApp.openAdmin();
    });

    $('changePortBtn').addEventListener('click', function () {
        var newPort = $('portInput').value;
        var messageEl = $('portMessage');
        messageEl.textContent = 'Changing port…';
        messageEl.className = 'port-message';

        window.queueApp.changePort(newPort).then(function (result) {
            if (result.ok) {
                messageEl.textContent = 'Port changed successfully.';
                messageEl.className = 'port-message ok';
                renderConnectionInfo(result.info);
            } else {
                messageEl.textContent = result.error || 'Could not change port.';
                messageEl.className = 'port-message error';
            }
        });
    });

    loadConnectionInfo();
})();
