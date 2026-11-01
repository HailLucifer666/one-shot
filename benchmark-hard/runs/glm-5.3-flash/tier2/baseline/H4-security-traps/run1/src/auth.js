// Authentication primitives: password hashing, server-side sessions, cookie
// handling, and the auth/CSRF middleware chain.
//
// Passwords use scrypt with a per-user random salt (built into Node, no extra
// dependency) and are compared with timingSafeEqual so the comparison itself
// does not leak how many leading bytes matched.
//
// Sessions are random 32-byte tokens delivered in a cookie. Only a SHA-256
// hash of each token is stored server-side, so a copy of the database cannot
// be replayed as a valid session.

import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    hash.toString('hex'),
  ].join(':');
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = String(stored).split(':');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- sessions

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.data.sessions[sha256(token)] = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  db.save();
  return token;
}

export function destroySession(db, token) {
  if (!token) return;
  const key = sha256(token);
  if (db.data.sessions[key]) {
    delete db.data.sessions[key];
    db.save();
  }
}

export function userForSession(db, token) {
  if (!token) return null;
  const key = sha256(token);
  const entry = db.data.sessions[key];
  if (!entry) return null;
  if (Date.parse(entry.expiresAt) < Date.now()) {
    delete db.data.sessions[key];
    db.save();
    return null;
  }
  return db.data.users.find((u) => u.id === entry.userId) || null;
}

// ----------------------------------------------------------------- cookies

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[name] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function serializeCookie(name, value, { maxAge, httpOnly = false, sameSite } = {}) {
  let c = `${name}=${value}; Path=/`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (httpOnly) c += '; HttpOnly';
  if (sameSite) c += `; SameSite=${sameSite}`;
  return c;
}

// HttpOnly keeps the session token away from any script; SameSite=Lax stops
// the cookie from being attached to cross-site form POSTs (a CSRF vector).
export function sessionCookie(token) {
  return serializeCookie('sid', token, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie() {
  return serializeCookie('sid', '', { httpOnly: true, sameSite: 'Lax', maxAge: 0 });
}

// Double-submit CSRF token: readable by our own page script on purpose, and
// every state-changing request must echo it in the X-CSRF-Token header. The
// SameSite=Lax session cookie is the first line of defense; this is the second.
export function csrfCookie(token) {
  return serializeCookie('csrf', token, { sameSite: 'Strict' });
}

export function clearCsrfCookie() {
  return serializeCookie('csrf', '', { sameSite: 'Strict', maxAge: 0 });
}

export function newCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// -------------------------------------------------------------- middleware

// req.user is resolved globally for /api requests in server.js; this gate
// simply refuses requests that arrived without a valid session.
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Sign in required' });
  }
  next();
}

export function csrfProtect(req, res, next) {
  const header = req.get('x-csrf-token');
  if (!header || !req.cookies.csrf || !timingSafeEqualStr(header, req.cookies.csrf)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
}

// Issued on any API GET so that browsers (and curl users - see README) get a
// csrf cookie before their first state-changing request.
export function ensureCsrfCookie(req, res, next) {
  if (!req.cookies.csrf) {
    res.append('Set-Cookie', csrfCookie(newCsrfToken()));
  }
  next();
}

// ------------------------------------------------- login attempt throttling

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map();

export function loginThrottled(key) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.windowStart > LOGIN_WINDOW_MS) return false;
  return entry.count >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(key) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.windowStart > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { windowStart: Date.now(), count: 1 });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(key) {
  loginFailures.delete(key);
}
