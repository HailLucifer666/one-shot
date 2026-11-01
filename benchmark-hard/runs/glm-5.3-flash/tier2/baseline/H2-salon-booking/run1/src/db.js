'use strict';

/**
 * SQLite (better-sqlite3). One file, WAL mode. All writes that must be
 * race-safe run inside db.transaction(), which is fully synchronous in this
 * driver, so concurrent HTTP requests are serialized by the event loop and
 * two bookings can never interleave inside a transaction.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { STYLISTS, SERVICES, hmToMinutes } = require('./schedules');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','stylist','admin')),
  created_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stylists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  workdays TEXT NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  saturday_end_minute INTEGER
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  stylist_id INTEGER NOT NULL REFERENCES stylists(id),
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  start_local_date TEXT NOT NULL,
  start_local_time TEXT NOT NULL,
  end_local_date TEXT NOT NULL,
  end_local_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  cancel_reason TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  cancelled_utc TEXT,
  created_utc TEXT NOT NULL,
  updated_utc TEXT NOT NULL
);

-- Fast overlap lookups: every active booking of a stylist, time-ordered.
CREATE INDEX IF NOT EXISTS idx_bookings_stylist_time
  ON bookings(stylist_id, start_utc, end_utc);

-- Belt and braces for the race test: two confirmed bookings can never share
-- the same stylist and start instant, even if application logic regressed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot
  ON bookings(stylist_id, start_utc) WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id, start_utc);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_utc TEXT NOT NULL,
  expires_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_failures (
  email TEXT NOT NULL,
  at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_failures ON login_failures(email, at_utc);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_utc TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','cancel','reschedule')),
  booking_ref TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);
`;

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

/** Idempotent seed: services, stylist+admin+demo accounts. */
function seed(db) {
  const now = config.nowIso();

  const insService = db.prepare(
    `INSERT INTO services (code, name, duration_minutes, price_cents)
     VALUES (@code, @name, @duration_minutes, @price_cents)
     ON CONFLICT(code) DO NOTHING`
  );
  for (const s of SERVICES) insService.run(s);

  const insUser = db.prepare(
    `INSERT INTO users (email, name, password_hash, role, created_utc)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO NOTHING`
  );
  const getUser = db.prepare('SELECT id FROM users WHERE email = ?');

  insUser.run(
    config.SEED_ADMIN_EMAIL,
    'Salon Admin',
    bcrypt.hashSync(config.SEED_ADMIN_PASSWORD, 10),
    'admin',
    now
  );

  const insStylist = db.prepare(
    `INSERT INTO stylists (code, name, user_id, workdays, start_minute, end_minute, saturday_end_minute)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO NOTHING`
  );
  for (const st of STYLISTS) {
    const email = `${st.code}@cutwell.example`;
    insUser.run(email, st.name, bcrypt.hashSync(config.SEED_STYLIST_PASSWORD, 10), 'stylist', now);
    const user = getUser.get(email);
    insStylist.run(
      st.code,
      st.name,
      user.id,
      st.days.join(','),
      hmToMinutes(st.start),
      hmToMinutes(st.end),
      st.saturdayEnd ? hmToMinutes(st.saturdayEnd) : null
    );
  }

  insUser.run(
    config.SEED_DEMO_CUSTOMER_EMAIL,
    'Demo Customer',
    bcrypt.hashSync(config.SEED_DEMO_CUSTOMER_PASSWORD, 10),
    'customer',
    now
  );
}

module.exports = { openDb, seed };
