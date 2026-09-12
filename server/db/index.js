/*
 * server/db/index.js — Database connection and first-launch setup.
 *
 * Uses Node's BUILT-IN `node:sqlite` module instead of an npm package
 * like better-sqlite3. That's a deliberate choice: `node:sqlite` ships
 * inside Node.js itself, so there is nothing to download or compile —
 * no Visual Studio / node-gyp / native build step, on any OS. The
 * trade-off is that it's still an "experimental" API in current Node
 * versions, which just means Node prints one warning line on startup
 * and the API could change in a future Node release. It's stable
 * enough for this project's needs (synchronous local reads/writes on
 * a single LAN server).
 *
 * Requires Node.js 22.5.0 or newer. Check with `node -v`.
 *
 * What this file does:
 *   1. Creates database/queue.db if it doesn't exist yet (DatabaseSync
 *      does this automatically just by opening the path).
 *   2. Runs schema.sql, which creates all 7 tables — safe to run on
 *      every server start, since CREATE TABLE IF NOT EXISTS is a no-op
 *      once the tables already exist.
 *   3. Seeds the fixed queue_pools and queue_counters rows (c1-c6, PWD,
 *      ESCAL) — these never change at runtime, they're just the
 *      hardware layout of the counters, so they only need to be
 *      inserted once, the first time the database is created.
 *
 * Every other server file (auth routes, queue routes, etc. — added in
 * later steps) will `require('./db')` and use the exported `db`
 * object to read/write data, instead of touching localStorage.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = path.join(__dirname, '..', '..', 'database');
const DB_PATH = path.join(DB_DIR, 'queue.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Same fixed values as the old queue.js POOLS/COUNTERS constants.
// Keeping them here (not invented) preserves the exact numbering
// and prefix behavior the frontend already depends on.
const POOLS = [
    { name: 'c',     prefix: ''  },
    { name: 'pwd',   prefix: 'P' },
    { name: 'escal', prefix: 'E' }
];

const COUNTERS = [
    { id: 'c1',    label: 'C1',    pool: 'c'     },
    { id: 'c2',    label: 'C2',    pool: 'c'     },
    { id: 'c3',    label: 'C3',    pool: 'c'     },
    { id: 'c4',    label: 'C4',    pool: 'c'     },
    { id: 'c5',    label: 'C5',    pool: 'c'     },
    { id: 'c6',    label: 'C6',    pool: 'c'     },
    { id: 'pwd',   label: 'PWD',   pool: 'pwd'   },
    { id: 'escal', label: 'ESCAL', pool: 'escal' }
];

// Make sure the database/ folder exists before DatabaseSync tries to
// create the .db file inside it.
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const isFirstLaunch = !fs.existsSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);

// WAL mode lets one process write while others read without locking
// the whole file — safer default for a server multiple devices hit
// at once.
db.exec('PRAGMA journal_mode = WAL');

// Run the schema. exec() runs a whole .sql file's worth of statements
// at once, same as it did with better-sqlite3.
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Seed the fixed pool/counter rows. INSERT OR IGNORE means: insert if
// the row doesn't exist yet, otherwise do nothing — so this is safe
// to run on every launch, not just the first one.
//
// Note: unlike better-sqlite3, node:sqlite has no built-in
// `db.transaction()` helper, so the transaction is wrapped manually
// with BEGIN/COMMIT — same effect, one extra line.
function seedFixedData() {
    const insertPool = db.prepare(
        'INSERT OR IGNORE INTO queue_pools (name, prefix, last_issued) VALUES (?, ?, 0)'
    );
    const insertCounter = db.prepare(
        'INSERT OR IGNORE INTO queue_counters (id, label, pool, value, updated_at, updated_by) ' +
        'VALUES (?, ?, ?, NULL, NULL, NULL)'
    );

    db.exec('BEGIN');
    try {
        POOLS.forEach((p) => insertPool.run(p.name, p.prefix));
        COUNTERS.forEach((c) => insertCounter.run(c.id, c.label, c.pool));
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

seedFixedData();

if (isFirstLaunch) {
    console.log('Database: created new database/queue.db and seeded pools/counters.');
} else {
    console.log('Database: opened existing database/queue.db.');
}

module.exports = { db, POOLS, COUNTERS };
