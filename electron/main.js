/*
 * electron/main.js — Electron main process for Queue Server.
 *
 * IMPORTANT — this app does NOT bundle a copy of server/ or frontend/
 * inside itself. It reads them from the folder it's actually placed
 * in. That means:
 *   - QueueServer.exe must sit directly inside the project folder,
 *     next to server/, frontend/, and database/ (see BUILD.md).
 *   - Editing any file in server/ or frontend/ takes effect the next
 *     time you launch the app — no rebuild, ever, for those changes.
 *   - The exe only needs rebuilding if electron/main.js, preload.js,
 *     or renderer/*.js themselves change.
 *
 * What this file does:
 *   1. Works out where the project folder actually is (see
 *      getProjectRoot() below — different in dev mode vs. the built
 *      exe), then starts server/index.js's exported start() function
 *      FROM THAT LOCATION. The server code itself is completely
 *      unaware this is happening — it's the same file whether it's
 *      run via `npm start`, `npm run electron`, or the built exe.
 *   2. Picks a port: tries the last-used port (saved in a small JSON
 *      settings file next to the exe), and if that port is taken by
 *      something else, automatically tries the next ones instead of
 *      just crashing.
 *   3. Detects the host machine's LAN IP address(es), so other devices
 *      on the same network know what URL to open in their browser.
 *   4. Opens a small control window showing that connection info, with
 *      buttons to copy the URL and open the Display/Admin pages, plus
 *      a way to change the port if you ever need a specific one.
 */

'use strict';

const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------
// Where's the actual project folder? This is the one piece that
// differs between "running from source" and "running the built exe" —
// everything else in this file is identical either way.
// ---------------------------------------------------------------

function getProjectRoot() {
    if (app.isPackaged) {
        // Built exe: QueueServer.exe sits directly in the project
        // folder (next to server/, frontend/, database/), so the
        // project root is just wherever the exe itself is.
        return path.dirname(process.execPath);
    }
    // Dev mode (`npm run electron`): electron/main.js's own folder is
    // already one level inside the real project root.
    return path.join(__dirname, '..');
}

const PROJECT_ROOT = getProjectRoot();
const SERVER_ENTRY = path.join(PROJECT_ROOT, 'server', 'index.js');

if (!fs.existsSync(SERVER_ENTRY)) {
    // A clear, specific error beats a cryptic MODULE_NOT_FOUND crash —
    // this is almost always "the exe got moved away from the project
    // folder" or "server/ is missing/renamed".
    console.error(
        'Queue Server: could not find server/index.js at ' + SERVER_ENTRY + '.\n' +
        'QueueServer.exe must be placed directly inside the project folder, ' +
        'next to the server/, frontend/, and database/ folders. See BUILD.md.'
    );
    app.whenReady().then(() => { app.quit(); });
} else {
    startApp();
}

function startApp() {

const { start } = require(SERVER_ENTRY);

const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 20;
// Settings live right next to the exe/project folder (not tucked away
// in an OS-specific per-user folder) — same "everything is one visible,
// editable folder" idea as the rest of this project.
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'electron-settings.json');

// currentServer holds whatever start() last resolved with:
// { port, httpServer, io }. Kept at module scope so changePort() can
// close the old one before switching to a new one.
let currentServer = null;
let controlWindow = null;
const shortcutWindows = {}; // { display: BrowserWindow, admin: BrowserWindow }

// ---------------------------------------------------------------
// Settings (just the port, for now) — a plain JSON file, not
// anything fancier, so it's easy to open and read/edit by hand if
// you ever need to.
// ---------------------------------------------------------------

function loadSettings() {
    try {
        const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return {}; // no settings file yet, or it's unreadable — use defaults
    }
}

function saveSettings(settings) {
    try {
        fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('electron/main.js: could not save settings.json', e);
    }
}

// ---------------------------------------------------------------
// LAN IP detection
// ---------------------------------------------------------------

