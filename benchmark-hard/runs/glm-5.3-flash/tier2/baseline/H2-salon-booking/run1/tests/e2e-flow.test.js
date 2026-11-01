'use strict';

/**
 * AC 1: a customer can register, sign in, book, view and cancel end to end.
 * AC 17: confirmation and cancellation write readable files into outbox/.
 *
 * Clock: Saturday 2027-03-13 06:00Z = midnight America/Chicago (CST, UTC-6).
 * Monday 2027-03-15 09:00 local = 14:00Z (CDT, UTC-5 - DST began 03-14).
 */

const { test, before, after } = require('node:test');
const { startServer, client, SEED, uniqueEmail, assert, outboxFiles } = require('./helpers');

process.env.APP_NOW = '2027-03-13T06:00:00Z';

let srv;
let customer;

before(async () => {
  srv = await startServer();
  customer = client(srv.base);
});

after(async () => {
  await srv.close();
});

test('register -> me -> catalogs -> availability -> book -> view -> cancel (end to end)', async () => {
  // 1. register
  const email = uniqueEmail('e2e');
  const reg = await customer('POST', '/api/auth/register', {
    name: 'E2E Customer',
    email,
    password: 'e2e-password-123',
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.role, 'customer');

  // 2. session works
  const me = await customer('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, email);

  // 3. catalogs
  const services = await customer('GET', '/api/services');
  assert.equal(services.status, 200);
  assert.equal(services.data.services.length, 4);
  const haircut = services.data.services.find((s) => s.name === 'Haircut');
  assert.deepEqual([haircut.duration_minutes, haircut.price_cents], [30, 3500]);

  const stylists = await customer('GET', '/api/stylists');
  assert.equal(stylists.status, 200);
  assert.equal(stylists.data.stylists.length, 3);
  const ana = stylists.data.stylists.find((s) => s.name === 'Ana');
  const ben = stylists.data.stylists.find((s) => s.name === 'Ben');
  assert.match(ben.schedule_text, /1:00 PM \(Sat\)/);

  // 4. availability for Ana on Monday
  const avail = await customer(
    'GET',
    `/api/availability?serviceId=${haircut.id}&stylistId=${ana.id}&date=2027-03-15`
  );
  assert.equal(avail.status, 200);
  assert.ok(avail.data.slots.some((s) => s.label === '9:00 AM'));

  // 5. book Monday 9:00 local
  const bookRes = await customer('POST', '/api/bookings', {
    serviceId: haircut.id,
    stylistId: ana.id,
    start: '2027-03-15T14:00:00Z',
  });
  assert.equal(bookRes.status, 201);
  const bk = bookRes.data.booking;
  assert.match(bk.ref, /^CW-[A-Z0-9]{6}$/);
  assert.equal(bk.start_utc, '2027-03-15T14:00:00Z');
  assert.equal(bk.start_local, '2027-03-15 09:00');
  assert.match(bk.start_display, /9:00 AM/);
  assert.equal(bk.status, 'confirmed');
  assert.equal(bk.can_cancel, true);

  // 6. view own bookings
  const list = await customer('GET', '/api/bookings');
  assert.equal(list.status, 200);
  assert.equal(list.data.bookings.length, 1);
  assert.equal(list.data.bookings[0].ref, bk.ref);

  // 7. outbox confirmation file (AC 17)
  const files1 = outboxFiles(srv.outboxDir);
  assert.equal(files1.length, 1, JSON.stringify(files1));
  assert.match(files1[0], /confirmation/);
  assert.match(files1[0], new RegExp(bk.ref));

  // 8. cancel (> 24h ahead)
  const cancelRes = await customer(
    'POST',
    `/api/bookings/${bk.ref}/cancel`,
    {}
  );
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.data.booking.status, 'cancelled');
  assert.equal(cancelRes.data.booking.can_cancel, false);

  // 9. outbox cancellation file
  const files2 = outboxFiles(srv.outboxDir);
  assert.equal(files2.length, 2, JSON.stringify(files2));
  const cancelFile = files2.find((f) => f.includes('cancellation'));
  assert.ok(cancelFile, 'expected a cancellation file');
  const content = require('node:fs').readFileSync(
    require('node:path').join(srv.outboxDir, cancelFile),
    'utf8'
  );
  assert.match(content, /CANCELLATION/);
  assert.match(content, new RegExp(bk.ref));
  assert.match(content, new RegExp(email));
});

test('sign in with the seeded demo customer works', async () => {
  const req = client(srv.base);
  const res = await req('POST', '/api/auth/login', SEED.customer);
  assert.equal(res.status, 200);
  assert.equal(res.data.user.role, 'customer');
});

test('registering an already-used email is refused with 409', async () => {
  const req = client(srv.base);
  const res = await req('POST', '/api/auth/register', {
    name: 'Dup',
    email: SEED.customer.email,
    password: 'long-enough-password',
  });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /already exists/i);
});
