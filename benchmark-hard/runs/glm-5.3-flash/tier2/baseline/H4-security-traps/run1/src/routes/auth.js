// /api/auth routes: register, login, logout, me.

import { Router } from 'express';
import crypto from 'node:crypto';
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
  sessionCookie,
  clearSessionCookie,
  clearCsrfCookie,
  requireAuth,
  csrfProtect,
  loginThrottled,
  recordLoginFailure,
  clearLoginFailures,
  userForSession,
} from '../auth.js';
import { requireEmail, requirePassword, optionalString } from '../validate.js';

export function publicUser(u) {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role };
}

export function authRoutes(db) {
  const router = Router();

  router.post('/register', csrfProtect, (req, res) => {
    const email = requireEmail(req.body?.email);
    const password = requirePassword(req.body?.password);
    const displayName =
      optionalString(req.body?.displayName, 'Display name', { max: 60 }) ||
      email.split('@')[0];
    // Only email, password and displayName are read from the request body.
    // Anything else a client sends (e.g. a "role" field) is ignored - the
    // role is always assigned server-side.
    if (db.data.users.some((u) => u.email === email)) {
      return res.status(409).json({ error: 'This email is already registered' });
    }
    const user = {
      id: crypto.randomUUID(),
      email,
      displayName,
      role: 'user',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    db.data.users.push(user);
    db.save();
    const token = createSession(db, user.id);
    res.append('Set-Cookie', sessionCookie(token));
    res.status(201).json({ user: publicUser(user) });
  });

  router.post('/login', csrfProtect, (req, res) => {
    const key = req.ip || 'unknown';
    if (loginThrottled(key)) {
      return res.status(429).json({
        error: 'Too many failed sign-in attempts. Try again in 15 minutes.',
      });
    }
    // Deliberately loose parsing here: a malformed or unknown email and a
    // wrong password both produce the exact same 401 response.
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const user = db.data.users.find((u) => u.email === email);
    const ok = user ? verifyPassword(password, user.passwordHash) : false;
    if (!ok) {
      recordLoginFailure(key);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    clearLoginFailures(key);
    const token = createSession(db, user.id);
    res.append('Set-Cookie', sessionCookie(token));
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', requireAuth, csrfProtect, (req, res) => {
    destroySession(req.db, req.cookies.sid);
    res.append('Set-Cookie', clearSessionCookie());
    res.append('Set-Cookie', clearCsrfCookie());
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    const user = userForSession(req.db, req.cookies.sid);
    res.json({ user: user ? publicUser(user) : null });
  });

  return router;
}
