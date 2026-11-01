'use strict';

/**
 * Optional helper: wipe and recreate the demo database at DB_PATH, then
 * re-seed services, stylists, the admin and a demo customer. The app also
 * seeds automatically on first start, so running this is never required.
 */

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { openDb } = require('../src/db');

for (const suffix of ['', '-wal', '-shm']) {
  const p = config.DB_PATH + suffix;
  if (fs.existsSync(p)) fs.rmSync(p);
}

const db = openDb(config.DB_PATH);

const stylists = db.prepare('SELECT s.name, u.email FROM stylists s JOIN users u ON u.id = s.user_id').all();
const admin = db.prepare('SELECT email FROM users WHERE role = ?').get('admin');
const demo = db.prepare('SELECT email FROM users WHERE role = ?').get('customer');

console.log('Fresh database created at', path.resolve(config.DB_PATH));
console.log('');
console.log('Demo accounts (local only):');
console.log(`  admin    ${admin.email}  / ${config.SEED_ADMIN_PASSWORD}`);
for (const s of stylists) {
  console.log(`  stylist  ${s.email}  / ${config.SEED_STYLIST_PASSWORD}   (${s.name})`);
}
console.log(`  customer ${demo.email}  / ${config.SEED_DEMO_CUSTOMER_PASSWORD}`);
console.log('  ...or register any new customer account in the UI.');

db.close();
