# Building QueueServer.exe

This project can run three different ways. Pick whichever fits what
you're doing:

| Mode | Command | What it is |
|---|---|---|
| Plain server | `npm start` | Runs in a terminal, no window. Good for quick testing. |
| Desktop app, dev mode | `npm run electron` | Same server, inside the Electron control window. Good for testing the desktop experience without building anything. |
| Desktop app, built | `QueueServer.exe` (built once, see below) | What you actually run day to day on the host machine. |

Every mode runs the exact same `server/` and `frontend/` code — nothing
is duplicated or reimplemented between them.

## How this app is laid out (read this before building)

`QueueServer.exe` does **not** contain its own private copy of your
server or frontend code. It's a small launcher that reads `server/`
and `frontend/` from wherever it's actually sitting on disk. That
means the exe must live directly inside the project folder, next to
`server/`, `frontend/`, and `database/`:

```
JS-Portable-Queue-LAN/
├─ QueueServer.exe        <- built once (see below), lives here permanently
├─ resources/              <- Electron's own runtime files (see note below)
├─ locales/                <- also Electron's runtime, not app code
├─ *.dll / *.pak / ...      <- also Electron's runtime, not app code
│
├─ electron/               <- the launcher's own source (main.js, preload.js, control window)
├─ server/                 <- Express + Socket.IO + SQLite backend
├─ frontend/               <- the actual web pages (index.html, encoder.html, admin.html, etc.)
├─ database/
│  └─ queue.db             <- created automatically on first launch
├─ node_modules/           <- express, socket.io, bcryptjs, cookie-parser
├─ package.json
└─ package-lock.json
```

**Why this matters day to day:** editing anything in `server/` or
`frontend/` takes effect the next time you launch `QueueServer.exe` —
no rebuild, ever. You only need to rebuild if you change
`electron/main.js`, `electron/preload.js`, or the control window's
files in `electron/renderer/`.

**About the extra files next to the exe (`resources/`, `locales/`,
the `.dll`/`.pak` files):** those come from Electron itself, not from
this project. Electron is built on Chromium, and Chromium doesn't ship
as a single file — this is normal for any Electron app, not something
specific to how this one is set up. They're a one-time byproduct of
building; you never edit or think about them again afterward.

## Prerequisites

- Node.js 22.5.0 or newer (needed for `node:sqlite` — check with `node -v`)
- Run `npm install` once in the project root

## Building QueueServer.exe (do this once, or after changing electron/ files)

From the project root, on Windows:

```powershell
npm run dist
```

This produces `dist/win-unpacked/`, containing `QueueServer.exe` plus
Electron's runtime files. The **only** thing you need from that output
folder is `QueueServer.exe` itself and everything else electron-builder
put directly alongside it — copy or move it up one level so it sits
in the project root:

```powershell
Move-Item dist\win-unpacked\* . 
```

(On PowerShell, run that from the project root. It moves `QueueServer.exe`
and Electron's runtime files out of `dist/win-unpacked/` and into the
project root, where they belong — resulting in the layout shown above.)

You can then delete the now-empty `dist/` folder.

## Running it

Double-click `QueueServer.exe` (or run it from a terminal, same
thing). A control window opens showing:

- The port it's listening on
- The LAN URL(s) other devices should use
- Buttons to copy the URL, open the Display screen, or open the Admin panel
- A field to change the port, if you ever need to

`database/queue.db` is created automatically the first time you run
it, and persists in that same folder across every future launch —
closing and reopening the app never touches it.

## Changing the port

Two ways:
- **From the app:** type a new port in the control window and click "Change port."
- **By hand:** edit `electron-settings.json` in the project root (created after first launch) and restart the app.

If the saved/default port (3000) is already in use by something else,
the app automatically tries the next ones (3001, 3002, ...) instead of
failing to start.

## Rebuilding after code changes

| You changed... | Do you need to rebuild? |
|---|---|
| Anything in `frontend/` | No — just relaunch `QueueServer.exe` |
| Anything in `server/` | No — just relaunch `QueueServer.exe` |
| `electron/main.js`, `electron/preload.js`, or `electron/renderer/*` | Yes — run `npm run dist` again and replace the exe + its runtime files |
| `package.json`'s dependencies (added/removed an npm package) | Run `npm install`, then relaunch (or rebuild if you also touched `electron/`) |

## Distributing this to another machine

Copy the entire project folder — `server/`, `frontend/`, `electron/`,
`node_modules/`, `QueueServer.exe` and its runtime files, `package.json` —
to the new machine. `database/` can be included (to carry existing
data over) or left out (a fresh one is created automatically on first
launch). There's no installer and nothing to register with Windows;
it runs the moment you double-click the exe.
