/*
 * electron/main.js — Electron main process (Step 10 of the LAN
 * migration).
 *
 * What this file does:
 *   1. Starts the EXACT SAME server code as `npm start` (server/index.js's
 *      exported start() function) — nothing about the server itself is
 *      duplicated or reimplemented here.
 *   2. Picks a port: tries the last-used port (saved in a small JSON
 *      settings file), and if that port is taken by something else,
 *      automatically tries the next ones instead of just crashing.
 *   3. Detects the host machine's LAN IP address(es), so other devices
 *      on the same network know what URL to open in their browser.
 *   4. Opens a small control window showing that connection info, with
 *      buttons to copy the URL and open the Display/Admin pages, plus
 *      a way to change the port if you ever need a specific one.
 *
 * What this file deliberately does NOT do: bundle frontend/server code
 * into a compressed .asar archive. Keeping everything as plain,
 * editable files (same as running `npm start` directly) was your
 * explicit choice — see Step 11 for how that's reflected in the
 * packaging config.
 */

'use strict';

const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { start } = require('../server/index.js');

const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 20;
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

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
