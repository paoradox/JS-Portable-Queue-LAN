# Prompt: Wrap a Node.js/Express web app as a portable, editable desktop app with Electron

Use this when you have an existing Node.js + Express web application (with or
without a frontend build step) and want to package it as a double-clickable
desktop app — **without** losing the ability to edit the app's own code after
building, and without needing to rebuild for every small change. Also covers
giving it a compact control window with connection info, page shortcuts, and a
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

Target structure:

~~~text
my-project/
├─ electron/
│  ├─ main.js
│  ├─ preload.js
│  └─ renderer/
│     ├─ control.html
│     └─ control.js
├─ server/
│  ├─ index.js
│  └─ ...
├─ frontend/
│  ├─ index.html
│  └─ assets/...
├─ database/
│  └─ data.db
├─ node_modules/
├─ package.json
└─ package-lock.json
~~~

Checklist:

1. Rename your frontend folder to `frontend/`.
2. Move backend code into `server/`.
3. Move any database file into `database/`.
4. Serve static files from:

~~~javascript
app.use(express.static(path.join(__dirname, '..', 'frontend')));
~~~

## Part A — Server entry

Export a `start(port)` function from your server entry point.

~~~javascript
function start(port) {
  return new Promise((resolve, reject) => {
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
~~~

Find the project root by searching upward:

~~~javascript
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
~~~

## Part B — Port selection

Try the saved/default port first, then walk forward if it is taken.

~~~javascript
function findFreePortAndStart(preferredPort, maxAttempts) {
  function attempt(port, attemptsLeft) {
    return start(port).catch((err) => {
      if (err.code !== 'EADDRINUSE' || attemptsLeft <= 0) {
        throw err;
      }

      return attempt(port + 1, attemptsLeft - 1);
    });
  }

  return attempt(preferredPort, maxAttempts);
}
~~~

Manual port change should start the new server before closing the old one.

~~~javascript
let currentServer = null;

async function changePort(requestedPort) {
  const port = parseInt(requestedPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Enter a port number between 1 and 65535.' };
  }

  const previous = currentServer;

  try {
    const result = await start(port);

    if (previous && previous.server) {
      previous.server.close();
    }

    currentServer = result;
    saveSettings({ port: port });

    return { ok: true, port: port };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
~~~

## Part C — LAN IP detection

~~~javascript
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
~~~

## Part D — Electron control window

### 1. Shortcuts

Customize this per project:

~~~javascript
const SHORTCUTS = [
  { key: 'home', label: 'Open Main Page', path: '/index.html' },
  { key: 'admin', label: 'Open Admin Panel', path: '/admin.html' }
];
~~~

### 2. Preload script

Use `contextIsolation: true` and expose only the needed APIs.

~~~javascript
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlApp', {
  getConnectionInfo: function () {
    return ipcRenderer.invoke('get-connection-info');
  },
  copyUrl: function (url) {
    return ipcRenderer.invoke('copy-url', url);
  },
  openShortcut: function (key) {
    return ipcRenderer.invoke('open-shortcut', key);
  },
  openExternalUrl: function (url) {
    return ipcRenderer.invoke('open-external-url', url);
  },
  changePort: function (port) {
    return ipcRenderer.invoke('change-port', port);
  }
});
~~~

### 3. Main process IPC

~~~javascript
const { ipcMain, clipboard, shell, BrowserWindow } = require('electron');

const shortcutWindows = {};

function connectionInfo() {
  const addresses = getLanAddresses();
  const port = currentServer ? currentServer.port : null;

  return {
    port: port,
    urls: addresses.map((addr) => 'http://' + addr + ':' + port),
    localUrl: 'http://localhost:' + port,
    shortcuts: SHORTCUTS.map((shortcut) => ({
      key: shortcut.key,
      label: shortcut.label
    }))
  };
}

ipcMain.handle('get-connection-info', () => connectionInfo());

ipcMain.handle('copy-url', (event, url) => {
  clipboard.writeText(url);
  return true;
});

ipcMain.handle('open-shortcut', (event, key) => {
  const shortcut = SHORTCUTS.find((item) => item.key === key);
  if (!shortcut) return false;

  if (shortcutWindows[key] && !shortcutWindows[key].isDestroyed()) {
    shortcutWindows[key].focus();
    return true;
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
  win.loadURL('http://localhost:' + currentServer.port + shortcut.path);

  win.on('closed', () => {
    delete shortcutWindows[key];
  });

  shortcutWindows[key] = win;

  return true;
});

ipcMain.handle('open-external-url', (event, url) => {
  shell.openExternal(url);
  return true;
});

ipcMain.handle('change-port', (event, port) => changePort(port));
~~~

### 4. Control window dimensions and design standard

Use a compact fixed-size launcher window:

~~~javascript
function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    title: 'Your App Launcher',
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
~~~

Design standard:

- Window size: `480 × 420`
- Window resizing: disabled
- Menu bar: hidden
- Body padding: `24px`
- Background: `#f5f6f8`
- Main title color: `#134087`
- Status text color: `#198754`
- Primary button color: `#134087`
- Secondary buttons: white background, `#134087` text/border
- URL rows: read-only monospace input plus `Copy`
- Optional URL `Open` button if `openExternalUrl` exists
- Shortcut buttons: one row, equal width
- Port row: top border, compact number input, status message under row

Recommended `control.html`:

~~~html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Your App Server</title>
  <style>
    body {
      font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: #f5f6f8;
      color: #212529;
      margin: 0;
      padding: 24px;
    }
    h1 {
      font-size: 1.15rem;
      margin: 0 0 4px;
      color: #134087;
    }
    .status {
      font-size: 0.85rem;
      color: #198754;
      margin-bottom: 18px;
    }
    .url-box {
      display: flex;
      gap: 6px;
      margin-bottom: 6px;
    }
    .url-box input {
      flex: 1;
      font-family: monospace;
      font-size: 0.85rem;
      padding: 6px 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      background: #fff;
    }
    button {
      font-size: 0.85rem;
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid #134087;
      background: #134087;
      color: #fff;
      cursor: pointer;
    }
    button.secondary {
      background: #fff;
      color: #134087;
    }
    .shortcuts {
      display: flex;
      gap: 8px;
      margin: 16px 0;
    }
    .shortcuts button {
      flex: 1;
    }
    .port-row {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-top: 20px;
      border-top: 1px solid #dee2e6;
      padding-top: 16px;
    }
    .port-row input {
      width: 80px;
      padding: 6px 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
    }
    .port-message {
      font-size: 0.8rem;
      margin-top: 8px;
      min-height: 1em;
    }
    .port-message.error { color: #dc3545; }
    .port-message.ok { color: #198754; }
    .hint {
      font-size: 0.75rem;
      color: #6c757d;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <h1>Your App Server Running</h1>
  <div class="status" id="statusLine">Starting...</div>

  <div id="urlList"></div>
  <div class="hint">Other devices on the same Wi-Fi/Ethernet network use one of these URLs.</div>

  <div class="shortcuts" id="shortcuts"></div>

  <div class="port-row">
    <label for="portInput">Port:</label>
    <input type="number" id="portInput" min="1" max="65535" />
    <button id="changePortBtn" class="secondary">Change port</button>
  </div>
  <div class="port-message" id="portMessage"></div>

  <script src="control.js"></script>
</body>
</html>
~~~

Recommended `control.js`:

~~~javascript
'use strict';

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function renderConnectionInfo(info) {
    $('statusLine').textContent = 'Listening on port ' + info.port;
    $('portInput').value = info.port || '';

    renderUrls(info);
    renderShortcuts(info);
  }

  function renderUrls(info) {
    var urlList = $('urlList');
    urlList.innerHTML = '';

    var urls = info.urls && info.urls.length ? info.urls : [info.localUrl];

    urls.forEach(function (url) {
      if (!url) return;

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
        window.controlApp.copyUrl(url);
        copyBtn.textContent = 'Copied!';
        window.setTimeout(function () {
          copyBtn.textContent = 'Copy';
        }, 1500);
      });

      row.appendChild(input);
      row.appendChild(copyBtn);

      if (window.controlApp.openExternalUrl) {
        var openBtn = document.createElement('button');
        openBtn.textContent = 'Open';
        openBtn.className = 'secondary';
        openBtn.addEventListener('click', function () {
          window.controlApp.openExternalUrl(url);
        });
        row.appendChild(openBtn);
      }

      urlList.appendChild(row);
    });

    if (!info.urls || info.urls.length === 0) {
      var warning = document.createElement('div');
      warning.className = 'hint';
      warning.textContent = 'No LAN network address detected. Local access still works at ' + info.localUrl + '.';
      urlList.appendChild(warning);
    }
  }

  function renderShortcuts(info) {
    var shortcuts = $('shortcuts');
    shortcuts.innerHTML = '';

    (info.shortcuts || []).forEach(function (shortcut) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = shortcut.label;
      button.addEventListener('click', function () {
        window.controlApp.openShortcut(shortcut.key);
      });

      shortcuts.appendChild(button);
    });
  }

  function loadConnectionInfo() {
    window.controlApp.getConnectionInfo().then(renderConnectionInfo);
  }

  $('changePortBtn').addEventListener('click', function () {
    var newPort = $('portInput').value;
    var messageEl = $('portMessage');

    messageEl.textContent = 'Changing port...';
    messageEl.className = 'port-message';

    window.controlApp.changePort(newPort).then(function (result) {
      if (result.ok) {
        messageEl.textContent = 'Port changed successfully.';
        messageEl.className = 'port-message ok';
        renderConnectionInfo(result.info || {
          port: result.port || newPort,
          urls: [],
          localUrl: 'http://localhost:' + (result.port || newPort),
          shortcuts: []
        });
      } else {
        messageEl.textContent = result.error || 'Could not change port.';
        messageEl.className = 'port-message error';
      }
    });
  });

  loadConnectionInfo();
})();
~~~

## Part E — Packaging config

Use `electron-builder` with the `dir` target.

~~~json
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
    "win": {
      "target": "dir"
    }
  }
}
~~~

