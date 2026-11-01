'use strict';

/**
 * AC 6: two simultaneous requests for the same slot -> exactly one succeeds,
 * repeated 5 times. The requests are fired in parallel with Promise.all; the
 * synchronous SQLite transaction serializes the overlap check + insert, and a
 * partial UNIQUE index backs it up.
 */

const { test, before, after } = require('node:test');
const { startServer, registerCustomer, assert } = require('./helpers');

process.env.APP_NOW = '2027-03-13T06:00:00Z'; // Saturday 00:00 America/Chicago

let srv;
let customer;
const HAIRCUT = 1;
const ANA = 1;

// Tuesday 2027-03-16, five non-overlapping 30-minute haircut slots spaced
// 45 minutes apart: 09:00, 09:45, 10:30, 11:15, 12:00 local (CDT, UTC-5).
const ROUNDS = [
  '2027-03-16T14:00:00Z',
  '2027-03-16T14:45:00Z',
  '2027-03-16T15:30:00Z',
  '2027-03-16T16:15:00Z',
  '2027-03-16T17:00:00Z',
];

before(async () => {
  srv = await startServer();
  customer = await registerCustomer(srv.base, 'race-cust@example.com');
});

after(async () => srv.close());

for (const [i, start] of ROUNDS.entries()) {
  test(`round ${i + 1}: two parallel requests for ${start} - exactly one succeeds`, async () => {
    const body = { serviceId: HAIRCUT, stylistId: ANA, start };
    const [a, b] = await Promise.all([
      customer('POST', '/api/bookings', body),
      customer('POST', '/api/bookings', body),
    ]);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409], JSON.stringify([a.data, b.data]));
    assert.match(
      (a.status === 409 ? a : b).data.error,
      /taken|not available/i,
      'the loser must get a clear message'
    );

    // Exactly one active booking exists for that stylist and slot.
    const row = srv.db
      .prepare(
        `SELECT COUNT(*) AS n FROM bookings
         WHERE stylist_id = ? AND start_utc = ? AND status = 'confirmed'`
      )
      .get(ANA, start);
    assert.equal(row.n, 1);
  });
}

test('after 5 rounds: 5 active bookings, all with unique refs', async () => {
  const rows = srv.db
    .prepare(`SELECT ref FROM bookings WHERE stylist_id = ? ORDER BY start_utc`)
    .all(ANA);
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map((r) => r.ref)).size, 5);
});
