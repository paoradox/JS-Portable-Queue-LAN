-- server/db/schema.sql
--
-- Full database schema for JS-Portable-Queue-LAN.
-- Runs every time the server starts (CREATE TABLE IF NOT EXISTS is safe
-- to re-run — it does nothing if the table already exists), so the
-- database auto-creates itself correctly on first launch and is left
-- untouched on every launch after that.

-- ---------------------------------------------------------------
-- users — replaces the jsq.users localStorage key.
-- Note: unlike the old SHA-256 approach in auth.js, bcrypt embeds its
-- own salt inside the generated hash string, so there's no separate
-- salt column here — just one password_hash column holds everything
-- bcrypt needs to verify a password later.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                 TEXT PRIMARY KEY,
    username           TEXT NOT NULL UNIQUE,
    password_hash      TEXT NOT NULL,
    is_admin           INTEGER NOT NULL DEFAULT 0,
    counter            TEXT,
    counter_changed_at TEXT,
    created_at         TEXT NOT NULL
);

-- ---------------------------------------------------------------
-- sessions — replaces the jsq.session localStorage key.
-- Unlike the old single-session-per-browser design, this table can
-- hold one row per device/tab that's logged in at once, since
-- multiple devices are now the whole point of the LAN migration.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    token         TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_in_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------
-- login_attempts — replaces the jsq.loginAttempts localStorage key.
-- Same lockout fields auth.js already tracked per username.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
    username      TEXT PRIMARY KEY,
    count         INTEGER NOT NULL DEFAULT 0,
    locked_until  INTEGER
);

-- ---------------------------------------------------------------
-- queue_pools — replaces the "pools" section inside jsq.queue.
-- Fixed set of 3 rows (c, pwd, escal), seeded once by server/db/index.js.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_pools (
    name         TEXT PRIMARY KEY,
    prefix       TEXT NOT NULL DEFAULT '',
    last_issued  INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------
-- queue_counters — replaces the "counters" section inside jsq.queue.
-- Fixed set of 8 rows (c1-c6, pwd, escal), seeded once.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_counters (
    id           TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    pool         TEXT NOT NULL REFERENCES queue_pools(name),
    value        INTEGER,
    updated_at   TEXT,
    updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------
-- queue_logs — replaces the jsq.log localStorage key.
-- "extra" stores the same free-form fields the old log entries had
-- (counterId, pool, value, etc.) as a JSON string, since those fields
-- differ per action type.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,
    action    TEXT NOT NULL,
    user_id   TEXT,
    username  TEXT,
    extra     TEXT
);

-- ---------------------------------------------------------------
-- settings — generic key/value store for future app-level settings.
-- Not used by any current feature; included per the migration spec
-- so later steps have a place to put things like a schema version
-- number without needing another migration.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT
);
