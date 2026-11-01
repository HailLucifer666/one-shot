import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function openDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "cutwell.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer','stylist','admin')),
      created_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stylists (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      stylist_id INTEGER NOT NULL REFERENCES stylists(id),
      service_id TEXT NOT NULL,
      start_utc TEXT NOT NULL,
      end_utc TEXT NOT NULL,
      local_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('CONFIRMED','CANCELLED')),
      cancelled_by_user_id INTEGER REFERENCES users(id),
      cancelled_reason TEXT,
      cancelled_at_utc TEXT,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_stylist_start ON bookings (stylist_id, start_utc);
    CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings (customer_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_local_date ON bookings (local_date);
    CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings (start_utc);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at_utc TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_email TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('CREATE','CANCEL','RESCHEDULE')),
      booking_ref TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      details TEXT
    );
  `);
}

/**
 * Run `fn` inside an IMMEDIATE transaction: the write lock is taken up front,
 * so a check-then-insert pair cannot interleave with another writer. This is
 * what makes simultaneous bookings for the same slot pick exactly one winner.
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
