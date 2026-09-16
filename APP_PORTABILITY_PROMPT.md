# Prompt: Wrap a Node.js/Express web app as a portable, editable desktop app with Electron

Use this when you have an existing Node.js + Express web application (with or
without a frontend build step) and want to package it as a double-clickable
desktop app — **without** losing the ability to edit the app's own code after
building, and without needing to rebuild for every small change. Also covers
giving it a small control window with connection info, page shortcuts, and a
changeable port.

## Core principle

Most Electron tutorials bundle your entire app (frontend + backend + all
dependencies) into the packaged executable's own resources folder. That
works, but it means every code change requires a full rebuild, and the
"packaged" copy of your code is separate from your actual working source —
easy to lose track of which one you're editing.

Instead: **package only the Electron launcher itself** (a thin shell with no
app logic of its own), and have it read your actual server and frontend code
from the real project folder on disk, at runtime. The launcher and your app
code live side by side, not one bundled inside the other.

## Part 0 — Getting to the target Node.js/Express layout

Everything from Part A onward assumes a `server/index.js` that exports a
`start(port)` function and a `frontend/` folder it serves as static files.
Which of the two paths below you need depends on what you're starting from.

### 0a. If you already have a Node.js/Express backend

Reorganize to this target shape first (adjust names only where marked —
everything else, including the literal folder name `frontend`, should stay
exactly as shown regardless of what the source project currently calls
things):

**A common starting point** (frontend HTML/CSS/JS in a folder called `src`,
or sometimes `public`/`client`/`www` — naming varies a lot project to
project; backend code either mixed into the root or in its own folder with
an inconsistent name):

```text
my-project/                 (BEFORE)
├─ src/                     <- frontend files, whatever it happens to be called
│  ├─ index.html
│  └─ assets/...
├─ routes/                  <- or api/, or backend/, or no folder at all
├─ app.js                   <- or server.js, or index.js — the entry point
├─ data.db                  <- if a database file already exists, often just loose in root
├─ node_modules/
└─ package.json
```

**Target structure** (what every part of this prompt assumes from here on):

```text
my-project/                 (AFTER)
├─ electron/                <- NEW — the launcher's own source
│  ├─ main.js
│  ├─ preload.js
│  └─ renderer/
│     ├─ control.html
│     └─ control.js
├─ server/                  <- your backend code, moved here as a unit
│  ├─ index.js              <- your entry point, renamed if needed, exports start(port)
│  └─ ...routes/services/whatever else it already had, moved in unchanged
├─ frontend/                <- ALWAYS use this exact name, regardless of what it was called before
│  ├─ index.html
│  └─ assets/...
├─ database/                <- NEW folder — move any existing DB file in here
│  └─ data.db
├─ node_modules/
├─ package.json
└─ package-lock.json
```

(`launcher/` isn't shown here — it doesn't exist yet at this stage; it's
created later, in Part E, from the build output.)

**Reorganization checklist:**

1. **Rename your frontend folder to `frontend/`**, whatever it's currently
   called (`src`, `public`, `client`, `www`, etc.). Use this exact name —
   the rest of this prompt, and anyone reading the project later, assumes it.

2. **Move your backend code into a `server/` folder as one unit** — don't
   cherry-pick individual files. If you currently have `app.js` at the root
   plus a `routes/` folder next to it, move `app.js` (renaming it to
   `server/index.js`) AND `routes/` together, so `server/routes/` sits
   beside `server/index.js`. Moving them together means any `require('./routes/...')`
   lines inside your entry file keep working unchanged, since the *relative*
   relationship between the entry file and what it requires hasn't changed —
   only their shared location moved.

3. **Move any existing database file into `database/`.** Update wherever
   your code opens it (e.g. `new Database('data.db')` becomes
   `new Database(path.join(__dirname, '..', 'database', 'data.db'))` if the
   file that opens it lives in `server/`).

