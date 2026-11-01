'use strict';

/**
 * AC 16 (unique refs across 200 bookings), AC 18 (admin list: 20 per page,
 * three filters combined), AC 19 (CSV export: exactly the next 7 days,
 * correct columns, local times).
 *
 * The pagination/filters tests share one server; the CSV and 200-ref tests
 * boot their own isolated server so row counts are exact.
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
let customer;
let admin;
const BEARD = 3; // 15 min
const HAIRCUT = 1; // 30 min
const ANA = 1;

// Ana works Mon-Sat 09:00-18:00 local. All days below are CDT (UTC-5),
// so 09:00 local = 14:00Z. dayOffset: 0 = Mon 2027-03-15.
const slotIso = (dayOffset, slotIndex) => {
  const minutes = 14 * 60 + dayOffset * 24 * 60 + slotIndex * 15;
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const day = 15 + Math.floor(minutes / (24 * 60));
  const mm = String(minutes % 60).padStart(2, '0');
  return `2027-03-${String(day).padStart(2, '0')}T${hh}:${mm}:00Z`;
};

before(async () => {
  srv = await startServer();
  customer = await registerCustomer(srv.base, 'admin-cust@example.com');
  admin = await login(srv.base, SEED.admin);
});

after(async () => srv.close());

test('AC 18: the admin list paginates at 20 per page', async () => {
  // 10 bookings on Monday, 10 on Tuesday, 5 on Wednesday = 25.
  for (let i = 0; i < 10; i++) {
    await book(customer, { serviceId: BEARD, stylistId: ANA, start: slotIso(0, i) });
  }
  for (let i = 0; i < 10; i++) {
    await book(customer, { serviceId: BEARD, stylistId: ANA, start: slotIso(1, i) });
  }
  for (let i = 0; i < 5; i++) {
    await book(customer, { serviceId: BEARD, stylistId: ANA, start: slotIso(2, i) });
  }

  const page1 = await admin('GET', '/api/admin/bookings?page=1');
  assert.equal(page1.status, 200);
  assert.equal(page1.data.total, 25);
  assert.equal(page1.data.total_pages, 2);
  assert.equal(page1.data.page_size, 20);
  assert.equal(page1.data.bookings.length, 20);

  const page2 = await admin('GET', '/api/admin/bookings?page=2');
  assert.equal(page2.data.bookings.length, 5);

  // Pages do not overlap.
  const refs1 = page1.data.bookings.map((b) => b.ref);
  const refs2 = page2.data.bookings.map((b) => b.ref);
  assert.equal(new Set([...refs1, ...refs2]).size, 25);
});

test('AC 18: the date filter narrows to one local day', async () => {
  const res = await admin('GET', '/api/admin/bookings?date=2027-03-16');
  assert.equal(res.data.total, 10);
  assert.ok(res.data.bookings.every((b) => b.start_local.startsWith('2027-03-16')));
});

test('AC 18: stylist + date filters combine (Ana has all 10; Ben has none that day)', async () => {
  const ana = await admin('GET', '/api/admin/bookings?date=2027-03-16&stylistId=1');
  assert.equal(ana.data.total, 10);
  const ben = await admin('GET', '/api/admin/bookings?date=2027-03-16&stylistId=2');
  assert.equal(ben.data.total, 0);
  assert.equal(ben.data.bookings.length, 0);
});

test('AC 18: all three filters work together (date + stylist + status)', async () => {
  // Cancel two of the Tuesday bookings (well beyond 24h).
  const tue = await admin('GET', '/api/admin/bookings?date=2027-03-16');
  for (const bk of tue.data.bookings.slice(0, 2)) {
    const res = await customer('POST', `/api/bookings/${bk.ref}/cancel`, {});
    assert.equal(res.status, 200);
  }
  const res = await admin(
    'GET',
    '/api/admin/bookings?date=2027-03-16&stylistId=1&status=cancelled'
  );
  assert.equal(res.data.total, 2);
  assert.ok(res.data.bookings.every((b) => b.status === 'cancelled'));
  assert.ok(res.data.bookings.every((b) => b.stylist.id === 1));
  assert.ok(res.data.bookings.every((b) => b.start_local.startsWith('2027-03-16')));

  // Same filters but confirmed: the remaining 8.
  const confirmed = await admin(
    'GET',
    '/api/admin/bookings?date=2027-03-16&stylistId=1&status=confirmed'
  );
  assert.equal(confirmed.data.total, 8);
});

test('AC 19: the CSV export covers exactly the next 7 days with local times', async () => {
  const csv = await startServer(); // isolated DB -> exact row counts
  try {
    const cust = await registerCustomer(csv.base, 'csv-cust@example.com');

    // Inside the window: Monday 3/15 9:00 local (14:00Z) and Saturday 3/13
    // 9:00 local (15:00Z, CST). Cancel the first so status varies.
    const insideA = await book(cust, { serviceId: HAIRCUT, stylistId: ANA, start: '2027-03-15T14:00:00Z' });
    const insideB = await book(cust, { serviceId: HAIRCUT, stylistId: ANA, start: '2027-03-13T15:00:00Z' });
    const cancel = await cust('POST', `/api/bookings/${insideA.ref}/cancel`, {});
    assert.equal(cancel.status, 200);

    // Outside the window: Saturday 3/27 9:00 local (14 days out).
    const outside = await book(cust, { serviceId: HAIRCUT, stylistId: ANA, start: '2027-03-27T14:00:00Z' });

    const adminCsv = await login(csv.base, SEED.admin);
    const res = await adminCsv('GET', '/api/admin/bookings/csv');
    assert.equal(res.status, 200);
    const text = String(res.data);

    const lines = text.split('\r\n').filter((l) => l.length > 0);
    assert.equal(lines[0], 'ref,start,end,service,stylist,customer_email,status');
    assert.equal(lines.length, 3, 'header + exactly the 2 in-window rows');

    const rows = lines.slice(1).map((l) => l.split(','));
    const refs = rows.map((r) => r[0]);
    assert.ok(refs.includes(insideA.ref), 'cancelled booking inside the window is included');
    assert.ok(refs.includes(insideB.ref), 'confirmed booking inside the window is included');
    assert.ok(!refs.includes(outside.ref), 'booking 14 days out is excluded');

    const rowA = rows.find((r) => r[0] === insideA.ref);
    assert.deepEqual(rowA, [
      insideA.ref,
      '2027-03-15 09:00', // salon local time (CDT), not 14:00
      '2027-03-15 09:30',
      'Haircut',
      'Ana',
      'csv-cust@example.com',
      'cancelled',
    ]);
    const rowB = rows.find((r) => r[0] === insideB.ref);
    assert.equal(rowB[1], '2027-03-13 09:00'); // CST Saturday morning
    assert.equal(rowB[6], 'confirmed');
  } finally {
    await csv.close();
  }
});

test('AC 16: reference codes are unique across 200 generated bookings', async () => {
  const run = await startServer(); // isolated DB -> every slot is free
  try {
    const cust = await registerCustomer(run.base, 'bulk-cust@example.com');
    const refs = [];
    // Ana: 5 full days (Mon 3/15 .. Fri 3/19, 36 beard slots each = 180)
    // plus 20 slots on Saturday 3/20 = 200 bookings, no two share a slot.
    for (let i = 0; i < 200; i++) {
      const day = Math.floor(i / 36); // 0..5
      const slot = i % 36;
      const res = await cust('POST', '/api/bookings', {
        serviceId: BEARD,
        stylistId: ANA,
        start: slotIso(day, slot),
      });
      assert.equal(res.status, 201, `booking ${i}: ${JSON.stringify(res.data)}`);
      refs.push(res.data.booking.ref);
    }
    assert.equal(refs.length, 200);
    assert.equal(new Set(refs).size, 200, 'all 200 reference codes are unique');
    for (const ref of refs) assert.match(ref, /^CW-[A-Z2-9]{6}$/);
  } finally {
    await run.close();
  }
});
