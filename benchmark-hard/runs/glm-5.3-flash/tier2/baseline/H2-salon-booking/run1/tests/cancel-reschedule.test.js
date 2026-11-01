'use strict';

/**
 * AC 7 (24-hour cancellation rule), AC 8 (admin cancels any time, reason
 * required), AC 9 (reschedule keeps ref + both rules), plus audit (AC 20) and
 * outbox (AC 17) content for these actions.
 *
 * Every test uses its own slot so tests never block each other in the shared
 * per-file database. Monday 2027-03-15 (CDT, UTC-5):
 *   09:00 local = 14:00Z, 10:00 = 15:00Z, 11:00 = 16:00Z ... 17:00 = 22:00Z.
 */

const { test, before, after } = require('node:test');
const {
  startServer,
  registerCustomer,
  login,
  book,
  SEED,
  assert,
  outboxContent,
} = require('./helpers');

process.env.APP_NOW = '2027-03-13T06:00:00Z'; // Saturday 00:00 America/Chicago

let srv;
let customer;
let admin;
const HAIRCUT = 1;
const ANA = 1;

const M = (hour) => `2027-03-15T${String(hour).padStart(2, '0')}:00:00Z`;

before(async () => {
  srv = await startServer();
  customer = await registerCustomer(srv.base, 'cancel-cust@example.com');
  admin = await login(srv.base, SEED.admin);
});

after(async () => srv.close());

test('AC 7: cancelling more than 24 hours ahead succeeds', async () => {
  const bk = await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: M(14) }); // 9:00 local
  const res = await customer('POST', `/api/bookings/${bk.ref}/cancel`, {});
  assert.equal(res.status, 200);
  assert.equal(res.data.booking.status, 'cancelled');
  const content = outboxContent(srv.outboxDir, `cancellation-${bk.ref}`);
  assert.ok(content, 'cancellation email file exists');
  assert.match(content, /CANCELLATION/);
  assert.match(content, /Cancelled by: customer/i);
});

test('AC 7: cancelling 23 hours before the start is refused with a clear message', async () => {
  const bk = await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: M(15) }); // 10:00
  process.env.APP_NOW = '2027-03-14T16:00:00Z'; // 23h before Mon 15:00Z
  const res = await customer('POST', `/api/bookings/${bk.ref}/cancel`, {});
  assert.equal(res.status, 422);
  assert.match(res.data.error, /24 hours/i);
  process.env.APP_NOW = '2027-03-13T06:00:00Z';
});

test('AC 7: cancelling exactly 24 hours before the start is allowed ("up to 24 hours")', async () => {
  const bk = await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: M(16) }); // 11:00
  process.env.APP_NOW = '2027-03-14T16:00:00Z'; // exactly 24h before Mon 16:00Z
  const res = await customer('POST', `/api/bookings/${bk.ref}/cancel`, {});
  assert.equal(res.status, 200);
  process.env.APP_NOW = '2027-03-13T06:00:00Z';
});

test('AC 8: admin cancel inside the 24-hour window without a reason is refused', async () => {
  const bk = await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: M(17) }); // 12:00
  process.env.APP_NOW = '2027-03-15T15:00:00Z'; // 2h before Mon 17:00Z
  const noReason = await admin('POST', `/api/bookings/${bk.ref}/cancel`, {});
  assert.equal(noReason.status, 400);
  assert.match(noReason.data.error, /reason/i);
  const blank = await admin('POST', `/api/bookings/${bk.ref}/cancel`, { reason: '   ' });
  assert.equal(blank.status, 400);
  process.env.APP_NOW = '2027-03-13T06:00:00Z';
});