4. **Update the static-file-serving line** to point at the renamed folder:
```javascript
   app.use(express.static(path.join(__dirname, '..', 'frontend')));
```
   (Path depth depends on where in `server/` that line actually lives —
   adjust the number of `'..'` segments accordingly.)

**What does NOT need changing** (a common over-correction to avoid):

- **`<script src="...">` / `<link href="...">` paths inside your HTML files**
  that are relative to the HTML file itself (e.g. `assets/js/app.js`) don't
  need updating just because the *parent* folder got renamed from `src` to
  `frontend` — they're relative to the HTML file's own location, which
  hasn't changed relative to its siblings.
- Paths starting with `/` (e.g. `/assets/app.js`) are relative to whatever
  Express serves as the site root, not to a filesystem folder name — these
  also don't need changing from a rename alone.
- You only need to touch a reference if the **internal structure inside**
  `frontend/` changed too (files actually moved relative to each other), not
  just because the outer container folder got renamed.

**Also check:** npm scripts referencing the old folder name, `.gitignore`
entries pointing at old paths, and any hardcoded paths elsewhere in your
code — search the whole project for the old folder name once done.

### 0b. If you're starting from a plain HTML/CSS/JS site with no backend at all

Build a minimal Node.js + Express + Socket.IO + SQLite backend first, then
treat it as your `server/` folder going forward — everything from Part A
onward applies unchanged once this exists.

**Prerequisites:** Node.js 22.5.0 or newer (`node -v` to check) — this
skeleton uses the `node:sqlite` module built into Node itself, so there's no
native compiling and no extra database package to install.

**1. Move your existing files into `frontend/`** (if they're currently loose
in the project root):

```bash
mkdir frontend
mv *.html *.css assets frontend/
```

**2. Initialize the Node project and install dependencies:**

```bash
npm init -y
npm install express socket.io
```

**3. Create `server/index.js`** — serves `frontend/` as static files, wires
up Socket.IO, and exports the same `start(port)` shape Part A needs:

```javascript
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
require('./db'); // opens/creates the database on startup — see step 4

function start(port) {
    return new Promise((resolve, reject) => {
        const app = express();
        app.use(express.json());
        app.use(express.static(path.join(__dirname, '..', 'frontend')));

        const httpServer = http.createServer(app);
        const io = new Server(httpServer);

        io.on('connection', (socket) => {
            console.log('Client connected:', socket.id);
            // Add your app's real-time events here — e.g.
            // socket.emit('initialState', getCurrentState());
        });

        // Broadcast to every connected client whenever your app's data
        // changes. Call this from wherever your API routes below
        // actually mutate something.
        function broadcastUpdate(payload) {
            io.emit('update', payload);
        }

        // Add your app's REST routes here, e.g.:
        // app.get('/api/items', (req, res) => { ... });
        // app.post('/api/items', (req, res) => {
        //     ... db.prepare(...).run(...) ...
        //     broadcastUpdate(newState);
        //     res.json({ ok: true });
        // });

        httpServer.once('error', reject);
        httpServer.listen(port, () => resolve({ port, httpServer, io }));
    });
}

module.exports = { start };

if (require.main === module) {
    start(process.env.PORT || 3000).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
```

**4. Create `server/db/index.js`** — opens (or creates) a SQLite database
automatically on first launch, using Node's built-in `node:sqlite` (no npm
package needed):

