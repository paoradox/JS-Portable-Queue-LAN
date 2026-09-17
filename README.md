# JS-Portable-Queue-LAN

[![Website](https://img.shields.io/badge/website-offline-02aaff?style=for-the-badge&logo=githubpages)](https://paoradox.github.io/)
[![Built with](https://img.shields.io/badge/built_with-HTML%2FCSS%2FJS-02aaff?style=for-the-badge&logo=html5)](https://developer.mozilla.org/)

A multi-device, LAN-based queue management system — the network-capable evolution of [JS-Portable-Queue](https://github.com/paoradox/JS-Portable-Queue), rebuilt with a real backend so multiple devices on the same network share one live, synchronized queue.

The original project ran entirely on browser `localStorage`, which meant every device had its own separate, disconnected copy of the queue data. This version replaces that storage layer with a Node.js/Express server, a SQLite database, and Socket.IO real-time sync — while keeping the exact same queueing behavior, counter mappings, and user experience the original had. It also adds a desktop wrapper (Electron) so the whole thing can run as a double-clickable app on a host machine, with every other device on the network just using a normal web browser to connect.

> **What changed from the original:** everything under "Migration Objective" in the original README has been implemented. See [What Changed](#what-changed-from-js-portable-queue) below for the full list.

## Features

- User login and authentication, backed by bcrypt-hashed passwords in SQLite (not browser storage)
- User creation, editing, password reset, and role management from the admin panel
- Self-service counter assignment (an encoder picks their own station) separate from admin-driven counter reassignment
- Queue number issuing and manual value correction
- Regular, PWD, and Escalation queue pools, each with independent numbering
- Public display board with live "now serving" updates and audio notification on new calls
- Audit logging (last 100 actions, exportable as CSV, clearable by an admin)
- Administrative queue reset (per-pool or all pools)
- **Real-time sync across every connected device** via Socket.IO — no polling, no page refresh, no dependency on browser storage events
- **A YouTube video playlist** for the public display board's commercial section, driven by a plain-text `videos.txt` file — supports one or many videos, cycling automatically, with a safe fallback if the file or a video is unavailable
- Mobile-responsive layouts for all three pages, including horizontally-scrollable tables on the admin panel
- **A desktop app wrapper** (`QueueServer.exe`) that starts the server, detects the host's LAN IP, and gives you one-click shortcuts to the Display and Admin pages
- Runs entirely offline on a local network — no internet access, no cloud services, no port forwarding required (except for the optional YouTube playlist feature, which does need outbound internet access to reach YouTube)

## Queue Pools

| Queue Pool | Prefix |
| --- | --- |
| Regular Queue | Numeric |
| PWD Queue | `P` |
| Escalation Queue | `E` |

## Counters

`C1`, `C2`, `C3`, `C4`, `C5`, `C6`, `PWD`, `ESCAL`

## Application Pages

| Page | Purpose | Login required? |
| --- | --- | --- |
| `index.html` | Public display board — current queue numbers, recent activity, audio cues, video playlist | No |
| `encoder.html` | Queue issuing and counter operation screen | Yes |
| `admin.html` | User management, queue resets, audit log | Yes (admin) |

## Tech Stack

- **Frontend:** Plain HTML/CSS/JavaScript, Bootstrap 5 — no framework, no build step
- **Backend:** Node.js, Express, Socket.IO
- **Database:** SQLite via Node's built-in `node:sqlite` module (no native dependencies to compile)
- **Auth:** bcrypt password hashing, cookie-based sessions
- **Desktop wrapper:** Electron

## Project Structure

```text
JS-Portable-Queue-LAN/
├─ launcher/              ← QueueServer.exe + Electron's own runtime files (built, not hand-written)
├─ electron/              ← the launcher's source (main.js, preload.js, control window)
├─ server/                ← Express + Socket.IO + SQLite backend
│  ├─ db/                 ← schema + database connection
│  ├─ middleware/         ← session handling
│  ├─ routes/             ← REST API endpoints
│  ├─ services/           ← business logic (auth, queue)
│  ├─ events.js
│  └─ index.js
├─ frontend/              ← the actual web pages
│  ├─ assets/js/services/ ← API client, auth cache, queue cache (talks to the backend)
│  ├─ assets/js/          ← auth.js, queue.js, admin.js, encoder.js, display.js, ui.js
│  ├─ preview             ← preview screenshots of the system
│  ├─ index.html
│  ├─ encoder.html
│  ├─ admin.html
│  └─ videos.txt          ← the display board's video playlist (video/s for commercial, modify links here)
├─ database/
│  └─ queue.db            ← created automatically on first launch
├─ electron-settings.json ← created automatically (saved port)
├─ package.json
└─ package-lock.json
```

## Preview

Here are some screenshots from the system, showcasing its interface and key features:

| Launch Server & Setup Login | Encoding & Responsive Display | Admin Controls |
|----------------|-------------|---------------|
| ![Launch Server & Setup Login](frontend/preview/Launcher%20Server%20%26%20Setup%20Login.png) | ![Encoding & Responsive Display](frontend/preview/Encoding%20%26%20Responsive%20Display.png) | ![Admin Controls](frontend/preview/Admin%20Controls.png) |

## Running the Application

### Option 1 — Plain server (any OS, no desktop app)

```bash
npm install
npm start
```

Then open `http://localhost:3000/index.html` (or `/encoder.html`, `/admin.html`) in a browser. Other devices on the same network can reach it at `http://<this-machine's-LAN-IP>:3000/...`.

### Option 2 — Desktop app, dev mode

```bash
npm install
npm run electron
```

Opens the same server inside an Electron control window, showing your LAN connection URLs and shortcuts to the Display/Admin pages, without needing to build anything.

### Option 3 — Built windows desktop app (`QueueServer.exe`)

Prerequisites: Node.js 22.5.0 or newer (`node -v` to check).

```powershell
npm install
npm run dist
New-Item -ItemType Directory -Force -Path launcher
Move-Item dist\win-unpacked\* launcher\
```

Then double-click `launcher\QueueServer.exe`. This produces the layout shown in [Project Structure](#project-structure) above.

**Editing `server/` or `frontend/` after building never requires a rebuild** — the exe reads them live from disk. You only need to run `npm run dist` again if you change files inside `electron/` itself.

See [BUILD.md](./BUILD.md) for full build details, port configuration, and distributing the app to another machine.

## Resetting the Database

If you've lost admin credentials, want a completely clean slate, or don't have a SQLite browser tool to inspect `queue.db` directly, the simplest fix is deleting and letting it recreate itself:

1. Close the app (or stop `npm start`/the Electron app) completely.
2. Delete these three files from `database/`:
   - `queue.db`
   - `queue.db-shm`
   - `queue.db-wal`
3. Restart the app. A fresh, empty database is created automatically, and you'll be prompted to create a new admin account on first launch (the same first-run setup screen you saw the very first time).

This wipes all users, queue history, and the audit log — there's no partial/selective reset via file deletion. If you only need to fix one forgotten password rather than start over completely, see the direct-database-edit method in this repo's project history/documentation instead.

## Database

SQLite tables (auto-created on first launch, see `server/db/schema.sql`):

```text
users             — accounts, bcrypt password hashes, admin flag, assigned counter
sessions          — active login sessions (cookie-based)
login_attempts    — lockout tracking (5 failed attempts = 30s lockout)
queue_pools       — the 3 pools and their prefix/last-issued-number
queue_counters    — the 8 counters and their current value
queue_logs        — audit log, capped at the most recent 100 entries
settings          — reserved for future use
```

## Real-Time Updates

The server emits a `queueUpdated` Socket.IO event whenever anything changes (issuing, manual set, reset, log clear). Every connected browser — on any device — receives it instantly and re-renders, with no polling and no manual refresh. A newly-connecting browser also receives a full snapshot immediately on connect, so it's never showing stale data while waiting for the next change.

## Security Notes

- Passwords are hashed with bcrypt (via `bcryptjs`, a pure-JavaScript implementation — no native compiling required)
- Sessions are random, unguessable tokens stored server-side and referenced by an httpOnly cookie
- Reads (queue state, logs) are public, matching the original app's behavior where anyone with the page open could read the data; mutations require login; destructive actions (resets, clearing the log, user management) require admin rights

## Network Requirements

Runs entirely on a local network — one host computer, the same Wi-Fi/Ethernet network, no internet access, no cloud services, no port forwarding or router configuration. The one exception is the optional YouTube video playlist feature on the display board, which needs outbound internet access from the host machine to reach YouTube; every other feature works fully offline.

## What Changed From JS-Portable-Queue

Everything the original README described under "Migration Objective" has been implemented:

- ✅ `localStorage` replaced entirely with Node.js + Express + SQLite + Socket.IO
- ✅ Frontend no longer calls `localStorage` directly — routed through service modules (`apiClient.js`, `authCache.js`, `queueCache.js`) exactly as the original's "Refactoring Strategy" section specified
- ✅ Authentication moved to SQLite with bcrypt hashing; REST endpoints for login/logout/session/change-password
- ✅ Queue REST API preserving all original numbering/prefix/counter behavior
- ✅ Real-time updates via Socket.IO's `queueUpdated` event, replacing `window.storage` events
- ✅ Display board updates instantly for all connected clients on the LAN
- ✅ SQLite auto-creates its database and all tables on first launch
- ✅ Electron desktop wrapper with LAN IP detection, connection URL display, and Display/Admin shortcuts
- ✅ Runs entirely on a local network with no internet/cloud dependency
- ✅ All original behaviors preserved: authentication, user management, password handling, queue issuing/calling, counter assignment, queue numbering, public display updates, audio notifications, audit logs, administrative resets, queue pools, and counter mappings

Plus additions beyond the original scope: mobile-responsive layouts, the YouTube playlist feature, and the external-folder Electron architecture that keeps `server/`/`frontend/` fully editable without rebuilding.

## License

Apache License 2.0
