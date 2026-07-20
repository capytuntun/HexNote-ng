/* backup.js — make a single-file, complete copy of the database.
 *
 *   node server/backup.js [輸出檔]
 *
 * Copying server/data/ by hand is a trap: in WAL mode most recent writes live in
 * data.db-wal, so a copy of data.db alone can open to an empty (or unusable)
 * database. VACUUM INTO folds the WAL in and writes one consistent file, and it
 * is safe to run while the server is live.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function stamp() {
  const d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes());
}

const src = path.join(config.dataDir, 'data.db');
const out = path.resolve(process.argv[2] || path.join(config.dataDir, 'backup-' + stamp() + '.db'));

if (!fs.existsSync(src)) {
  console.error('找不到資料庫: ' + src);
  process.exit(1);
}
if (fs.existsSync(out)) {
  console.error('輸出檔已存在，不覆蓋: ' + out);
  process.exit(1);
}

let db;
try {
  db = new DatabaseSync(src);
  db.exec('PRAGMA busy_timeout = 10000');
  // Escape any quote in the path so a folder with an apostrophe cannot break out.
  db.exec("VACUUM INTO '" + out.replace(/'/g, "''") + "'");

  const check = new DatabaseSync(out);
  const users = check.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const notes = check.prepare('SELECT COUNT(*) AS n FROM notes').get().n;
  const images = check.prepare('SELECT COUNT(*) AS n FROM images').get().n;
  check.close();

  console.log('備份完成: ' + out);
  console.log('  ' + (fs.statSync(out).size / 1024).toFixed(0) + ' KB · ' +
    users + ' 個帳號 · ' + notes + ' 篇筆記 · ' + images + ' 張圖片');
  console.log('');
  console.log('這是單一完整檔案，不需要 -wal / -shm。要還原：');
  console.log('  1. 停止伺服器');
  console.log('  2. 刪除 data.db、data.db-wal、data.db-shm');
  console.log('  3. 把備份檔改名為 data.db');
} catch (e) {
  console.error('備份失敗: ' + e.message);
  process.exit(1);
} finally {
  if (db) try { db.close(); } catch (e) {}
}
