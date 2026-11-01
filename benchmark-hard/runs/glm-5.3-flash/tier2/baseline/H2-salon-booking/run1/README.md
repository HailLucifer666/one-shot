# Cutwell Salon - Booking System (H2)

A full-stack booking app for one salon. Customers register, sign in, pick a
service and a stylist (or "any available stylist"), book a slot, and manage
their bookings. Stylists see a read-only schedule. Admins see every booking,
can filter/paginate/export them, cancel with a reason, and inspect the audit
log. All times are stored in UTC and shown in the salon timezone
(America/Chicago), correctly across daylight saving changes.

## Stack

- **Backend:** Node.js (no build step), Express 4, SQLite via better-sqlite3
  (synchronous transactions make the concurrent-booking rule easy to prove),
  Luxon for timezone math, bcryptjs for password hashing.
- **Frontend:** vanilla HTML/CSS/JS single-page app served by the same server
  (hash routing, no framework, no bundler).
- **Tests:** Node's built-in test runner (`node --test`), 60 tests.

## Quick start (clean checkout)

Prerequisite: Node.js 18 or newer. No database server needed - SQLite is a
file inside `data/`.

```bash
npm install
npm start
```

Open http://localhost:3000. On first start the app creates and seeds
`data/cutwell.db` automatically.

Optional: `npm run seed` wipes and recreates the demo database (never
required, the app self-seeds), and `cp .env.example .env` if you want to
configure anything.

### Demo accounts (created automatically, local dev only)

| Role     | Email                  | Password        |
| -------- | ---------------------- | --------------- |
| Admin    | `admin@cutwell.example`| `cutwell-admin` |
| Stylist  | `ana@cutwell.example`  | `stylist-pass-1`|
| Stylist  | `ben@cutwell.example`  | `stylist-pass-1`|
| Stylist  | `cleo@cutwell.example` | `stylist-pass-1`|
| Customer | `customer@example.com` | `customer-pass-1`|

These are demo credentials for local development, not secrets. Real
customers register their own accounts (password minimum 10 characters,
stored as bcrypt hashes).

## Running the tests

```bash
npm test
```

One command, 60 automated tests, all business rules and all acceptance
criteria covered (booking windows, stylist schedules, overlaps, the
parallel-request race, cancellation cutoffs, reschedules, timezone/DST,
authorization isolation, rate limiting, pagination/filters, CSV, audit,
reference-code uniqueness). Each test file gets its own throwaway database
under `tmp/`, which is deleted afterwards.

## Setting the current time (clock override, for testing)

The app reads one environment variable, `APP_NOW`, on **every** request:

- `APP_NOW=2027-03-13T06:00:00Z` - a fixed ISO 8601 instant (UTC, or any
  explicit offset; a zone-less value is treated as UTC).
- Unset or empty - the real system clock is used.

Ways to set it:

```bash
# macOS / Linux shell
APP_NOW=2027-03-13T06:00:00Z npm start

# Windows cmd
set APP_NOW=2027-03-13T06:00:00Z && npm start

# or put it in .env (see .env.example)
APP_NOW=2027-03-13T06:00:00Z
```

Verify with `GET /api/now`, which returns the effective time and whether the
override is active. The UI shows a "Test clock" badge when the override is on.
Every test uses this override, which is how the DST acceptance criterion is
proven (Saturday 2027-03-13 09:00 local = 15:00Z stored, Monday 2027-03-15
09:00 local = 14:00Z stored, both display as 9:00 AM).

## Configuration (.env)

Copy `.env.example` to `.env`. All variables are optional:

| Variable                  | Default            | Meaning                              |
| ------------------------- | ------------------ | ------------------------------------ |
| `PORT`                    | `3000`             | HTTP port                            |
| `APP_NOW`                 | *(empty)*          | Clock override, ISO 8601 UTC         |
| `DB_PATH`                 | `data/cutwell.db`  | SQLite file                          |
| `OUTBOX_DIR`              | `outbox/`          | Fake-email .txt files                |
| `SEED_*_PASSWORD`         | *(demo values)*    | Passwords for the seeded demo users  |

No real secrets exist in this project; `.env` is git-ignored.

## Business rules implemented

- Salon: America/Chicago, Monday-Saturday 09:00-18:00, closed Sunday.
- Services: Haircut 30 min $35, Color 90 min $120, Beard trim 15 min $15,
  Cut and color 120 min $140.
