'use strict';

/**
 * AC 12 (cross-customer isolation), AC 13 (stylist read-only own schedule),
 * AC 14 (hashed passwords, 10-char minimum), AC 15 (5 failed sign-ins per
 * minute per account), AC 20 (customers cannot view the audit log).
 */

const { test, before, after } = require('node:test');
const {
  startServer,
  client,
  registerCustomer,
  login,
  book,
  SEED,
  assert,
} = require('./helpers');

process.env.APP_NOW = '2027-03-13T06:00:00Z'; // Saturday 00:00 America/Chicago

let srv;
let alice; // customer A
let bob; // customer B
let ana; // stylist
const HAIRCUT = 1;
const ANA = 1;
const BEN = 2;
const MON_9 = '2027-03-15T14:00:00Z'; // Monday 09:00 local
const MON_10 = '2027-03-15T15:00:00Z';

before(async () => {
  srv = await startServer();
  alice = await registerCustomer(srv.base, 'alice@example.com');
  bob = await registerCustomer(srv.base, 'bob@example.com');
  ana = await login(srv.base, SEED.ana);
});

after(async () => srv.close());

test('AC 14: passwords under 10 characters are refused (9 is too short, 10 is fine)', async () => {
  const short = await bob('POST', '/api/auth/register', {
    name: 'Shorty',
    email: 'short-pass@example.com',
    password: 'abcdefghi', // 9 chars
  });
  assert.equal(short.status, 422);
  assert.match(short.data.error, /at least 10/i);

  const exactly10 = await bob('POST', '/api/auth/register', {
    name: 'Ten',
    email: 'ten-pass@example.com',
    password: 'abcdefghij', // exactly 10 chars
  });
  assert.equal(exactly10.status, 201);
});

test('AC 14: passwords are stored hashed, never in plaintext', async () => {
  const row = srv.db
    .prepare('SELECT password_hash FROM users WHERE email = ?')
    .get('alice@example.com');
  assert.ok(row.password_hash.startsWith('$2'), 'bcrypt hash format');
  assert.notEqual(row.password_hash, 'long-enough-password');
  assert.ok(row.password_hash.length >= 50);
});

test('AC 12: customer B cannot view, cancel or reschedule customer A booking by changing the ref', async () => {
  const bk = await book(alice, { serviceId: HAIRCUT, stylistId: ANA, start: MON_9 });

  const view = await bob('GET', `/api/bookings/${bk.ref}`);
  assert.equal(view.status, 404);

  const cancel = await bob('POST', `/api/bookings/${bk.ref}/cancel`, {});
  assert.equal(cancel.status, 404);

  const resched = await bob('POST', `/api/bookings/${bk.ref}/reschedule`, { start: MON_10 });
  assert.equal(resched.status, 404);

  // Bob's own list does not contain it either.
  const list = await bob('GET', '/api/bookings');
  assert.ok(!list.data.bookings.some((b) => b.ref === bk.ref));

  // The booking is untouched.
  const still = await alice('GET', `/api/bookings/${bk.ref}`);
  assert.equal(still.status, 200);
  assert.equal(still.data.booking.status, 'confirmed');
  assert.equal(still.data.booking.start_utc, MON_9);
});

test('AC 12: an unknown or malformed booking ref is a 404, not a leak', async () => {
  const res = await alice('GET', '/api/bookings/CW-NOPE00');
  assert.equal(res.status, 404);
});

test('AC 13: a stylist sees only their own schedule and cannot change anything', async () => {
  const withAna = await book(alice, { serviceId: HAIRCUT, stylistId: ANA, start: MON_10 });
  // Ben works Tue-Sat, so his booking goes on Tuesday 10:00 local.
  const withBen = await book(alice, { serviceId: HAIRCUT, stylistId: BEN, start: '2027-03-16T15:00:00Z' });

  const schedule = await ana('GET', '/api/stylist/schedule');
  assert.equal(schedule.status, 200);
  const refs = schedule.data.bookings.map((b) => b.ref);
  assert.ok(refs.includes(withAna.ref), 'own booking visible');
  // Ben's booking belongs to Ben, not to Ana.
  const benBooking = srv.db
    .prepare('SELECT ref FROM bookings WHERE stylist_id = ?')
    .get(BEN);
  assert.ok(!refs.includes(benBooking.ref), 'other stylist bookings not visible');

  // No mutation paths for stylists.
  const post = await ana('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-03-16T14:00:00Z',
  });
  assert.equal(post.status, 403);

  const cancel = await ana('POST', `/api/bookings/${withAna.ref}/cancel`, {});
  assert.equal(cancel.status, 403);

  const resched = await ana('POST', `/api/bookings/${withAna.ref}/reschedule`, {
    start: MON_9,
  });
  assert.equal(resched.status, 403);

  const list = await ana('GET', '/api/bookings');
  assert.equal(list.status, 403);
});

test('AC 13/20: stylists and customers cannot reach admin endpoints', async () => {
  const asStylist = await ana('GET', '/api/admin/bookings');
  assert.equal(asStylist.status, 403);
  const asStylistAudit = await ana('GET', '/api/admin/audit');
  assert.equal(asStylistAudit.status, 403);
  const asStylistCsv = await ana('GET', '/api/admin/bookings/csv');
  assert.equal(asStylistCsv.status, 403);

  const asCustomer = await alice('GET', '/api/admin/bookings');
  assert.equal(asCustomer.status, 403);
  const asCustomerAudit = await alice('GET', '/api/admin/audit');
  assert.equal(asCustomerAudit.status, 403, 'AC 20: customers cannot view the audit log');
});

test('unauthenticated requests are rejected with 401', async () => {
  const anon = client(srv.base);
  const res = await anon('GET', '/api/bookings');
  assert.equal(res.status, 401);
});

test('AC 15: the 6th failed sign-in within a minute is blocked', async () => {
  const email = 'rate-limited@example.com';
  await registerCustomer(srv.base, email, 'correct-password-123');
  const req = client(srv.base);

  for (let i = 1; i <= 5; i++) {
    const res = await req('POST', '/api/auth/login', { email, password: 'wrong-password' });
    assert.equal(res.status, 401, `attempt ${i} should be a normal failure`);
  }

  const sixth = await req('POST', '/api/auth/login', { email, password: 'wrong-password' });
  assert.equal(sixth.status, 429);
  assert.match(sixth.data.error, /wait a minute|too many/i);

  // Even the CORRECT password is blocked inside the window.
  const blocked = await req('POST', '/api/auth/login', { email, password: 'correct-password-123' });
  assert.equal(blocked.status, 429);

  // Another account is unaffected (limit is per account).
  const other = await req('POST', '/api/auth/login', SEED.customer);
  assert.equal(other.status, 200);

  // Once the window passes (clock moves 2 minutes), sign-in works again.
  const now = require('../src/config').nowUtc();
  process.env.APP_NOW = now.plus({ minutes: 2 }).toUTC().toISO();
  const again = await req('POST', '/api/auth/login', { email, password: 'correct-password-123' });
  assert.equal(again.status, 200);
  process.env.APP_NOW = '2027-03-13T06:00:00Z';
});
