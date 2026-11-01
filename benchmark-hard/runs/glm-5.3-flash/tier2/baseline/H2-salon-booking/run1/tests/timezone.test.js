'use strict';

/**
 * AC 11 (DST correctness), AC 21 (documented clock override).
 *
 * Clock: Saturday 2027-03-13 06:00Z. DST began 2027-03-14 02:00 local:
 *   - Saturday 2027-03-13 is CST (UTC-6):  9:00 local = 15:00Z
 *   - Monday   2027-03-15 is CDT (UTC-5):  9:00 local = 14:00Z
 */

const { test, before, after } = require('node:test');
const { startServer, client, registerCustomer, book, assert } = require('./helpers');

process.env.APP_NOW = '2027-03-13T06:00:00Z';

let srv;
let customer;

before(async () => {
  srv = await startServer();
  customer = await registerCustomer(srv.base, 'tz-cust@example.com');
});

after(async () => srv.close());

test('AC 21: GET /api/now reflects the APP_NOW clock override', async () => {
  const req = client(srv.base);
  const res = await req('GET', '/api/now');
  assert.equal(res.status, 200);
  assert.equal(res.data.now_utc, '2027-03-13T06:00:00Z');
  assert.equal(res.data.now_local, '2027-03-13 00:00'); // CST, UTC-6
  assert.equal(res.data.clock_override, true);
});

test('AC 11: Monday 2027-03-15 9:00 local is stored as 14:00Z and displayed as 9:00 AM', async () => {
  const bk = await book(customer, { serviceId: 1, stylistId: 1, start: '2027-03-15T14:00:00Z' });
  assert.equal(bk.start_utc, '2027-03-15T14:00:00Z');
  assert.equal(bk.end_utc, '2027-03-15T14:30:00Z');
  assert.equal(bk.start_local, '2027-03-15 09:00');
  assert.match(bk.start_display, /March 15, 2027/);
  assert.match(bk.start_display, /9:00 AM/);
  assert.match(bk.end_display, /9:30 AM/);

  // Same value when re-read from storage.
  const res = await customer('GET', `/api/bookings/${bk.ref}`);
  assert.equal(res.data.booking.start_utc, '2027-03-15T14:00:00Z');
});

test('AC 11: Saturday 2027-03-13 9:00 local is stored as 15:00Z', async () => {
  const bk = await book(customer, { serviceId: 1, stylistId: 1, start: '2027-03-13T15:00:00Z' });
  assert.equal(bk.start_utc, '2027-03-13T15:00:00Z');
  assert.equal(bk.start_local, '2027-03-13 09:00');
});

test('a local time sent with an explicit -05:00 offset normalizes to UTC', async () => {
  const bk = await book(customer, {
    serviceId: 3, // Beard trim, 15 min
    stylistId: 3, // Cleo (Mon from 11:00)
    start: '2027-03-15T11:00:00-05:00',
  });
  assert.equal(bk.start_utc, '2027-03-15T16:00:00Z');
  assert.equal(bk.start_local, '2027-03-15 11:00');
});

test('a naive (zone-less) start is treated as UTC and stored canonically', async () => {
  const bk = await book(customer, {
    serviceId: 1,
    stylistId: 1,
    start: '2027-03-16T14:15:00', // Tuesday 9:15 local
  });
  assert.equal(bk.start_utc, '2027-03-16T14:15:00Z');
  assert.equal(bk.start_local, '2027-03-16 09:15');
});