// Returns every non-internal IPv4 address this machine has (usually
// just one, but a machine with both Wi-Fi and Ethernet active, or a
// VPN, can have more than one — showing all of them lets you pick the
// right one instead of guessing).
function getLanAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    Object.keys(interfaces).forEach((name) => {
        (interfaces[name] || []).forEach((iface) => {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push(iface.address);
            }
        });
    });
    return addresses;
}

// ---------------------------------------------------------------
// Port selection — tries the saved/default port first, then walks
// forward until it finds one that's actually free.
// ---------------------------------------------------------------

function findFreePortAndStart(preferredPort) {
    function attempt(port, attemptsLeft) {
        return start(port).catch((err) => {
            if (err.code !== 'EADDRINUSE' || attemptsLeft <= 0) {
                throw err;
            }
            console.warn('electron/main.js: port ' + port + ' is taken, trying ' + (port + 1) + '...');
            return attempt(port + 1, attemptsLeft - 1);
        });
    }
    return attempt(preferredPort, MAX_PORT_ATTEMPTS);
}

// ---------------------------------------------------------------
// Windows
// ---------------------------------------------------------------

function createControlWindow() {
    controlWindow = new BrowserWindow({
        width: 480,
        height: 420,
        resizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    controlWindow.setMenuBarVisibility(false);
    controlWindow.loadFile(path.join(__dirname, 'renderer', 'control.html'));

    controlWindow.on('closed', () => {
        controlWindow = null;
    });
}

function openShortcutWindow(key, urlPath) {
    if (shortcutWindows[key] && !shortcutWindows[key].isDestroyed()) {
        shortcutWindows[key].focus();
        return;
    }

    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    win.setMenuBarVisibility(false);
    win.loadURL('http://localhost:' + currentServer.port + urlPath);

    win.on('closed', () => {
        delete shortcutWindows[key];
    });

    shortcutWindows[key] = win;
}

// ---------------------------------------------------------------
// IPC — the control window's renderer calls these (via preload.js)
// instead of touching Node/Electron APIs directly, which is the
// secure pattern Electron recommends (contextIsolation on, no
// nodeIntegration in the renderer).
// ---------------------------------------------------------------

function connectionInfo() {
    const addresses = getLanAddresses();
    const port = currentServer ? currentServer.port : null;
    return {
        port: port,
        addresses: addresses,
        urls: addresses.map((addr) => 'http://' + addr + ':' + port),
        localUrl: 'http://localhost:' + port
    };
}

ipcMain.handle('get-connection-info', () => connectionInfo());

ipcMain.handle('copy-url', (event, url) => {
    clipboard.writeText(url);
    return true;
});

ipcMain.handle('open-display', () => {
    openShortcutWindow('display', '/index.html');
});

ipcMain.handle('open-admin', () => {
    openShortcutWindow('admin', '/admin.html');
});

ipcMain.handle('change-port', async (event, requestedPort) => {
    const port = parseInt(requestedPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, error: 'Enter a port number between 1 and 65535.' };
    }

    const previous = currentServer;
    try {
        const result = await start(port);
        // Only close the OLD server after the NEW one succeeds — if
        // the requested port is bad, the server you already had
        // running keeps running instead of leaving you with nothing.
        if (previous && previous.httpServer) {
            previous.httpServer.close();
        }
        currentServer = result;
        saveSettings({ port: port });
        return { ok: true, info: connectionInfo() };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// ---------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------

app.whenReady().then(async () => {
    const settings = loadSettings();
    const preferredPort = settings.port || DEFAULT_PORT;

    try {
        currentServer = await findFreePortAndStart(preferredPort);
        saveSettings({ port: currentServer.port });
    } catch (err) {
        console.error('electron/main.js: could not start the server on any port.', err);
        app.quit();
        return;
    }

    createControlWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createControlWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // Windows/Linux: quit when every window closes (there's no dock
    // icon to relaunch from, unlike macOS).
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

} // end startApp()
