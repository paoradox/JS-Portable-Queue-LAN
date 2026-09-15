# Building "Portable Queue" (the desktop app)

This covers turning the project into a double-clickable desktop app for
the one machine that hosts the queue system on your LAN. Every other
device (staff phones/laptops, the public display) still just opens a
normal web browser — nothing here applies to them.

## Two different things this project can run as

| Mode | Command | What it is |
|---|---|---|
| Plain server | `npm start` | Runs in a terminal, no window. Same as every step so far. |
| Desktop app (dev mode) | `npm run electron` | Runs the exact same server, but inside an Electron window with the control panel (Steps 1–10). Good for testing before building a real distributable. |
| Desktop app (built) | see below | A folder you can copy anywhere (a USB drive, a shared folder, wherever) containing `Portable Queue.exe` and everything it needs. This is what you'd actually hand to someone, or leave running on the host machine long-term. |

## Prerequisites

Same as every previous step — Node.js installed, and `npm install` run
at least once in the project root. No new prerequisites for building;
`electron-builder` (added in this step) downloads everything else it
needs automatically the first time you build.

## Building the distributable

From the project root, on your Windows machine:

```powershell
npm run dist
```

This does three things:
1. Downloads a private copy of the Electron runtime for Windows if it isn't cached yet (a one-time, few-hundred-MB download the first time).
2. Copies `electron/`, `server/`, `frontend/`, and the production `node_modules` (not `nodemon`/`electron`/`electron-builder` themselves — those are only needed for building, not running) into an output folder.
3. Produces `dist/win-unpacked/Portable Queue.exe`, sitting next to all its resource folders.

**The output you actually use is the whole `dist/win-unpacked/` folder**, not just the `.exe` file by itself — the `.exe` needs the `resources/` folder sitting right next to it to run. Copy that whole folder to wherever you want to keep it (Desktop, a dedicated folder, a USB drive) and double-click `Portable Queue.exe` from there.

## Why "unpacked folder" instead of a single installer file

electron-builder can produce several different kinds of output — a
traditional installer (NSIS), a single self-extracting "portable" exe,
or this unpacked-folder style. Two reasons we're using the unpacked
folder specifically:

1. **Editable resources, as you asked for in Step 10.** `asar: false` in the packaging config means `frontend/`, `server/`, and `electron/` land as plain, individually-editable files inside `dist/win-unpacked/resources/app/` — open `admin.js` in a text editor after building and your change takes effect on the next launch, no rebuild needed. A traditional installer normally compresses everything into a single `app.asar` archive, which defeats that.
2. **electron-builder's "portable" exe target specifically extracts itself to a temporary folder that gets deleted when you close the app.** That's fine for stateless apps, but this app's whole database would be wiped out on every single close — the opposite of what a queueing appliance needs. The unpacked-folder approach doesn't have this problem: `database/queue.db` gets created right inside `resources/app/database/` (same as it already does when you run `npm start`) and stays there permanently between launches, because nothing ever gets extracted-and-deleted.

## What I validated (not just wrote and assumed)

I can't produce or run a real `.exe` from this sandbox (no Windows, no Wine), so the actual Windows build is something you'll run yourself — but I validated the entire packaging *logic* by building and running the equivalent Linux output here, which exercises the exact same electron-builder configuration:

- **Confirmed file inclusion is correct:** `express`, `socket.io`, `bcryptjs`, `cookie-parser` (production dependencies) are present in the packaged `node_modules/`; `electron`, `electron-builder`, and `nodemon` (dev-only, not needed to *run* the app) are correctly excluded.
- **Caught and fixed a real bug in my own first attempt:** the `database/` folder didn't make it into the package at all (its only file, `.gitkeep`, is a dotfile that the packaging glob pattern silently skipped). Confirmed this is harmless — `server/db/index.js`'s existing self-healing logic (from Step 2) creates the folder automatically on first run regardless — but removed the pointless config line rather than leave misleading config in place.
- **Confirmed the executable name comes out exactly right.** Windows and Linux/Mac don't agree by default on whether the built executable is named after `productName` or the internal `name` field — added `executableName: "Portable Queue"` to the config specifically to remove that ambiguity, then rebuilt and confirmed the output file is literally named `Portable Queue` (Linux) / would be `Portable Queue.exe` (Windows, same mechanism).
- **Ran the actual built executable** (not the dev-mode version) under a virtual display and took a real screenshot — control window rendered correctly, LAN IP detected, database created at the correct path inside the packaged folder structure, server started cleanly with no port conflicts.

## Rebuilding after making code changes

Because resources are unpacked (not bundled into `app.asar`), most
changes to `frontend/` files take effect immediately — just close and
reopen `Portable Queue.exe`, no rebuild needed. Changes to `server/` or
`electron/` files also take effect the same way, for the same reason.

You only need to re-run `npm run dist` when you've changed
`package.json`'s dependencies (added/removed an npm package) or the
`"build"` config itself.