- Stylists: Ana Mon-Sat 9-18; Ben Tue-Sat 9-18 but Saturday only until 13:00;
  Cleo Mon/Wed/Fri 11-18.
- Slots start every 15 minutes; a booking occupies its full duration and must
  end by the stylist's finish time (and salon close).
- A booking must be at least 2 hours ahead, at most 60 days ahead, never in
  the past.
- A stylist cannot have overlapping bookings; simultaneous requests for the
  same slot: exactly one succeeds (synchronous SQLite transaction plus a
  partial `UNIQUE` index on `(stylist_id, start_utc) WHERE status='confirmed'`).
- Customers cancel/reschedule up to 24 hours before the start; later attempts
  get a clear refusal. Admins cancel any time but must give a written reason.
- Reschedule keeps the reference code, enforces the 24-hour rule on the
  original time and all booking rules on the new time.
- Roles: customer (own bookings only), stylist (own schedule, read only),
  admin (everything).
- Sign-in: email + password (min 10 chars, bcrypt-hashed); at most 5 failed
  sign-ins per 60-second rolling window per account, the 6th is blocked (429).
- Each booking has a unique reference like `CW-7K2M9P`.
- Confirmation, cancellation and reschedule notices are written as readable
  `.txt` files into `outbox/` (no real email is sent).
- Admin: bookings list at 20/page filtered by date + stylist + status
  (combined), CSV export of the next 7 days (`ref, start, end, service,
  stylist, customer_email, status` with salon-local times), audit log of every
  create/cancel/reschedule with who, what, when, before and after.

## API overview

| Method & path                        | Who            | Purpose                                    |
| ------------------------------------ | -------------- | ------------------------------------------ |
| `POST /api/auth/register`            | everyone       | Create customer account                    |
| `POST /api/auth/login`               | everyone       | Sign in (sets session cookie)              |
| `POST /api/auth/logout`              | signed in      | Sign out                                   |
| `GET  /api/auth/me`                  | signed in      | Current user                               |
| `GET  /api/services` / `/api/stylists` | everyone     | Catalog                                    |
| `GET  /api/availability?serviceId&stylistId&date` | everyone | Bookable slots for a local date |
| `GET  /api/meta`, `/api/now`         | everyone       | Timezone/clock info (testing aid)          |
| `POST /api/bookings`                 | customer       | Book (`stylistId` numeric or `"any"`, `start` ISO UTC) |
| `GET  /api/bookings`                 | customer/admin | Own bookings (all for admin)               |
| `GET  /api/bookings/:ref`            | owner/admin    | One booking (404 for anyone else)          |
| `POST /api/bookings/:ref/cancel`     | owner/admin    | Cancel (admin requires `reason`)           |
| `POST /api/bookings/:ref/reschedule` | owner/admin    | Reschedule (`start` ISO UTC)               |
| `GET  /api/stylist/schedule`         | stylist        | Own schedule, read only                    |
| `GET  /api/admin/bookings`           | admin          | `page`, `date`, `stylistId`, `status`      |
| `GET  /api/admin/bookings/csv`       | admin          | CSV, next 7 days from current time         |
| `GET  /api/admin/audit`              | admin          | Audit log, newest first                    |

Errors are JSON: `{ "error": "human readable message" }` with 400/401/403/404/
409/422/429 depending on the cause.

## Project layout

```
server.js            entry point (npm start)
src/
  config.js          configuration, .env loader, APP_NOW clock override
  time.js            UTC <-> America/Chicago display helpers (Luxon)
  schedules.js       services + stylist schedules from the spec
  db.js              SQLite schema + idempotent seed
  availability.js    slot computation (salon hours, stylist windows, 15-min grid)
  bookings.js        create/cancel/reschedule rules, overlap + ref logic
  outbox.js          fake emails as .txt files
  audit.js           audit log writer/reader
  http.js            sessions, cookies, role middleware, error handler
  routes/            auth, catalog+availability, bookings, admin, stylist
public/              the single-page UI (index.html, app.js, styles.css)
tests/               60 automated tests (npm test)
scripts/seed.js      optional demo-database reset
```

## Design notes