test('AC 8: admin can cancel inside the window with a written reason', async () => {
  const bk = await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: M(18) }); // 13:00
  process.env.APP_NOW = '2027-03-15T16:00:00Z'; // inside the 24h window
  const res = await admin('POST', `/api/bookings/${bk.ref}/cancel`, {
    reason: 'Stylist is sick',
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.booking.status, 'cancelled');
  assert.equal(res.data.booking.cancel_reason, 'Stylist is sick');
  const content = outboxContent(srv.outboxDir, `cancellation-${bk.ref}`);
  assert.ok(content, 'cancellation file for the admin-cancelled booking exists');
  assert.match(content, /Stylist is sick/);
  assert.match(content, /admin/i);
  process.env.APP_NOW = '2027-03-13T06:00:00Z';
});

test('AC 9: reschedule keeps the reference code and updates the time', async () => {
  const bk = await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: M(19) }); // 14:00
  const res = await customer('POST', `/api/bookings/${bk.ref}/reschedule`, { start: M(20) });
  assert.equal(res.status, 200);
  assert.equal(res.data.booking.ref, bk.ref, 'reference code unchanged');
  assert.equal(res.data.booking.start_utc, M(20));
  assert.equal(res.data.booking.start_local, '2027-03-15 15:00');

  const content = outboxContent(srv.outboxDir, `reschedule-${bk.ref}`);
  assert.match(content, /RESCHEDULED/);
  assert.match(content, /New time/);

  const audit = await admin('GET', '/api/admin/audit');
  const entry = audit.data.entries.find(
    (e) => e.action === 'reschedule' && e.booking_ref === bk.ref
  );
  assert.ok(entry, 'reschedule audit entry exists');
  assert.equal(entry.before.start_utc, M(19));
  assert.equal(entry.after.start_utc, M(20));
  assert.equal(entry.actor_role, 'customer');
});

test('AC 9: reschedule inside the 24-hour window is refused', async () => {
  const bk = await book(customer, {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-03-16T14:00:00Z', // Tuesday 9:00 local
  });
  process.env.APP_NOW = '2027-03-15T15:00:00Z'; // 23h before
  const res = await customer('POST', `/api/bookings/${bk.ref}/reschedule`, { start: M(20) });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /24 hours/i);
  process.env.APP_NOW = '2027-03-13T06:00:00Z';
});

test('AC 9: reschedule obeys booking rules - occupied slot refused, ref unchanged', async () => {
  const bk = await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: M(21) }); // 16:00-16:30
  // Block the 16:30 slot with a 15-minute beard trim (back-to-back is fine).
  await book(customer, { serviceId: 3, stylistId: ANA, start: '2027-03-15T21:30:00Z' });
  const res = await customer('POST', `/api/bookings/${bk.ref}/reschedule`, {
    start: '2027-03-15T21:30:00Z',
  });
  assert.equal(res.status, 409);
  const check = await customer('GET', `/api/bookings/${bk.ref}`);
  assert.equal(check.data.booking.start_utc, M(21));
});

test('AC 9: reschedule to Sunday is refused', async () => {
  const bk = await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: '2027-03-15T21:45:00Z' });
  const res = await customer('POST', `/api/bookings/${bk.ref}/reschedule`, {
    start: '2027-03-14T15:00:00Z', // Sunday 9:00 local
  });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /Sunday/i);
});

test('a cancelled booking cannot be cancelled or rescheduled again', async () => {
  const bk = await book(customer, {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-03-15T22:15:00Z',
  }); // 17:15 local, ends 17:45
  await customer('POST', `/api/bookings/${bk.ref}/cancel`, {});
  const again = await customer('POST', `/api/bookings/${bk.ref}/cancel`, {});
  assert.equal(again.status, 409);
  const resched = await customer('POST', `/api/bookings/${bk.ref}/reschedule`, { start: M(20) });
  assert.equal(resched.status, 409);
});

test('AC 20: the audit log records create entries with who/when/before/after', async () => {
  const audit = await admin('GET', '/api/admin/audit');
  assert.equal(audit.status, 200);
  const create = audit.data.entries.find((e) => e.action === 'create' && e.before === null);
  assert.ok(create, 'a create entry with before=null exists');
  assert.equal(create.after.status, 'confirmed');
  assert.ok(create.after.ref);
  assert.ok(create.at_utc);
  assert.match(create.actor_email, /@/);
});
