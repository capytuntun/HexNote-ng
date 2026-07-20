/* db.js — schema and queries on Node's built-in SQLite. No npm dependencies.
 *
 * Every statement here is prepared with bound parameters; user input is never
 * concatenated into SQL.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'data.db'));

// WAL lets readers carry on while a write is in progress — without it, one save
// would block every page load.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// The important one. The default is 0: any contention throws SQLITE_BUSY
// immediately instead of waiting, which surfaced as a 500 on save whenever
// anything else touched the file (a backup, a second instance, a sqlite shell).
// With this, SQLite waits for the lock instead of giving up.
db.exec('PRAGMA busy_timeout = ' + config.busyTimeoutMs);

// NORMAL is the documented pairing for WAL: it cannot corrupt the database, and
// only risks losing the most recent transactions if the machine loses power.
// FULL would fsync on every autosave keystroke batch for no real gain here.
db.exec('PRAGMA synchronous = NORMAL');

// Keep the -wal file from growing without bound on a long-running server.
db.exec('PRAGMA wal_autocheckpoint = 512');

// ---------------- concurrency helpers ----------------

// DatabaseSync is synchronous, so a retry has to sleep synchronously too;
// setTimeout would not run until after this call returns.
const sleeper = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) { Atomics.wait(sleeper, 0, 0, ms); }

function isBusy(e) {
  const m = String(e && e.message || '');
  const c = String(e && e.code || '');
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i.test(m + ' ' + c);
}

// busy_timeout covers most contention, but not SQLITE_BUSY_SNAPSHOT: in WAL mode
// two writers that started from different snapshots get an instant failure that
// no amount of waiting inside SQLite will fix. Retrying the whole operation does.
function retry(fn, label) {
  let wait = 20;
  for (let attempt = 1; ; attempt++) {
    try { return fn(); }
    catch (e) {
      if (!isBusy(e) || attempt >= 5) {
        if (isBusy(e)) {
          const err = new Error('資料庫忙碌中，請稍後再試');
          err.busy = true;
          throw err;
        }
        throw e;
      }
      console.warn('[db] ' + (label || 'op') + ' 遇到鎖，第 ' + attempt + ' 次重試');
      sleepSync(wait);
      wait *= 2;
    }
  }
}

// BEGIN IMMEDIATE takes the write lock up front. A plain BEGIN starts as a reader
// and can fail when it tries to upgrade — the classic SQLite deadlock — which no
// retry can rescue once another writer is mid-transaction.
function tx(fn, label) {
  return retry(function () {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (e2) { /* already rolled back */ }
      throw e;
    }
  }, label);
}

function checkpoint() {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* busy: next time */ }
}

