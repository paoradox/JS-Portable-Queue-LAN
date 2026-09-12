/*
 * server/index.js — Application entry point.
 *
 * What this file does right now (Step 1 of the migration — scaffold only):
 *   1. Starts an Express web server.
 *   2. Serves the existing frontend/ folder exactly as-is (same HTML/CSS/JS
 *      that used to be opened through VS Code Live Server).
 *   3. Starts a Socket.IO server attached to that same web server, so later
 *      steps can push live queue updates to every connected browser tab.
 *
 * What this file does NOT do yet (later steps):
 *   - No /api/auth/* or /api/queue/* routes yet (Steps 3–4).
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
const http = require('http');
const { Server } = require('socket.io');

// Requiring ./db runs server/db/index.js immediately, which opens (or
// creates) database/queue.db and makes sure all tables + the fixed
// pool/counter rows exist before the server starts accepting requests.
require('./db');

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------
// Express app: serves the frontend/ folder as static files.
// ---------------------------------------------------------------
const app = express();
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