- **Time.** Every timestamp is stored as a fixed-width UTC ISO string
  (`2027-03-15T14:00:00Z`), so lexicographic comparison equals chronological
  comparison. Local date/time columns (`start_local_date`, `start_local_time`)
  are written at mutation time via Luxon, which is what makes the admin date
  filter and the CSV "correct across DST" with no runtime tz math in SQL.
  Business hours never straddle the 2 AM DST transition, so wall-clock slot
  grids are unambiguous.
- **Concurrency.** better-sqlite3 is synchronous: a booking transaction
  (validate -> overlap check -> insert) cannot interleave with another request
  inside the Node event loop. The partial unique index is the belt-and-braces
  backstop; the race test fires duplicate requests in parallel 5 times and
  asserts exactly one 201 each round.
- **Sessions.** Opaque random tokens in an HttpOnly cookie; the DB stores only
  the SHA-256 hash of the token. Passwords are bcrypt hashes (cost 10).
- **Accessibility.** All controls are native elements with labels, focus is
  always visible (`:focus-visible`), slot search moves focus to the results,
  live regions announce loading/empty/error states, and the whole booking flow
  is operable by keyboard alone.
- **Responsive.** The page itself never scrolls sideways at 360 px or 1280 px;
  wide admin tables scroll inside their own container instead.

## Acceptance criteria mapping

| # | Criterion | Proof |
| - | --------- | ----- |
| 1 | Register/sign in/book/view/cancel end to end | `tests/e2e-flow.test.js` |
| 2 | Only slots where the stylist works and service fits (Ben Sat 12:45 not offered) | `tests/availability.test.js` |
| 3 | "Any available stylist" picks someone actually free | `tests/booking-rules.test.js` |
| 4 | <2 h, >60 days, past bookings refused | `tests/booking-rules.test.js` |
| 5 | Overlaps refused incl. partial (color 10:00 blocks haircut 11:15) | `tests/booking-rules.test.js` |
| 6 | Two parallel requests: exactly one succeeds, 5 rounds | `tests/concurrency.test.js` |
| 7 | Cancel >24 h OK, 23 h refused with clear message | `tests/cancel-reschedule.test.js` |
| 8 | Admin cancels inside window, reason required | `tests/cancel-reschedule.test.js` |
| 9 | Reschedule keeps ref, obeys both rule sets | `tests/cancel-reschedule.test.js` |
| 10 | Sunday never bookable; Cleo never before 11:00 / on Tuesday | `tests/availability.test.js` |
| 11 | DST: Mon 2027-03-15 9:00 local = 14:00Z; Sat 2027-03-13 9:00 local = 15:00Z | `tests/timezone.test.js` |
| 12 | No cross-customer access by changing ids/refs | `tests/auth-security.test.js` |
| 13 | Stylist sees only own schedule, cannot change it | `tests/auth-security.test.js` |
| 14 | Passwords hashed; <10 chars refused | `tests/auth-security.test.js` |
| 15 | 6th failed sign-in in a minute blocked | `tests/auth-security.test.js` |
| 16 | Unique refs across 200 bookings | `tests/admin.test.js` |
| 17 | Confirmation + cancellation files in `outbox/` | `tests/e2e-flow.test.js`, `tests/cancel-reschedule.test.js` |
| 18 | 20/page pagination, three filters combined | `tests/admin.test.js` |
| 19 | CSV = next 7 days, correct columns, local times | `tests/admin.test.js` |
| 20 | Audit records create/cancel/reschedule; customers blocked | `tests/cancel-reschedule.test.js`, `tests/auth-security.test.js` |
| 21 | Clock override works and is documented | this section + `tests/timezone.test.js` |
| 22 | Keyboard-only, visible focus, labelled inputs | `public/` (semantic HTML, `:focus-visible`, labels everywhere) |
| 23 | No sideways scrolling at 360 px / 1280 px | `public/styles.css` (`overflow-x: clip`, wrappers) |
| 24 | 20+ tests, one command | 60 tests, `npm test` |
| 25 | Clean-checkout setup, `.env.example`, no secrets | this README + `.env.example` |
| 26 | Empty/loading/error states on lists and forms | `public/app.js` (`state()` helper, inline alerts) |
| 27 | No unrequested features | nothing beyond the spec (no payments/SMS/reviews/loyalty) |

## Known limits

- Single salon, single process, SQLite file - matches the spec's scope.
- Sessions persist until expiry (7 days); there is no "log out everywhere".
- The CSV includes cancelled bookings too, with the `status` column telling
  them apart.