Important:

- Use `"dir"`, not NSIS `"portable"`, for apps with persistent local data.
- Exclude `node_modules` if the launcher reads the project folder externally.
- Set `executableName` explicitly.

## Part F — Recommended launcher folder

After build:

~~~powershell
New-Item -ItemType Directory -Force -Path launcher
Move-Item dist\win-unpacked\* launcher\
~~~

Final structure:

~~~text
my-project/
├─ launcher/
├─ electron/
├─ server/
├─ frontend/
├─ database/
├─ app-settings.json
├─ node_modules/
├─ package.json
└─ package-lock.json
~~~

## Part G — Settings persistence

Store launcher settings in a visible JSON file in the project root.

~~~javascript
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'app-settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (err) {
    return {};
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}
~~~

## Part H — Optional single-session account enforcement

Only use this if your app has login accounts.

On login, invalidate existing sessions for the same user:

~~~javascript
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
~~~

Use `401` only for expired/invalid sessions:

~~~javascript
function requireAuth(req, res, next) {
  const session = findSessionByToken(req.cookies.session_token);

  if (!session) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  req.user = session.user;
  next();
}
~~~

Detect session expiration centrally in your API wrapper:

~~~javascript
let sessionExpiredHandler = null;
let sessionExpiredFired = false;

function onSessionExpired(handler) {
  sessionExpiredHandler = handler;
}

async function handleResponse(res) {
  if (res.status === 401 && !sessionExpiredFired) {
    sessionExpiredFired = true;
    if (sessionExpiredHandler) sessionExpiredHandler();
  }
}
~~~

## End result

- Editing server/frontend code takes effect on relaunch.
- You only rebuild when launcher code changes.
- A compact `480 × 420` launcher window shows LAN URLs, page shortcuts, and port controls.
- Port auto-recovers if the default is taken.
- Manual port changes never leave the app fully stopped.
- The project remains portable as a visible folder.