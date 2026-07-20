/* server.js — zero-dependency HTTP server: static front-end + /api.
 *
 * Run:  node server/server.js
 * Env:  PORT, REGISTER_MODE, INVITE_CODE, TRUST_PROXY, REQUIRE_HTTPS, DATA_DIR
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const config = require('./config');
const auth = require('./auth');
const api = require('./api');
const dbmod = require('./db');
const hub = require('./hub');

// ---------------- single instance ----------------
//
// Two servers on one data.db is the most likely source of lock errors, and it is
// easy to do by accident (a stray terminal, a restart that did not take). Ports
// do not protect against it — a second instance on another port shares the file.
const LOCK = path.join(config.dataDir, 'server.lock');

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }   // exists but owned by someone else
}

function takeLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, host: os.hostname() }), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = {};
      try { held = JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch (e2) { held = {}; }
      const pid = parseInt(held.pid, 10);
      // A lock written on another machine came along with a copied data folder.
      // Its PID means nothing here and might collide with a real local process,
      // so never let it block startup.
      if (held.host && held.host !== os.hostname()) {
        console.warn('[lock] 清除來自其他主機的 lock（' + held.host + '）');
        try { fs.unlinkSync(LOCK); } catch (e2) {}
        continue;
      }
      if (pid && pid !== process.pid && alive(pid)) {
        console.error('');
        console.error('  ✗ 已經有另一個伺服器在使用這個資料庫（PID ' + pid + '）');
        console.error('    同一個 data.db 被兩個行程寫入會造成鎖定錯誤與資料風險。');
        console.error('');
        console.error('    請先關閉那個行程：  ' +
          (process.platform === 'win32' ? 'taskkill /F /PID ' + pid : 'kill ' + pid));
        console.error('    或改用不同的資料夾： DATA_DIR=... node server/server.js');
        console.error('');
        return false;
      }
      // The previous run died without cleaning up.
      console.warn('[lock] 清除先前殘留的 lock（PID ' + pid + ' 已不存在）');
      try { fs.unlinkSync(LOCK); } catch (e2) {}
    }
  }
  return false;
}

function releaseLock() {
  try {
    const held = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    if (held.pid === process.pid) fs.unlinkSync(LOCK);
  } catch (e) {}
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// The front-end never loads anything off-site, so the policy can be tight.
// script-src stays free of 'unsafe-inline': the print document builds its
// paged.js config from the parent frame instead of an inline <script>.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  // Allow embedding same-origin PDFs (/api/images/:id) in an <iframe>; still blocks
  // any cross-origin framing, in either direction.
  "frame-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

function isSecure(req) {
  if (config.trustProxy) return req.headers['x-forwarded-proto'] === 'https';
  return !!req.socket.encrypted;
}

function securityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (config.requireHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function json(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const buf = await readBody(req, config.maxBodyBytes);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

// ---------------- static ----------------
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/') rel = '/index.html';
  // The database and server code live under the static root; never serve them.
  if (/^\/server(\/|$)/i.test(rel)) { json(res, 404, { error: 'not found' }); return; }

  const full = path.resolve(config.staticDir, '.' + rel);
  // Resolve first, then confirm the result is still inside the root — this is
  // what stops ../../ and encoded traversal from escaping.
  if (full !== config.staticDir && !full.startsWith(config.staticDir + path.sep)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }
  fs.stat(full, function (err, st) {
    if (err || !st.isFile()) { json(res, 404, { error: 'not found' }); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(full).pipe(res);
  });
}

// ---------------- API ----------------
function requireUser(req) {
  const cookies = auth.parseCookies(req.headers.cookie);
  return auth.userFromToken(cookies[auth.COOKIE]);
}

// SameSite=Strict already blocks cross-site cookie attachment; requiring a custom
// header on writes is a second lock, since a simple cross-origin form cannot set it.
function csrfOk(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  return req.headers['x-requested-with'] === 'report-notes';
}

function clientIp(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || '';
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (!csrfOk(req)) return json(res, 403, { error: 'CSRF check failed' });

  // ---- public endpoints ----
  if (p === '/api/register' && method === 'POST') {
    const body = await readJSON(req);
    const r = await auth.createUser(body.username, body.password, body.invite);
    if (r.error) return json(res, 400, { error: r.error });
    const token = auth.createSession(r.user.id);
    return json(res, 200, { user: r.user }, { 'Set-Cookie': auth.sessionCookie(token, isSecure(req)) });
  }

  if (p === '/api/login' && method === 'POST') {
    const body = await readJSON(req);
    const ip = clientIp(req);
    const wait = auth.isLockedOut(body.username, ip);
    if (wait) return json(res, 429, { error: '嘗試次數過多，請於 ' + wait + ' 秒後再試' });
    const user = await auth.verifyPassword(String(body.username || ''), String(body.password || ''));
    if (!user) {
      auth.noteFailure(body.username, ip);
      // Same message either way: never reveal whether the account exists.
      return json(res, 401, { error: '帳號或密碼錯誤' });
    }
    if (user.disabled) return json(res, 403, { error: '此帳號已被停用，請聯絡管理員' });
    auth.noteSuccess(body.username, ip);
    const token = auth.createSession(user.id);
    return json(res, 200, { user: user }, { 'Set-Cookie': auth.sessionCookie(token, isSecure(req)) });
  }

  if (p === '/api/logout' && method === 'POST') {
    const cookies = auth.parseCookies(req.headers.cookie);
    auth.destroySession(cookies[auth.COOKIE]);
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie(isSecure(req)) });
  }

  if (p === '/api/me' && method === 'GET') {
    const user = requireUser(req);
    return json(res, 200, {
      user: user ? {
        id: user.id, username: user.username, role: user.role,
        mustChangePassword: !!user.must_change_pw
      } : null,
      registerMode: config.registerMode
    });
  }

  // ---- everything below needs a session ----
  const user = requireUser(req);
  if (!user) return json(res, 401, { error: '請先登入' });

  const send = r => (r && r.status) ? json(res, r.status, { error: r.error || 'error' }) : json(res, 200, r);

  if (p === '/api/change-password' && method === 'POST') {
    const body = await readJSON(req);
    const check = await auth.verifyPassword(user.username, String(body.current || ''));
    if (!check || check.disabled) return json(res, 401, { error: '目前的密碼不正確' });
    if (String(body.next || '') === String(body.current || '')) {
      return json(res, 400, { error: '新密碼不能與目前的密碼相同' });
    }
    const r = await auth.setPassword(user.id, String(body.next || ''));
    if (r.error) return json(res, 400, { error: r.error });
    return json(res, 200, { ok: true });
  }

  // ---- admin only ----
  if (p.startsWith('/api/admin/')) {
    if (user.role !== 'admin') return json(res, 403, { error: '需要管理員權限' });

    if (p === '/api/admin/users' && method === 'GET') return json(res, 200, api.adminListUsers(user));

    let am;
    if ((am = p.match(/^\/api\/admin\/users\/(\d+)\/disabled$/)) && method === 'POST') {
      const body = await readJSON(req);
      return send(api.adminSetDisabled(user, am[1], !!body.disabled));
    }
    if ((am = p.match(/^\/api\/admin\/users\/(\d+)\/role$/)) && method === 'POST') {
      const body = await readJSON(req);
      return send(api.adminSetRole(user, am[1], String(body.role || '')));
    }
    if ((am = p.match(/^\/api\/admin\/users\/(\d+)$/)) && method === 'DELETE') {
      return send(api.adminDeleteUser(user, am[1]));
    }
    return json(res, 404, { error: 'not found' });
  }

  if (p === '/api/notes' && method === 'GET') return json(res, 200, { notes: api.listNotes(user) });
  if (p === '/api/notes' && method === 'POST') {
    return json(res, 200, { note: api.createNote(user, await readJSON(req)) });
  }

  let m;
  if ((m = p.match(/^\/api\/notes\/([\w.-]+)$/))) {
    const id = m[1];
    if (method === 'GET') {
      const note = api.getNote(user, id);
      return note ? json(res, 200, { note }) : json(res, 404, { error: 'not found' });
    }
    if (method === 'PUT') return send(api.updateNote(user, id, await readJSON(req)));
    if (method === 'DELETE') return send(api.deleteNote(user, id));
  }

  // Live-collaboration event stream (Server-Sent Events). Held open; the client's
  // EventSource reconnects on its own if the socket drops.
  if ((m = p.match(/^\/api\/notes\/([\w.-]+)\/events$/)) && method === 'GET') {
    if (!api.getNote(user, m[1])) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'          // stop nginx buffering the stream
    });
    res.write('retry: 3000\n\n');
    const unsubscribe = hub.subscribe(m[1], res, user);
    req.on('close', unsubscribe);
    return;                              // keep the response open
  }

  // Live caret relay for collaborative editing (transient, never stored).
  if ((m = p.match(/^\/api\/notes\/([\w.-]+)\/cursor$/)) && method === 'POST') {
    return send(api.broadcastCursor(user, m[1], await readJSON(req)));
  }

  if ((m = p.match(/^\/api\/notes\/([\w.-]+)\/shares$/))) {
    if (method === 'GET') return send(api.listShares(user, m[1]));
    if (method === 'POST') return send(api.addShare(user, m[1], await readJSON(req)));
  }
  if ((m = p.match(/^\/api\/notes\/([\w.-]+)\/shares\/([\w.-]+)$/))) {
    if (method === 'DELETE') return send(api.removeShare(user, m[1], m[2]));
  }

  if (p === '/api/folders' && method === 'GET') return json(res, 200, { folders: api.listFolders(user) });
  if (p === '/api/folders' && method === 'POST') {
    return json(res, 200, { folder: api.createFolder(user, await readJSON(req)) });
  }
  if ((m = p.match(/^\/api\/folders\/([\w.-]+)$/))) {
    if (method === 'PUT') return send(api.updateFolder(user, m[1], await readJSON(req)));
    if (method === 'DELETE') return send(api.deleteFolder(user, m[1]));
  }

  if (p === '/api/images' && method === 'POST') {
    const mime = String(req.headers['content-type'] || 'image/png').split(';')[0];
    // Images plus PDF attachments (embedded in notes with the pdf: scheme).
    if (!/^image\//.test(mime) && mime !== 'application/pdf') {
      return json(res, 400, { error: '只接受圖片或 PDF' });
    }
    const buf = await readBody(req, config.maxBodyBytes);
    return json(res, 200, api.createImage(user, mime, buf));
  }
  if ((m = p.match(/^\/api\/images\/([\w.-]+)$/))) {
    const id = m[1];
    if (method === 'GET') {
      const row = api.getImage(user, id);
      if (!row) return json(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'Content-Type': row.mime,
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(Buffer.from(row.data));
    }
    if (method === 'PUT') return send(api.saveImage(user, id, await readJSON(req)));
    if (method === 'DELETE') return send(api.deleteImage(user, id));
  }
  if ((m = p.match(/^\/api\/images\/([\w.-]+)\/meta$/))) {
    if (method === 'GET') {
      const row = api.getImage(user, m[1]);
      if (!row) return json(res, 404, { error: 'not found' });
      return json(res, 200, {
        id: row.id, mime: row.mime,
        shapes: row.shapes ? JSON.parse(row.shapes) : [],
        hasOriginal: !!row.original,
        canAnnotate: row.owner_id === user.id
      });
    }
  }
  if ((m = p.match(/^\/api\/images\/([\w.-]+)\/original$/))) {
    if (method === 'GET') {
      const row = api.getImage(user, m[1]);
      if (!row) return json(res, 404, { error: 'not found' });
      const buf = row.original || row.data;
      res.writeHead(200, { 'Content-Type': row.mime, 'Cache-Control': 'private, no-cache' });
      return res.end(Buffer.from(buf));
    }
  }

  return json(res, 404, { error: 'not found' });
}

// ---------------- entry ----------------
const server = http.createServer(function (req, res) {
  securityHeaders(req, res);

  if (config.requireHttps && config.trustProxy && !isSecure(req)) {
    const host = String(req.headers.host || '').replace(/[^\w.:-]/g, '');
    res.writeHead(301, { Location: 'https://' + host + req.url });
    return res.end();
  }

  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch (e) { return json(res, 400, { error: 'bad request' }); }

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(function (e) {
      // Never leak stack traces to the client.
      console.error('[api]', req.method, url.pathname, '-', e.message);
      if (res.headersSent) return;
      // A locked database is transient and the client can retry — say so instead
      // of reporting a generic failure the user cannot act on. Checked with
      // isBusy() as well as the flag, because a plain single-statement write
      // throws SQLITE_BUSY straight from SQLite without passing through retry().
      if (e.busy || dbmod.isBusy(e)) {
        return json(res, 503, { error: '資料庫忙碌中，請稍後再試' }, { 'Retry-After': '1' });
      }
      json(res, 500, { error: 'server error' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  serveStatic(req, res, url.pathname);
});

if (!takeLock()) process.exit(1);

// Close the database cleanly on exit: checkpoint the WAL back into data.db and
// drop the lock, so the next start is not left tidying up after this one.
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log('\n收到 ' + signal + '，正在關閉…');
  server.close(function () {
    dbmod.close();
    releaseLock();
    console.log('已安全關閉（WAL 已寫回 data.db）');
    process.exit(0);
  });
  // Do not hang forever on a stuck connection.
  setTimeout(function () { dbmod.close(); releaseLock(); process.exit(0); }, 3000).unref();
}
['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].forEach(function (s) {
  try { process.on(s, () => shutdown(s)); } catch (e) {}
});
process.on('exit', releaseLock);

auth.ensureAdmin().then(function (created) {
  if (created) {
    console.log('');
    console.log('  ┌─ 已建立管理員帳號 ─────────────────────────');
    console.log('  │  帳號: ' + created.username);
    console.log('  │  密碼: ' + created.password);
    if (created.generated) {
      console.log('  │');
      console.log('  │  ⚠ 這是隨機產生的密碼，只會顯示這一次。');
      console.log('  │    首次登入時會要求你立刻更改。');
      console.log('  │    想自己指定請設 ADMIN_PASSWORD 環境變數。');
    }
    console.log('  └────────────────────────────────────────────');
  }
  start();
}).catch(function (e) {
  console.error('無法建立管理員帳號:', e.message);
  process.exit(1);
});

function start() {
server.listen(config.port, config.host, function () {
  console.log('報告筆記系統 — http://' + config.host + ':' + config.port);
  console.log('  註冊模式: ' + config.registerMode);
  if (config.registerMode === 'invite') {
    console.log('  邀請碼:   ' + config.inviteCode +
      (config.inviteCodeGenerated ? '   ← 隨機產生，重啟會變。請設 INVITE_CODE 環境變數固定它' : ''));
  }
  if (config.requireHttps && !config.trustProxy) {
    console.log('  ⚠ REQUIRE_HTTPS=1 但 TRUST_PROXY=0：若非本機測試，請放在 HTTPS 反向代理後並設 TRUST_PROXY=1');
  }
  if (!config.requireHttps) {
    console.log('  ⚠ REQUIRE_HTTPS=0：Cookie 不會加 Secure 旗標，僅適合 localhost 測試');
  }
  if (config.adminPassword) {
    console.log('  ⚠ ADMIN_PASSWORD 由環境變數指定 — 請確認它夠強，且沒有寫進版本控制');
  }
});
}
