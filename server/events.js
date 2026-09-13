/*
 * server/events.js — A single shared event emitter for the whole app.
 *
 * Why this file exists: queueService.js has no idea Socket.IO exists,
 * and that's on purpose — it's a plain business-logic module that
 * could be tested or reused without a running web server. But it
 * still needs some way to say "the queue just changed" without
 * importing Express/Socket.IO directly.
 *
 * The fix is Node's built-in EventEmitter as a middleman:
 *   queueService.js  -->  events.emit('queueUpdated', payload)
 *   server/index.js  -->  events.on('queueUpdated', ...) --> io.emit(...)
 *
 * Nothing here is Socket.IO-specific — it's just plumbing.
 */

'use strict';

const EventEmitter = require('events');

module.exports = new EventEmitter();
