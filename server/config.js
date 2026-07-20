/* config.js — runtime settings, all overridable by environment variables.
 *
 * Defaults are chosen for a public deployment: registration is invite-only and
 * cookies are marked Secure unless you explicitly say the server is plain HTTP.
 */
'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

function bool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  return v === '1' || String(v).toLowerCase() === 'true';
}
function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

const ROOT = path.resolve(__dirname, '..');

const config = {
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',

  // Static assets = the existing front-end, served from the repo root.
  staticDir: ROOT,
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'server', 'data'),

  // 'open' | 'invite' | 'closed'. Invite-only by default — an open registration
  // endpoint on a public host means anyone can help themselves to an account.
  registerMode: process.env.REGISTER_MODE || 'invite',
  inviteCode: process.env.INVITE_CODE || '',

  // Set TRUST_PROXY=1 when running behind nginx/Caddy so X-Forwarded-Proto is
  // honoured for the Secure cookie flag and for redirecting to HTTPS.
  trustProxy: bool(process.env.TRUST_PROXY, false),
  // Only turn this off for localhost testing. Over the public internet, a
  // session cookie without Secure is a session cookie you have given away.
  requireHttps: bool(process.env.REQUIRE_HTTPS, true),

  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 14),
  minPasswordLength: int(process.env.MIN_PASSWORD_LENGTH, 12),

  // Bootstrap admin. Leave ADMIN_PASSWORD unset to get a random one printed at
  // first start, which must then be changed on first login.
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // Login throttling, per username+IP.
  maxLoginAttempts: int(process.env.MAX_LOGIN_ATTEMPTS, 5),
  loginLockoutMs: int(process.env.LOGIN_LOCKOUT_MINUTES, 15) * 60 * 1000,

  maxBodyBytes: int(process.env.MAX_BODY_BYTES, 25 * 1024 * 1024), // images are posted whole

  // How long SQLite waits for a lock before giving up. 0 (the SQLite default)
  // means "fail instantly", which turns any brief contention into a failed save.
  busyTimeoutMs: int(process.env.BUSY_TIMEOUT_MS, 5000),
};

// An invite code that only exists in memory would change on every restart, so
// generate one and tell the operator to persist it.
if (config.registerMode === 'invite' && !config.inviteCode) {
  config.inviteCode = crypto.randomBytes(9).toString('base64url');
  config.inviteCodeGenerated = true;
}

module.exports = config;