```javascript
'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = path.join(__dirname, '..', '..', 'database');
const DB_PATH = path.join(DB_DIR, 'data.db');

if (!fs.existsSync(DB_DIR)) { fs.mkdirSync(DB_DIR, { recursive: true }); }

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Replace this placeholder with your actual project's tables — this is
// the one piece of Part 0b that's necessarily specific to each project.
db.exec(`
    CREATE TABLE IF NOT EXISTS items (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
`);

module.exports = { db };
```

**5. Update the frontend to talk to this backend** — if it previously used
`localStorage`, replace those calls with `fetch()` calls to your new
`/api/...` routes, and add a Socket.IO client listener for live updates:

```html
<script src="/socket.io/socket.io.js"></script>
<script>
    const socket = io();
    socket.on('update', (payload) => {
        // re-render whatever part of the page shows this data
    });
</script>
```

**6. Add the run script** to `package.json`:

```json
"scripts": {
    "start": "node server/index.js"
}
```

Once this is in place, `server/index.js` exists, exports `start(port)`, and
serves `frontend/` — exactly what the rest of this prompt (Part A onward)
expects. Continue from Part A.

## Part A — Reading your app from outside the bundle

**1. Restructure the server entry point to be requireable, not just runnable.**

If you followed 0b above, `server/index.js` already does this. If you're
coming from 0a with an existing server, your existing `server.js`/`app.js`/
`index.js` almost certainly starts listening immediately when run — change
it to export a `start(port)` function that returns a Promise (resolving once
listening, rejecting on failure such as the port being taken), and only
auto-start when the file is run directly:

```javascript
function start(port) {
    return new Promise((resolve, reject) => {
        // ... existing app setup (routes, middleware, etc.) ...
        const server = app.listen(port, () => resolve({ port, server }));
        server.once('error', reject);
    });
}
module.exports = { start };

if (require.main === module) {
    start(process.env.PORT || 3000).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
```

This one change lets the exact same file run three ways: directly via
`node server.js`, via `npm start`, and required as a module by the Electron
launcher below — with zero duplicated server code. Rejecting (rather than
crashing) on a taken port is what makes the auto-retry in Part B possible.

**2. Write an Electron main process that finds your project root by
searching upward, not by assuming a fixed location.**

```javascript
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function findProjectRoot(startDir) {
    let dir = startDir;
    for (let i = 0; i < 6; i++) {
        if (fs.existsSync(path.join(dir, 'server', 'index.js'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return startDir;
}

function getProjectRoot() {
    const startDir = app.isPackaged
        ? path.dirname(process.execPath)
        : path.join(__dirname, '..');
    return findProjectRoot(startDir);
}

const PROJECT_ROOT = getProjectRoot();
```

Searching upward (rather than assuming "the exe is always exactly one level
above its own folder") means the launcher executable can be placed directly
in the project root, or tucked into its own subfolder (recommended — see
Part C), without needing to change any code either way.

## Part B — Port selection: auto-retry AND manual change

**3. Try the saved/default port first, and automatically walk forward to
find a free one if it's taken.**

```javascript
function findFreePortAndStart(preferredPort, maxAttempts) {
    function attempt(port, attemptsLeft) {
        return start(port).catch((err) => {
            if (err.code !== 'EADDRINUSE' || attemptsLeft <= 0) {
                throw err;
            }
            console.warn('Port ' + port + ' is taken, trying ' + (port + 1) + '...');
            return attempt(port + 1, attemptsLeft - 1);
        });
    }
    return attempt(preferredPort, maxAttempts);
}
```

**4. Let the user change it manually too, without losing the working server
if the new port turns out to be bad.**

The key detail: start the NEW server before closing the OLD one. If the
requested port fails, you still have a working app instead of nothing.

```javascript
let currentServer = null; // { port, server } from start()

async function changePort(requestedPort) {
    const port = parseInt(requestedPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, error: 'Enter a port number between 1 and 65535.' };
    }
    const previous = currentServer;
    try {
        const result = await start(port);
        if (previous && previous.server) { previous.server.close(); }
        currentServer = result;
        saveSettings({ port: port }); // see Part F
        return { ok: true, port: port };
    } catch (err) {
        return { ok: false, error: err.message }; // previous server is untouched
    }
}
```

## Part C — LAN IP detection

**5. Find every non-internal IPv4 address the host machine has**, so you can
show the person all their real options (a machine with both Wi-Fi and
Ethernet active can have more than one — don't just guess the first one is
correct):

```javascript
const os = require('os');

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
```

## Part D — The control window (connection info, page shortcuts, port change)

**6. Define your app's shortcuts as a plain list**, not hardcoded button
handlers — this is the part to actually customize per project:

```javascript
// Edit this array for whatever pages YOUR app has. Each one becomes a
// button in the control window that opens that path in a new window.
const SHORTCUTS = [
    { key: 'display', label: 'Open Display Screen', path: '/index.html' },
    { key: 'admin',   label: 'Open Admin Panel',    path: '/admin.html' }
    // add more here for other projects — e.g.:
    // { key: 'dashboard', label: 'Open Dashboard', path: '/dashboard.html' }
];
```

**7. Preload script — the secure bridge between the control window's page
and the main process.** Electron's recommended setup keeps `contextIsolation`
on and `nodeIntegration` off in every window, so the page can't reach Node/
Electron APIs directly — this exposes only exactly what it needs:

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlApp', {
    getConnectionInfo: () => ipcRenderer.invoke('get-connection-info'),
    copyUrl: (url) => ipcRenderer.invoke('copy-url', url),
    openShortcut: (key) => ipcRenderer.invoke('open-shortcut', key),
    changePort: (port) => ipcRenderer.invoke('change-port', port)
});
```

**8. Main process IPC handlers**, using the shortcuts list, port logic, and
LAN detection from above:

```javascript
const { ipcMain, clipboard, BrowserWindow } = require('electron');
const shortcutWindows = {};

