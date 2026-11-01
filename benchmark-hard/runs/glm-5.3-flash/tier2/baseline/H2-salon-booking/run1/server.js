'use strict';

const { createApp } = require('./src/app');
const config = require('./src/config');
const fs = require('fs');

fs.mkdirSync(config.OUTBOX_DIR, { recursive: true });

const app = createApp();
const server = app.listen(config.PORT, () => {
  const override = process.env.APP_NOW
    ? ` (clock override active: APP_NOW=${process.env.APP_NOW})`
    : '';
  console.log(`Cutwell Salon booking app running at http://localhost:${config.PORT}${override}`);
  console.log(`Salon timezone: ${config.SALON_TZ} | DB: ${config.DB_PATH} | Outbox: ${config.OUTBOX_DIR}`);
});

function shutdown() {
  server.close(() => {
    try {
      app.db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
