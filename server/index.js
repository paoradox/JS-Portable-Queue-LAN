/*
 * server/index.js — Application entry point.
 *
 * What this file does so far:
 *   Step 1 — Starts an Express web server, serves frontend/ as static
 *            files, starts a Socket.IO server on the same port.
 *   Step 2 — Opens/creates database/queue.db on startup (via ./db).
 *   Step 3 — Parses JSON request bodies and cookies, attaches
 *            req.session on every request, and mounts the auth/user
 *            REST endpoints under /api/auth and /api/users.
 *   Step 4 — Mounts the queue REST endpoints under /api/queue.
 *   Step 5 — Forwards queueService's internal 'queueUpdated' event
 *            (see server/events.js) to every connected browser over
 *            Socket.IO, and sends a fresh snapshot to any browser the
 *            moment it connects.
 *   Step 10 — Wrapped the actual "start listening" part in an exported
 *            start(port) function instead of running immediately at
 *            the top of the file. This lets electron/main.js reuse
 *            this EXACT SAME server code with its own port-selection
 *            logic (try the saved port, fall back to another one if
 *            it's taken) — the server code itself doesn't change one
 *            bit between "plain Node" mode and "inside Electron" mode.
 *
 * Run it directly (unchanged from before):
 *   npm install
 *   npm start
 *   Open http://localhost:3000/index.html in a browser.
 *
 * Or require it as a module (what electron/main.js does):
 *   const { start } = require('./server/index.js');
 *   start(3000).then(({ port }) => { ... }).catch((err) => { ... });
 */

'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');

// Requiring ./db runs server/db/index.js immediately, which opens (or
// creates) database/queue.db and makes sure all tables + the fixed
// pool/counter rows exist before the server starts accepting requests.
// This happens once per process regardless of which port we end up
// listening on, so it stays at the top level rather than inside
// start().
require('./db');

const session = require('./middleware/session');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const queueRoutes = require('./routes/queue');
const queueService = require('./services/queueService');
const appEvents = require('./events');

const DEFAULT_PORT = process.env.PORT || 3000;

/**
 * Builds the Express app + Socket.IO server and starts listening on
 * the given port. Returns a Promise that resolves with
 * { port, httpServer, io } once actually listening, or rejects if the
 * port couldn't be bound (e.g. EADDRINUSE — something else is already
 * using it). Rejecting instead of crashing is what lets a caller like
 * electron/main.js catch the error and just try a different port.
 */
function start(port) {
    return new Promise((resolve, reject) => {
        const app = express();

        // Parses JSON request bodies (req.body) — needed for every
        // POST/PATCH route below that reads e.g. req.body.username.
        app.use(express.json());

        // Parses the Cookie header (req.cookies) — needed to read the
        // jsq_session cookie that session.attachSession looks for.
        app.use(cookieParser());

        // Figures out who's logged in (or not) for every request,
        // before any route handler runs. Routes that need to
        // *require* a login use session.requireAuth /
        // session.requireAdmin on top of this.
        app.use(session.attachSession);

        // REST API routes.
        app.use('/api/auth', authRoutes);
        app.use('/api/users', usersRoutes);
        app.use('/api/queue', queueRoutes);

        // Serves the frontend/ folder as static files. Placed after
        // the API routes so /api/* is never accidentally matched as a
        // static file.
        const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
        app.use(express.static(FRONTEND_DIR));

        // ---------------------------------------------------------------
        // HTTP + Socket.IO: Socket.IO needs a raw http.Server (not just
        // the Express app) so it can upgrade connections to WebSockets.
        // ---------------------------------------------------------------
        const httpServer = http.createServer(app);
        const io = new Server(httpServer);

        // Whenever queueService says something changed (issue, set,
        // reset — anything that calls appendLog internally), broadcast
        // it to every connected browser. This is the whole real-time
        // layer: no polling, no manual "did anything change?" checks
        // anywhere in the frontend.
        appEvents.on('queueUpdated', (payload) => {
            io.emit('queueUpdated', payload);
        });

        io.on('connection', (socket) => {
            console.log('Socket.IO: client connected ->', socket.id);

            // Send this one new connection the current state right
            // away, so a browser that just opened the page doesn't
            // have to wait for the next mutation to see real data —
            // same as an initial page load used to read straight out
            // of localStorage.
            socket.emit('queueUpdated', {
                state: queueService.getState(),
                logs: queueService.getLog()
            });

            socket.on('disconnect', () => {
                console.log('Socket.IO: client disconnected ->', socket.id);
            });
        });

        // 'error' must be listened for BEFORE calling listen() — if
        // the port is already taken, Node emits 'error' (EADDRINUSE)
        // instead of calling the listen() callback at all.
        httpServer.once('error', (err) => {
            reject(err);
        });

        httpServer.listen(port, () => {
            console.log('JS-Portable-Queue-LAN server running.');
            console.log('Open http://localhost:' + port + '/index.html');
            resolve({ port, httpServer, io });
        });
    });
}

module.exports = { start };

// Only auto-start immediately when this file is run directly (`node
// server/index.js` / `npm start`) — NOT when some other file
// `require()`s it (like electron/main.js does). This is the standard
// Node.js pattern for "usable both as a script and as a module".
if (require.main === module) {
    start(DEFAULT_PORT).catch((err) => {
        console.error('Failed to start server:', err.message);
        process.exit(1);
    });
}
