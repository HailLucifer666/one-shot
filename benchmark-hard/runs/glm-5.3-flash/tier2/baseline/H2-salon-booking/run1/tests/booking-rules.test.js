'use strict';

/**
 * AC 3 ("any available stylist" picks someone actually free),
 * AC 4 (2h lead, 60-day horizon, never past),
 * AC 5 (overlap refusal including partial overlap),
 * plus 15-minute grid and reference format checks.
 */

const { test, before, after } = require('node:test');
const {
  startServer,
  registerCustomer,
  book,
  uniqueEmail,
  assert,
} = require('./helpers');

process.env.APP_NOW = '2027-03-13T06:00:00Z'; // Saturday 00:00 America/Chicago

let srv;
let customer;
const HAIRCUT = 1;
const COLOR = 2;
const ANA = 1;
const BEN = 2;

before(async () => {
  srv = await startServer();
  customer = await registerCustomer(srv.base, 'rules-cust@example.com');
});

after(async () => srv.close());

// AC 4: the 2-hour lead is easier to hit inside salon hours with the clock
// set to Monday 08:30 local (13:30Z): 09:00 local is only 30 min ahead.
test('AC 4: a booking less than 2 hours ahead is refused', async () => {
  process.env.APP_NOW = '2027-03-15T13:30:00Z'; // Monday 08:30 CDT
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-03-15T14:00:00Z', // 09:00 local = 30 min ahead
  });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /at least 2 hours ahead/i);
});

test('AC 4: a booking exactly 2 hours ahead is accepted', async () => {
  process.env.APP_NOW = '2027-03-16T13:30:00Z'; // Tuesday 08:30 CDT
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: BEN, // Ben works Tuesdays; Ana's Monday is used by overlap tests
    start: '2027-03-16T15:30:00Z', // 10:30 local = exactly 2h ahead
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  process.env.APP_NOW = '2027-03-13T06:00:00Z'; // restore
});

test('AC 4: a booking more than 60 days ahead is refused', async () => {
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-05-13T06:00:00Z', // 61 days after the clock
  });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /60 days ahead/i);
});

test('AC 4: a past booking is refused', async () => {
  process.env.APP_NOW = '2027-03-15T13:30:00Z';
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-03-14T15:00:00Z', // yesterday
  });
  assert.equal(res.status, 422);
  process.env.APP_NOW = '2027-03-13T06:00:00Z';
});

test('AC 4: an off-grid start (not on the 15-minute boundary) is refused', async () => {
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-03-16T14:07:00Z',
  });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /15 minutes/i);
});

test('AC 5: a 90-minute color at 10:00 blocks a haircut at 11:15 (partial overlap)', async () => {
  const color = await book(customer, {
    serviceId: COLOR,
    stylistId: ANA,
    start: '2027-03-15T15:00:00Z', // Mon 10:00 local, ends 11:30
  });
  assert.equal(color.status, 'confirmed');

  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-03-15T16:15:00Z', // Mon 11:15 local, inside the color
  });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /taken|not available/i);
});

test('AC 5: back-to-back booking at exactly the end of another is allowed', async () => {
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: ANA,
    start: '2027-03-15T16:30:00Z', // Mon 11:30 local = color end
  });
  assert.equal(res.status, 201);
});

test('AC 5: a booking that fully contains an existing one is refused', async () => {
  await book(customer, { serviceId: HAIRCUT, stylistId: BEN, start: '2027-03-16T15:00:00Z' }); // Tue 10:00-10:30
  const res = await customer('POST', '/api/bookings', {
    serviceId: COLOR,
    stylistId: BEN,
    start: '2027-03-16T14:30:00Z', // Tue 9:30-11:00 covers it
  });
  assert.equal(res.status, 409);
});

test('AC 3: "any available stylist" skips a busy stylist and books a free one', async () => {
  // Tuesday 11:00 local: block Ana explicitly; Ben is free at that time.
  await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: '2027-03-16T16:00:00Z' });
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: 'any',
    start: '2027-03-16T16:00:00Z',
  });
  assert.equal(res.status, 201);
  assert.notEqual(res.data.booking.stylist.name, 'Ana');
  assert.equal(res.data.booking.stylist.name, 'Ben');
});

test('AC 3: "any available stylist" refuses when nobody is free', async () => {
  // Tuesday 09:00 local: block both Ana and Ben; Cleo does not work Tuesdays.
  await book(customer, { serviceId: HAIRCUT, stylistId: ANA, start: '2027-03-16T14:00:00Z' });
  await book(customer, { serviceId: HAIRCUT, stylistId: BEN, start: '2027-03-16T14:00:00Z' });
  const res = await customer('POST', '/api/bookings', {
    serviceId: HAIRCUT,
    stylistId: 'any',
    start: '2027-03-16T14:00:00Z',
  });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /No stylist is available/i);
});

test('reference codes match the CW-XXXXXX format and never collide', async () => {
  const refs = [];
  // 25 quick beard-trim bookings on Cleo's distinct Monday slots
  // (11:00..17:00 local = 16:00Z..22:00Z on the 15-min grid).
  for (let i = 0; i < 25; i++) {
    const minute = 16 * 60 + i * 15; // UTC minutes from 2027-03-15T00:00Z
    const hh = String(Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    const res = await customer('POST', '/api/bookings', {
      serviceId: 3,
      stylistId: 3,
      start: `2027-03-15T${hh}:${mm}:00Z`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    refs.push(res.data.booking.ref);
  }
  assert.equal(new Set(refs).size, 25);
  for (const ref of refs) assert.match(ref, /^CW-[A-HJ-NP-Z2-9]{6}$/);
});
