'use strict';

/**
 * Central configuration. All times are handled with Luxon; the salon timezone
 * is fixed to America/Chicago (see spec).
 *
 * CLOCK OVERRIDE FOR TESTING (documented in README):
 *   Set APP_NOW to an ISO 8601 datetime, e.g. 2027-03-13T06:00:00Z
 *   - A trailing "Z" or an explicit offset is honoured as-is.
 *   - A naive value (no zone) is interpreted as UTC.
 *   - When unset/empty, the real system clock is used.
 *   It is read on every call to nowUtc(), so tests can move the clock freely.
 */

const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const ROOT = path.resolve(__dirname, '..');

// Minimal .env loader (no dependency). KEY=VALUE lines; "#" comments; values
// may be quoted. Does not override variables already present in the environment.
(function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

// ---- Salon business constants -------------------------------------------

const SALON_TZ = 'America/Chicago';
const SALON_OPEN_MIN = 9 * 60; // 09:00 local
const SALON_CLOSE_MIN = 18 * 60; // 18:00 local
const SLOT_STEP_MIN = 15; // slots start every 15 minutes
const MIN_LEAD_HOURS = 2; // bookings at least 2 hours ahead
const MAX_HORIZON_DAYS = 60; // bookings at most 60 days ahead
const CANCEL_CUTOFF_HOURS = 24; // customer cancel/reschedule cutoff
const PAGE_SIZE = 20; // admin list page size
const SESSION_TTL_DAYS = 7;
const LOGIN_WINDOW_SECONDS = 60; // failed sign-in window
const LOGIN_MAX_FAILURES = 5; // at most 5 failed sign-ins per minute per account

// ---- Paths ---------------------------------------------------------------

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const DB_PATH = resolveFromRoot(process.env.DB_PATH || 'data/cutwell.db');
const OUTBOX_DIR = resolveFromRoot(process.env.OUTBOX_DIR || 'outbox');
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---- Seed accounts (local demo only; override via env) -------------------

const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@cutwell.example';
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'cutwell-admin';
const SEED_STYLIST_PASSWORD = process.env.SEED_STYLIST_PASSWORD || 'stylist-pass-1';
const SEED_DEMO_CUSTOMER_EMAIL =
  process.env.SEED_DEMO_CUSTOMER_EMAIL || 'customer@example.com';
const SEED_DEMO_CUSTOMER_PASSWORD =
  process.env.SEED_DEMO_CUSTOMER_PASSWORD || 'customer-pass-1';

// ---- Clock ---------------------------------------------------------------

/** Current time as a Luxon DateTime in UTC (honours the APP_NOW override). */
function nowUtc() {
  const raw = process.env.APP_NOW;
  if (!raw || !raw.trim()) return DateTime.utc();
  const dt = DateTime.fromISO(raw.trim(), { zone: 'utc' });
  if (!dt.isValid) {
    throw new Error(
      `Invalid APP_NOW "${raw}". Use an ISO 8601 datetime, e.g. 2027-03-13T06:00:00Z`
    );
  }
  return dt;
}

/**
 * Canonical storage format for all UTC timestamps in the database:
 * fixed-width "2027-03-15T14:00:00Z" so lexicographic comparison equals
 * chronological comparison.
 */
function fmtUtc(dt) {
  return dt.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function nowIso() {
  return fmtUtc(nowUtc());
}

module.exports = {
  ROOT,
  SALON_TZ,
  SALON_OPEN_MIN,
  SALON_CLOSE_MIN,
  SLOT_STEP_MIN,
  MIN_LEAD_HOURS,
  MAX_HORIZON_DAYS,
  CANCEL_CUTOFF_HOURS,
  PAGE_SIZE,
  SESSION_TTL_DAYS,
  LOGIN_WINDOW_SECONDS,
  LOGIN_MAX_FAILURES,
  PORT,
  DB_PATH,
  OUTBOX_DIR,
  PUBLIC_DIR,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_STYLIST_PASSWORD,
  SEED_DEMO_CUSTOMER_EMAIL,
  SEED_DEMO_CUSTOMER_PASSWORD,
  nowUtc,
  nowIso,
  fmtUtc,
};
