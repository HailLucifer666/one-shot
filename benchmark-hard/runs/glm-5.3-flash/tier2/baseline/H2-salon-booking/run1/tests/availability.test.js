'use strict';

/**
 * AC 2: only slots where the chosen stylist works and the service fits before
 *       their finish time (Ben, Saturday, 12:45 for a 30-minute haircut is not
 *       offered).
 * AC 10: Sunday never bookable; Cleo never before 11:00 and never on Tuesday.
 */

const { test, before, after } = require('node:test');
const { startServer, client, registerCustomer, assert } = require('./helpers');

process.env.APP_NOW = '2027-03-13T06:00:00Z'; // Saturday 00:00 America/Chicago

let srv;
let customer;
const HAIRCUT = 1; // 30 min
const COLOR = 2; // 90 min
const ANA = 1;
const BEN = 2;
const CLEO = 3;

before(async () => {
  srv = await startServer();
  customer = await registerCustomer(srv.base, 'avail-cust@example.com');
});

after(async () => srv.close());

function timesOf(res) {
  return res.data.slots.map((s) => s.start_local_time);
}

test('AC 2: Ben on Saturday offers up to 12:30 for a 30-min haircut, not 12:45', async () => {
  const res = await customer(
    'GET',
    `/api/availability?serviceId=${HAIRCUT}&stylistId=${BEN}&date=2027-03-13`
  );
  assert.equal(res.status, 200);
  const times = timesOf(res);
  assert.equal(times[0], '09:00');
  assert.equal(times[times.length - 1], '12:30');
  assert.ok(!times.includes('12:45'), '12:45 must not be offered (would end 13:15)');
  assert.equal(times.length, 15); // 09:00..12:30 on the 15-min grid
});

test('AC 2: a booking attempt at Ben Saturday 12:45 for a haircut is refused; 12:30 is accepted', async () => {
  const late = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: BEN,
    start: '2027-03-13T18:45:00Z', // 12:45 local
  });
  assert.equal(late.status, 422);
  assert.match(late.data.error, /does not fit|finishes/i);

  const ok = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: BEN,
    start: '2027-03-13T18:30:00Z', // 12:30 local, ends exactly 13:00
  });
  assert.equal(ok.status, 201);
});

test('AC 2: Ben on Saturday for a 90-min color offers up to 11:30 (ends 13:00)', async () => {
  // A later Saturday (2027-03-20) so no earlier test's booking narrows the day.
  const res = await customer(
    'GET',
    `/api/availability?serviceId=${COLOR}&stylistId=${BEN}&date=2027-03-20`
  );
  const times = timesOf(res);
  assert.equal(times[times.length - 1], '11:30');
  assert.ok(!times.includes('11:45'));
});

test('AC 10: Sunday is never bookable - no slots for any stylist', async () => {
  const res = await customer(
    'GET',
    `/api/availability?serviceId=${HAIRCUT}&stylistId=any&date=2027-03-14`
  );
  assert.equal(res.status, 200);
  assert.equal(res.data.slots.length, 0);
});

test('AC 10: a Sunday booking POST is refused with a clear message', async () => {
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-03-14T15:00:00Z', // Sunday 9:00 local
  });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /Sunday/i);
});

test('AC 10: Cleo on Monday starts at 11:00, never earlier', async () => {
  const res = await customer(
    'GET',
    `/api/availability?serviceId=${HAIRCUT}&stylistId=${CLEO}&date=2027-03-15`
  );
  const times = timesOf(res);
  assert.equal(times[0], '11:00');
  assert.ok(!times.includes('10:45'));
  assert.ok(!times.includes('10:00'));
  assert.ok(!times.includes('09:00'));
  // 30-min service must end by 18:00 -> last start 17:30
  assert.equal(times[times.length - 1], '17:30');
});

test('AC 10: Cleo has no slots on Tuesday (or Sunday)', async () => {
  const tue = await customer(
    'GET',
    `/api/availability?serviceId=${HAIRCUT}&stylistId=${CLEO}&date=2027-03-16`
  );
  assert.equal(tue.data.slots.length, 0);
  const sun = await customer(
    'GET',
    `/api/availability?serviceId=${HAIRCUT}&stylistId=${CLEO}&date=2027-03-14`
  );
  assert.equal(sun.data.slots.length, 0);
});

test('AC 10: a Cleo booking before 11:00 is refused', async () => {
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: CLEO,
    start: '2027-03-15T14:45:00Z', // Monday 10:45 local
  });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /starts at 11:00 AM/i);
});

test('Ana on Monday starts at 9:00 AM', async () => {
  const res = await customer(
    'GET',
    `/api/availability?serviceId=${HAIRCUT}&stylistId=${ANA}&date=2027-03-15`
  );
  assert.equal(timesOf(res)[0], '09:00');
});

test('availability for an unknown stylist or service is a 404, bad date a 400', async () => {
  const badStylist = await customer(
    'GET',
    `/api/availability?serviceId=${HAIRCUT}&stylistId=999&date=2027-03-15`
  );
  assert.equal(badStylist.status, 404);
  const badService = await customer(
    'GET',
    `/api/availability?serviceId=999&stylistId=${ANA}&date=2027-03-15`
  );
  assert.equal(badService.status, 404);
  const badDate = await customer(
    'GET',
    `/api/availability?serviceId=${HAIRCUT}&stylistId=${ANA}&date=not-a-date`
  );
  assert.equal(badDate.status, 400);
});
