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
 *
 * What this file does NOT do yet (later steps):
 *   - No real queueUpdated events yet (Step 5) — the connection handler
 *     below only logs that someone connected, as a smoke test.
 *
 * Run it:
 *   npm install
 *   npm start
 *   Open http://localhost:3000/index.html in a browser.
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
require('./db');

const session = require('./middleware/session');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const queueRoutes = require('./routes/queue');

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------
// Express app
// ---------------------------------------------------------------
const app = express();

// Parses JSON request bodies (req.body) — needed for every POST/PATCH
// route below that reads e.g. req.body.username.
app.use(express.json());

// Parses the Cookie header (req.cookies) — needed to read the
// jsq_session cookie that session.attachSession looks for.
app.use(cookieParser());

// Figures out who's logged in (or not) for every request, before any
// route handler runs. Routes that need to *require* a login use
// session.requireAuth / session.requireAdmin on top of this.
app.use(session.attachSession);

// REST API routes.
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/queue', queueRoutes);

// Serves the frontend/ folder as static files. Placed after the API
// routes so /api/* is never accidentally matched as a static file.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// ---------------------------------------------------------------
// HTTP + Socket.IO: Socket.IO needs a raw http.Server (not just the
// Express app) so it can upgrade connections to WebSockets.
// ---------------------------------------------------------------
const httpServer = http.createServer(app);
const io = new Server(httpServer);

io.on('connection', (socket) => {
    // Step-1 smoke test only. Real events (queueUpdated, etc.) are
    // added in Step 5 once the queue API exists.
    console.log('Socket.IO: client connected ->', socket.id);

    socket.on('disconnect', () => {
        console.log('Socket.IO: client disconnected ->', socket.id);
    });
});

httpServer.listen(PORT, () => {
    console.log('JS-Portable-Queue-LAN server running.');
    console.log('Open http://localhost:' + PORT + '/index.html');
});
