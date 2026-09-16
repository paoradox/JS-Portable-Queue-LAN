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
server or frontend code. It's a small launcher that finds and reads
`server/` and `frontend/` by searching upward from wherever it's
actually running — so it works whether the exe sits in the project
root or in its own subfolder. **Recommended:** keep it in a
`launcher/` subfolder, since Electron brings a fair amount of its own
runtime clutter (locales, DLLs, resource packs) that has nothing to do
with your app code — tucking that away keeps the actual project root
readable:

```
JS-Portable-Queue-LAN/
├─ launcher/                <- everything Electron-specific lives here
│  ├─ QueueServer.exe
│  ├─ resources/            <- Electron's own runtime files
│  ├─ locales/              <- also Electron's runtime, not app code
│  └─ *.dll / *.pak / ...    <- also Electron's runtime, not app code
│
├─ electron/                <- the launcher's own SOURCE code (main.js, preload.js, control window) — not the same as launcher/ above
├─ server/                  <- Express + Socket.IO + SQLite backend
├─ frontend/                <- the actual web pages (index.html, encoder.html, admin.html, etc.)
├─ database/
│  └─ queue.db              <- created automatically on first launch
├─ node_modules/            <- express, socket.io, bcryptjs, cookie-parser
├─ electron-settings.json   <- created automatically (saved port)
├─ package.json
└─ package-lock.json
```

**Why this matters day to day:** editing anything in `server/` or
`frontend/` takes effect the next time you launch `QueueServer.exe` —
no rebuild, ever. You only need to rebuild if you change
`electron/main.js`, `electron/preload.js`, or the control window's
files in `electron/renderer/`.

**About `launcher/`'s contents:** everything in there comes from
Electron itself, not from this project. Electron is built on Chromium,
and Chromium doesn't ship as a single file — this is normal for any
Electron app, not something specific to how this one is set up.
They're a one-time byproduct of building; you never edit or think
about them again afterward.

**You're not required to use a `launcher/` subfolder** — the exe finds
the real project root by searching upward, so it also works fine
sitting directly in the project root if you'd rather not have the
extra folder. The subfolder is just a tidiness choice.

## Prerequisites

- Node.js 22.5.0 or newer (needed for `node:sqlite` — check with `node -v`)
- Run `npm install` once in the project root

## Building QueueServer.exe (do this once, or after changing electron/ files)

From the project root, on Windows:

```powershell
npm run dist
```

This produces `dist/win-unpacked/`, containing `QueueServer.exe` plus
Electron's runtime files. Move that whole folder's contents into a
`launcher/` subfolder in your project root:

```powershell
New-Item -ItemType Directory -Force -Path launcher
Move-Item dist\win-unpacked\* launcher\
```

(Run that from the project root. It creates `launcher/` if it doesn't
exist yet, then moves `QueueServer.exe` and Electron's runtime files
into it — resulting in the layout shown above. Prefer the exe directly
in the project root instead? Skip the `launcher\` folder and move
straight into `.` — the exe finds the project root either way.)

You can then delete the now-empty `dist/` folder.

## Running it

Double-click `launcher\QueueServer.exe` (or run it from a terminal,
same thing). A control window opens showing:

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
| Anything in `frontend/` | No — just relaunch `launcher\QueueServer.exe` |
| Anything in `server/` | No — just relaunch `launcher\QueueServer.exe` |
| `electron/main.js`, `electron/preload.js`, or `electron/renderer/*` | Yes — run `npm run dist` again and replace the contents of `launcher/` |
| `package.json`'s dependencies (added/removed an npm package) | Run `npm install`, then relaunch (or rebuild if you also touched `electron/`) |

## Distributing this to another machine

Copy the entire project folder — `server/`, `frontend/`, `electron/`,
`launcher/`, `node_modules/`, `package.json` — to the new machine.
`database/` can be included (to carry existing data over) or left out
(a fresh one is created automatically on first launch). There's no
installer and nothing to register with Windows; it runs the moment you
double-click `launcher\QueueServer.exe`.
