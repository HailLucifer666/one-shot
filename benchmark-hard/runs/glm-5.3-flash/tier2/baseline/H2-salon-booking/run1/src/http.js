'use strict';

/**
 * HTTP plumbing: cookies, sessions, auth middleware, error handling.
 * Sessions are opaque random tokens in an HttpOnly cookie; the database
 * stores only the SHA-256 hash of the token.
 */

const crypto = require('crypto');
const config = require('./config');

const COOKIE_NAME = 'cutwell_session';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function createSession(ctx, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = config.nowUtc();
  const expires = now.plus({ days: config.SESSION_TTL_DAYS });
  ctx.db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_utc, expires_utc) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, config.fmtUtc(now), config.fmtUtc(expires));
  return { token, maxAgeSeconds: config.SESSION_TTL_DAYS * 24 * 3600 };
}

function destroySession(ctx, req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearedCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Attach req.user (or null) from the session cookie. */
function attachUser(ctx) {
  return (req, res, next) => {
    req.user = null;
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) {
      const row = ctx.db
        .prepare(
          `SELECT u.id, u.email, u.name, u.role, s.expires_utc, s.token_hash
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ?`
        )
        .get(hashToken(token));
      if (row) {
        if (row.expires_utc <= config.nowIso()) {
          ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
        } else {
          req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
        }
      }
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
}

module.exports = {
  COOKIE_NAME,
  HttpError: require('./bookings').HttpError,
  createSession,
  destroySession,
  sessionCookie,
  clearedCookie,
  attachUser,
  requireAuth,
  requireRole,
  errorHandler,
  parseCookies,
};