function connectionInfo() {
    const addresses = getLanAddresses();
    const port = currentServer ? currentServer.port : null;
    return {
        port: port,
        urls: addresses.map((addr) => 'http://' + addr + ':' + port),
        localUrl: 'http://localhost:' + port,
        shortcuts: SHORTCUTS.map((s) => ({ key: s.key, label: s.label }))
    };
}

ipcMain.handle('get-connection-info', () => connectionInfo());

ipcMain.handle('copy-url', (event, url) => {
    clipboard.writeText(url);
    return true;
});

ipcMain.handle('open-shortcut', (event, key) => {
    const shortcut = SHORTCUTS.find((s) => s.key === key);
    if (!shortcut) return;
    if (shortcutWindows[key] && !shortcutWindows[key].isDestroyed()) {
        shortcutWindows[key].focus();
        return;
    }
    const win = new BrowserWindow({ width: 1000, height: 700 });
    win.loadURL('http://localhost:' + currentServer.port + shortcut.path);
    win.on('closed', () => { delete shortcutWindows[key]; });
    shortcutWindows[key] = win;
});

ipcMain.handle('change-port', (event, port) => changePort(port));
```

**9. Renderer (the actual window content)** — reads `SHORTCUTS` dynamically
from `getConnectionInfo()` rather than hardcoding buttons, so step 6 is the
only place you ever need to edit per project:

```javascript
// control.js — runs inside the control window
window.controlApp.getConnectionInfo().then((info) => {
    document.getElementById('status').textContent = 'Listening on port ' + info.port;
    document.getElementById('portInput').value = info.port;

    const urlList = document.getElementById('urlList');
    (info.urls.length ? info.urls : [info.localUrl]).forEach((url) => {
        const row = document.createElement('div');
        const input = document.createElement('input');
        input.readOnly = true; input.value = url;
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => window.controlApp.copyUrl(url);
        row.append(input, copyBtn);
        urlList.appendChild(row);
    });

    const shortcutRow = document.getElementById('shortcuts');
    info.shortcuts.forEach((s) => {
        const btn = document.createElement('button');
        btn.textContent = s.label;
        btn.onclick = () => window.controlApp.openShortcut(s.key);
        shortcutRow.appendChild(btn);
    });
});

