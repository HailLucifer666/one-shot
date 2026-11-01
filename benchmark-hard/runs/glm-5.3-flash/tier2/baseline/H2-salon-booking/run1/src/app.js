'use strict';

/**
 * Express app factory. Tests call createApp({ dbPath, outboxDir }) with a
 * throwaway database; server.js uses the configured default paths.
 */

const express = require('express');
const path = require('path');
const config = require('./config');
const { openDb } = require('./db');
const { attachUser, errorHandler } = require('./http');
const { createAuthRouter } = require('./routes/auth');
const { createCatalogRouter } = require('./routes/catalog');
const { createBookingsRouter } = require('./routes/bookings');
const { createAdminRouter } = require('./routes/admin');
const { createStylistRouter } = require('./routes/stylist');

function createApp(options = {}) {
  const ctx = {
    db: openDb(options.dbPath || config.DB_PATH),
    outboxDir: options.outboxDir || config.OUTBOX_DIR,
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json());
  app.use(attachUser(ctx));

  app.use('/api/auth', createAuthRouter(ctx));
  app.use('/api', createCatalogRouter(ctx));
  app.use('/api', createBookingsRouter(ctx));
  app.use('/api', createStylistRouter(ctx));
  app.use('/api/admin', createAdminRouter(ctx));

  // 404 for unknown API paths (JSON, not the SPA shell).
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use(express.static(config.PUBLIC_DIR));

  app.ctx = ctx;
  app.db = ctx.db;
  app.outboxDir = ctx.outboxDir;
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, config, __publicDir: path };
