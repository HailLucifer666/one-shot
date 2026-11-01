# Cutwell — salon booking system

A full-stack booking app for one salon. Customers register, book a service with a specific
stylist or "any available stylist", view, reschedule and cancel their bookings. Stylists
see a read-only schedule. Admins see all bookings with filters and pagination, cancel any
booking with a reason, export a 7-day CSV, and read an audit log of every change.

- Node.js 24 (uses the built-in `node:sqlite` module), Express, Luxon, bcryptjs, Zod.
- Server-rendered HTML that works without JavaScript; progressive enhancement adds a
  busy state to forms. No build step.
- Times are stored in UTC and displayed in the salon's time zone (America/Chicago),
  including across daylight saving changes.

## Prerequisites

- Node.js 24 or newer (`node --version`). No other tools, no native modules, no database
  server — SQLite is built into Node.

## Setup from a clean checkout

```bash
npm install
npm start
```

Then open http://localhost:3000. `npm install` creates `node_modules/`; on first start the
app creates `data/cutwell.db` (SQLite) and writes email files into `outbox/`. Both are
git-ignored. Configuration is optional — copy `.env.example` to `.env` to change anything;
`npm start` picks up `.env` automatically. Run tests with:

```bash
npm test
```

`npm run typecheck` runs the TypeScript checker (zero errors expected).

## Demo accounts

Created automatically on first start (they are demo credentials for local development,
**not** production secrets — override via environment variables before any real use):

| Role     | Email                | Password            |
| -------- | -------------------- | ------------------- |
| Admin    | `admin@cutwell.test` | `cutwell-admin-1`   |
| Stylists | `ana@cutwell.test`, `ben@cutwell.test`, `cleo@cutwell.test` | `cutwell-stylist-1` |

Customers register themselves on `/register` (password must be at least 10 characters).

## Configuration (all optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Directory for the SQLite database file |
| `OUTBOX_DIR` | `./outbox` | Where confirmation/cancellation email text files are written |
| `CUTWELL_NOW` | *(empty = real clock)* | **Testing clock override** — an ISO 8601 instant |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | `admin@cutwell.test` / `cutwell-admin-1` | Seeded admin account |
| `SEED_STYLIST_PASSWORD` | `cutwell-stylist-1` | Password for the three seeded stylist accounts |

### Setting the clock for testing

Set `CUTWELL_NOW` to an ISO 8601 instant, with `Z` or an explicit offset, for example:

```bash
# Run the salon "on" Saturday 2027-03-13, 06:00 Chicago time (before the DST change)
CUTWELL_NOW=2027-03-13T12:00:00Z npm start
```

The override is read on every request, so the clock can move while the server runs.
With this value, a booking for Saturday 2027-03-13 09:00 local is stored as
`2027-03-13T15:00:00.000Z` (CST, UTC-6) and a booking for Monday 2027-03-15 09:00 local
is stored as `2027-03-15T14:00:00.000Z` (CDT, UTC-5) — the DST transition on
2027-03-14 is handled by the `America/Chicago` zone data. An invalid value falls back to
the real clock with a console warning. The automated tests use the same mechanism.

## Business rules implemented

- Salon hours 9:00–18:00 Monday–Saturday; closed Sunday. Ana works Mon–Sat 9–18;
  Ben Tue–Sat 9–18 but Saturday only until 13:00; Cleo Mon/Wed/Fri 11–18.
- Services: Haircut 30 min / $35, Color 90 min / $120, Beard trim 15 min / $15,
  Cut and color 120 min / $140. Slots start every 15 minutes; a booking must end by the
  stylist's finish time.
- Bookings need at least 2 hours' notice and can be made up to 60 days ahead, never in
  the past (boundaries inclusive).
- Customers can cancel or reschedule up to 24 hours before the start; reschedule keeps
  the reference code and applies to the original appointment. Admins cancel any booking
  at any time with a required written reason.
- Sign-ins: bcrypt-hashed passwords, at most 5 failed attempts per account per rolling
  minute (the 6th attempt is blocked).
- Every create, cancel and reschedule is written to the audit log with who, when, and
  before/after snapshots (admin view).
- Emails are written as text files into `outbox/` (`<ref>-confirmation.txt`,
  `<ref>-cancellation.txt`) — no real email is sent.

## Project layout

```
src/
  server.ts        entry point (npm start)
  app.ts           app factory, security headers, request logs, error pages
  clock.ts         CUTWELL_NOW clock override
  salon.ts         services, stylist shifts, timezone helpers (America/Chicago)
  slots.ts         slot generation, booking window, overlap rules (pure functions)
  bookings.ts      create/cancel/reschedule inside BEGIN IMMEDIATE transactions
  auth.ts          sessions, password hashing, sign-in rate limiting
  db.ts, seed.ts   SQLite schema, migrations, demo seed
  email.ts, audit.ts, refs.ts, csv.ts, render.ts, middleware.ts
  routes/          authRoutes, book, my, stylist, admin
public/            styles.css, app.js (progressive enhancement), favicon
test/              59 automated tests (node --test)
```

## Tests

```bash
npm test
```

59 tests run with Node's built-in test runner, including: every acceptance rule
(shift/window/overlap rules per stylist), the DST storage check for 2027-03-13/15, the
two-simultaneous-requests race repeated 5 times over real HTTP, 200-booking reference
uniqueness, sign-in throttling, ownership/authorization checks, pagination and combined
filters, CSV boundaries, audit rows, and outbox files. Tests use throwaway databases
under `.tmp-test/` (git-ignored).

## Security notes

- Passwords: bcrypt (cost 10), minimum 10 characters. Sign-in throttling per account.
- Sessions: random 32-byte tokens in an HttpOnly, SameSite=Lax cookie; the session row is
  deleted on sign-out. No CSRF tokens because the cookie's SameSite=Lax blocks cross-site
  POSTs; add tokens if you relax that.
- All input is validated server-side (Zod + rule checks); all output is HTML-escaped;
  ownership and role checks run on every protected route and action.
- Security headers: CSP (`default-src 'self'`), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- No secrets are committed: `.env.example` documents every variable, and the demo seed
  credentials above are overridable environment values, not production secrets.

## Deploy

Single Node process + SQLite file. Works on any host that runs Node 24 (a VM, a
container, or a small VPS):

```bash
npm install --omit=dev
PORT=8080 DATA_DIR=/var/lib/cutwell OUTBOX_DIR=/var/lib/cutwell/outbox node src/server.ts
```

Put a reverse proxy (nginx/caddy) in front for TLS; the app itself is HTTP. SQLite is
single-writer, which is appropriate for one salon's traffic — if you later need multiple
instances, move to PostgreSQL first. Run `node src/server.ts` under a process manager
(systemd, pm2) and point health checks at `/health`.

## Known limitations

- One location, fixed services and shifts (code constants in `src/salon.ts`).
- Reschedule sends no email (the brief specifies emails for confirmation and
  cancellation only); the audit log records every reschedule.
- Sessions do not expire server-side beyond the 7-day cookie lifetime.
