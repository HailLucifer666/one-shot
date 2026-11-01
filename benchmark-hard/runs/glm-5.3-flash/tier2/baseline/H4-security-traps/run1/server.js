// RecipeBox server entry point.
//
//   npm start     -> serves on http://localhost:3000 (override with PORT)
//   npm test      -> runs the test suite
//
// Storage is a JSON file (data/db.json); photos live in uploads/. Both are
// created on first run and can be moved with DATA_DIR / UPLOAD_DIR.

import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

import { createDb } from './src/db.js';
import {
  parseCookies,
  hashPassword,
  ensureCsrfCookie,
  userForSession,
} from './src/auth.js';
import { ValidationError } from './src/validate.js';
import { authRoutes } from './src/routes/auth.js';
import { recipeRoutes } from './src/routes/recipes.js';
import { commentRoutes } from './src/routes/comments.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function seedAdmin(db) {
  if (db.data.users.some((u) => u.role === 'admin')) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@recipebox.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin-password-123';
  db.data.users.push({
    id: crypto.randomUUID(),
    email,
    displayName: 'Admin',
    role: 'admin',
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  });
  db.save();
  console.log(`Seeded admin account: ${email}`);
}

export function createApp(config = {}) {
  const dataDir = config.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data');
  const uploadsDir =
    config.uploadsDir || process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
  const publicDir = config.publicDir || path.join(ROOT, 'public');

  const db = createDb(dataDir);
  fs.mkdirSync(uploadsDir, { recursive: true });
  seedAdmin(db);

  const app = express();
  app.disable('x-powered-by');

  // Response headers applied to everything we serve.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use((req, res, next) => {
    req.db = db;
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Resolve the signed-in user (if any) for every API request. Public reads
  // use it to compute canEdit/canDelete; requireAuth enforces it for writes.
  app.use('/api', (req, res, next) => {
    req.user = userForSession(db, req.cookies.sid);
    next();
  });

  // Any API GET hands out a CSRF token cookie (double-submit pattern); every
  // non-GET route below is protected individually with csrfProtect.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return ensureCsrfCookie(req, res, next);
    }
    next();
  });

  app.use('/api/auth', authRoutes(db));
  app.use('/api', recipeRoutes(db, uploadsDir));
  app.use('/api', commentRoutes(db));
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Photos: only files we named ourselves (uuid.jpg / uuid.png) ever land in
  // uploads/, and serve-static normalizes paths, so nothing outside the
  // directory can be reached through this mount.
  app.use(
    '/uploads',
    express.static(uploadsDir, {
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    })
  );

  app.use(express.static(publicDir));

  // Central error handler. Unexpected errors log server-side and return a
  // plain 500 - stack traces and internals never reach the client.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Photo must be 2 MB or smaller'
          : `Upload rejected (${err.code})`;
      return res.status(status).json({ error: message });
    }
    if (err instanceof ValidationError || (err && err.status === 400)) {
      return res.status(400).json({ error: err.message });
    }
    if (err && err.status && err.status < 500) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

// Run the server only when executed directly (`node server.js` / npm start);
// tests import createApp instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => {
    console.log(`RecipeBox running at http://localhost:${port}`);
  });
}
