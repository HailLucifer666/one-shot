'use strict';

/**
 * Auth routes: register, login (with per-account failure rate limit),
 * logout, me.
 *
 * Rate limit: at most 5 FAILED sign-ins per 60-second rolling window per
 * account. The 6th attempt is refused (429) before the password is even
 * checked, so the correct password is also blocked until the window clears.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const {
  HttpError,
  createSession,
  destroySession,
  sessionCookie,
  clearedCookie,
  requireAuth,
} = require('../http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function recentFailures(db, email, nowDt) {
  const cutoff = config.fmtUtc(nowDt.minus({ seconds: config.LOGIN_WINDOW_SECONDS }));
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND at_utc > ?')
    .get(email, cutoff);
  return row.n;
}

function recordFailure(db, email) {
  db.prepare('INSERT INTO login_failures (email, at_utc) VALUES (?, ?)').run(email, config.nowIso());
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

function createAuthRouter(ctx) {
  const router = express.Router();
  const db = ctx.db;

  router.post('/register', (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const email = normEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!name || name.length > 80) throw new HttpError(422, 'Please give your name (up to 80 characters).');
    if (!EMAIL_RE.test(email)) throw new HttpError(422, 'Please give a valid email address.');
    if (password.length < 10) throw new HttpError(422, 'Password must be at least 10 characters.');
    if (password.length > 72) throw new HttpError(422, 'Password must be at most 72 characters.');

    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) throw new HttpError(409, 'An account with this email already exists. Please sign in.');

    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare('INSERT INTO users (email, name, password_hash, role, created_utc) VALUES (?, ?, ?, ?, ?)')
      .run(email, name, hash, 'customer', config.nowIso());

    const session = createSession(ctx, info.lastInsertRowid);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAgeSeconds));
    res.status(201).json({ user: { id: info.lastInsertRowid, email, name, role: 'customer' } });
  });

  router.post('/login', (req, res) => {
    const body = req.body || {};
    const email = normEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const nowDt = config.nowUtc();

    // Housekeeping: drop failure records older than 10 minutes.
    db.prepare('DELETE FROM login_failures WHERE at_utc < ?').run(
      config.fmtUtc(nowDt.minus({ minutes: 10 }))
    );

    if (recentFailures(db, email, nowDt) >= config.LOGIN_MAX_FAILURES) {
      throw new HttpError(
        429,
        'Too many failed sign-in attempts for this account. Please wait a minute and try again.'
      );
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      recordFailure(db, email);
      throw new HttpError(401, 'Invalid email or password.');
    }

    const session = createSession(ctx, user.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAgeSeconds));
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    destroySession(ctx, req);
    res.setHeader('Set-Cookie', clearedCookie());
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}

module.exports = { createAuthRouter, publicUser };