function close() {
  checkpoint();
  try { db.close(); } catch (e) {}
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,
    pw_hash    BLOB NOT NULL,
    pw_salt    BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    disabled   INTEGER NOT NULL DEFAULT 0,
    must_change_pw INTEGER NOT NULL DEFAULT 0,
    last_login INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    parent_id  TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id);

  CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id  TEXT,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    meta       TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_owner ON notes(owner_id);

  CREATE TABLE IF NOT EXISTS images (
    id         TEXT PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime       TEXT NOT NULL,
    data       BLOB NOT NULL,
    original   BLOB,
    shapes     TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_images_owner ON images(owner_id);

  CREATE TABLE IF NOT EXISTS shares (
    note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    perm       TEXT NOT NULL CHECK (perm IN ('read','edit')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (note_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
`);

// Columns added after the first release — ALTER fails harmlessly if already present.
['role TEXT NOT NULL DEFAULT \'user\'', 'disabled INTEGER NOT NULL DEFAULT 0',
 'must_change_pw INTEGER NOT NULL DEFAULT 0', 'last_login INTEGER'].forEach(function (col) {
  try { db.exec('ALTER TABLE users ADD COLUMN ' + col); } catch (e) { /* already there */ }
});
// rev: a per-note revision counter bumped on every save. Collaborative editing
// uses it to tell a fresh remote change from an echo of one's own save.
try { db.exec('ALTER TABLE notes ADD COLUMN rev INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* already there */ }

const q = {
  // users
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare(
    'SELECT id, username, created_at, role, disabled, must_change_pw FROM users WHERE id = ?'),
  insertUser: db.prepare(
    'INSERT INTO users (username, pw_hash, pw_salt, created_at, role) VALUES (?, ?, ?, ?, ?)'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  countAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0"),
  setPassword: db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, must_change_pw = 0 WHERE id = ?'),
  setMustChange: db.prepare('UPDATE users SET must_change_pw = ? WHERE id = ?'),
  touchLogin: db.prepare('UPDATE users SET last_login = ? WHERE id = ?'),

  // admin — metadata only; note contents are deliberately not exposed here
  listUsers: db.prepare(`
    SELECT u.id, u.username, u.role, u.disabled, u.created_at, u.last_login,
           (SELECT COUNT(*) FROM notes n WHERE n.owner_id = u.id)              AS notes,
           (SELECT COUNT(*) FROM folders f WHERE f.owner_id = u.id)            AS folders,
           (SELECT COUNT(*) FROM images i WHERE i.owner_id = u.id)             AS images,
           (SELECT COUNT(*) FROM shares s JOIN notes n2 ON n2.id = s.note_id
              WHERE n2.owner_id = u.id)                                        AS shared_out,
           (SELECT COUNT(*) FROM shares s2 WHERE s2.user_id = u.id)            AS shared_in
    FROM users u ORDER BY u.id`),
  setDisabled: db.prepare('UPDATE users SET disabled = ? WHERE id = ?'),
  setRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  deleteSessionsOf: db.prepare('DELETE FROM sessions WHERE user_id = ?'),

  // sessions
  insertSession: db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionByHash: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

  // folders
  foldersOf: db.prepare('SELECT * FROM folders WHERE owner_id = ?'),
  folderById: db.prepare('SELECT * FROM folders WHERE id = ?'),
  insertFolder: db.prepare(
    'INSERT INTO folders (id, owner_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)'),
  updateFolder: db.prepare('UPDATE folders SET name = ?, parent_id = ? WHERE id = ? AND owner_id = ?'),
  deleteFolder: db.prepare('DELETE FROM folders WHERE id = ? AND owner_id = ?'),

  // notes
  notesOwned: db.prepare('SELECT * FROM notes WHERE owner_id = ?'),
  notesSharedWith: db.prepare(`
    SELECT n.*, s.perm AS share_perm, u.username AS owner_name
    FROM notes n
    JOIN shares s ON s.note_id = n.id
    JOIN users u ON u.id = n.owner_id
    WHERE s.user_id = ?`),
  noteById: db.prepare('SELECT * FROM notes WHERE id = ?'),
  insertNote: db.prepare(`
    INSERT INTO notes (id, owner_id, folder_id, title, content, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  updateNote: db.prepare(
    'UPDATE notes SET folder_id = ?, title = ?, content = ?, meta = ?, updated_at = ?, rev = ? WHERE id = ?'),
  deleteNote: db.prepare('DELETE FROM notes WHERE id = ?'),

  // images
  imageById: db.prepare('SELECT * FROM images WHERE id = ?'),
  insertImage: db.prepare(`
    INSERT INTO images (id, owner_id, mime, data, original, shapes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  updateImage: db.prepare('UPDATE images SET mime = ?, data = ?, original = ?, shapes = ? WHERE id = ?'),
  deleteImage: db.prepare('DELETE FROM images WHERE id = ? AND owner_id = ?'),

  // shares
  shareFor: db.prepare('SELECT * FROM shares WHERE note_id = ? AND user_id = ?'),
  sharesOfNote: db.prepare(`
    SELECT s.*, u.username FROM shares s JOIN users u ON u.id = s.user_id WHERE s.note_id = ?`),
  insertShare: db.prepare(`
    INSERT INTO shares (note_id, user_id, perm, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(note_id, user_id) DO UPDATE SET perm = excluded.perm`),
  deleteShare: db.prepare('DELETE FROM shares WHERE note_id = ? AND user_id = ?'),

  // An image is readable by whoever can read a note that references it. Checking
  // ownership alone would break shared notes; skipping the check entirely would
  // let anyone enumerate ids and pull other people's screenshots.
  // Params: (needle, userId, userId)
  imageVisibleTo: db.prepare(`
    SELECT 1 FROM notes n
    WHERE instr(n.content, ?) > 0
      AND (n.owner_id = ? OR EXISTS (SELECT 1 FROM shares s WHERE s.note_id = n.id AND s.user_id = ?))
    LIMIT 1`)
};

module.exports = { db, q, tx, retry, checkpoint, close, isBusy };