document.getElementById('changePortBtn').onclick = () => {
    const newPort = document.getElementById('portInput').value;
    window.controlApp.changePort(newPort).then((result) => {
        document.getElementById('portMessage').textContent =
            result.ok ? 'Port changed.' : result.error;
    });
};
```

Matching minimal HTML for that renderer:

```html
<div id="status"></div>
<div id="urlList"></div>
<div id="shortcuts"></div>
<input id="portInput" type="number" />
<button id="changePortBtn">Change port</button>
<div id="portMessage"></div>
<script src="control.js"></script>
```

## Part E — Packaging config

**10. electron-builder setup**, in `package.json`:

```json
{
  "main": "electron/main.js",
  "scripts": {
    "dist": "electron-builder --win --dir"
  },
  "build": {
    "productName": "Your App Name",
    "executableName": "YourApp",
    "asar": false,
    "files": [
      "electron/**/*",
      "package.json",
      "!node_modules/**/*"
    ],
    "win": { "target": "dir" }
  }
}
```

Critical details, each learned the hard way:
- **`"!node_modules/**/*"` is required, not optional.** electron-builder
  bundles `node_modules` by default even when it's absent from `files` —
  omitting the negation pattern silently defeats the whole point of this
  approach.
- **Use the `"dir"` target, never the `"portable"` NSIS target**, if your app
  has any persistent local data (a database file, settings, logs). The
  `"portable"` target extracts to a temp folder that's deleted when the app
  closes — any data your app wrote gets silently wiped every single time.
  `"dir"` produces a plain folder with no such trap.
- **Set `executableName` explicitly.** Different platforms default to naming
  the executable after different package.json fields (`name` vs
  `productName`) — don't rely on the default, name it exactly what you want.

**11. Recommend (but don't require) a `launcher/` subfolder for the built
output.**

Electron ships with its own runtime files (locale packs, DLLs/shared
libraries, Chromium resource packs) — typically 15-25 files that have
nothing to do with your app. Move the entire build output into a subfolder:

```powershell
New-Item -ItemType Directory -Force -Path launcher
Move-Item dist\win-unpacked\* launcher\
```

Because step 2's path resolution searches upward rather than assuming a
fixed depth, this works with zero code changes — the executable finds your
`server/` folder whether it's one level up (root) or two levels up
(`launcher/`).

**Final structure after building:**

```text
my-project/
├─ launcher/                <- the built exe + Electron's runtime files
├─ electron/
├─ server/
├─ frontend/
├─ database/
├─ app-settings.json        <- created automatically on first launch
├─ node_modules/
├─ package.json
└─ package-lock.json
```

## Part F — Settings persistence

**12. Any settings the launcher itself needs (saved port, etc.) should be a
plain, visible JSON file in the project root** — not tucked into an
OS-specific per-user config folder. Matches the "everything is one
inspectable, editable folder" philosophy the whole approach is built around:

```javascript
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'app-settings.json');

function loadSettings() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
    catch (e) { return {}; }
}
function saveSettings(settings) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}
```

## End result

- Editing your server or frontend code takes effect the next time you
  relaunch the app — no rebuild, ever, for ordinary code changes.
- You only rebuild the launcher when the launcher's own code changes.
- A control window shows every LAN URL the app is reachable at (with
  one-click copy), buttons for each of your app's important pages, and a way
  to change the port without editing any files.
- The port auto-recovers if its default/saved choice is taken by something
  else, and manual changes never leave you with a fully-stopped server.
- The whole thing is trivially portable — copy the project folder to another
  machine and it runs, no installer, no registry entries.

## Adapting this to a different project

Five things to check per project:
1. Whether you need Part 0a (reorganize an existing backend) or Part 0b
   (build one from scratch for a plain HTML/CSS/JS site).
2. Your existing folder structure reorganized to match, if it doesn't
   already.
3. The check in Part A step 2 (`server/index.js` → your actual server entry
   point, if you named it differently).
4. The `SHORTCUTS` array in Part D step 6 — your app's actual important
   pages.
5. `productName`/`executableName` in Part E step 10.

Everything else (port logic, LAN detection, the control window's structure,
the packaging config) is copy-paste reusable as-is.