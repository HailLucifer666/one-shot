'use strict';

/**
 * Slot computation.
 *
 * A slot is offered only when ALL of these hold:
 *  - the salon is open that day (Mon-Sat 09:00-18:00 local; closed Sunday);
 *  - the stylist works that weekday and their window intersects salon hours;
 *  - the service duration fits entirely inside the stylist's window that day
 *    (a booking must END by the stylist's finish time - so Ben on Saturday
 *    at 12:45 for a 30-minute haircut is NOT offered);
 *  - the slot starts on the 15-minute grid;
 *  - it is at least 2 hours ahead and at most 60 days ahead;
 *  - it does not overlap any confirmed booking of that stylist.
 */

const { DateTime } = require('luxon');
const config = require('./config');
const time = require('./time');

function stylistWindowFor(stylistRow, weekday) {
  if (weekday === 7) return null; // salon closed on Sundays
  const days = stylistRow.workdays.split(',').map((n) => Number.parseInt(n, 10));
  if (!days.includes(weekday)) return null;
  let startMin = stylistRow.start_minute;
  let endMin = stylistRow.end_minute;
  if (weekday === 6 && stylistRow.saturday_end_minute != null) {
    endMin = stylistRow.saturday_end_minute;
  }
  startMin = Math.max(startMin, config.SALON_OPEN_MIN);
  endMin = Math.min(endMin, config.SALON_CLOSE_MIN);
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

/**
 * @param {object} args
 * @param {object} args.service        row from services
 * @param {object} args.stylistRow     row from stylists
 * @param {string} args.dateStr        salon-local date "YYYY-MM-DD"
 * @param {DateTime} args.nowDt        current time (Luxon UTC)
 * @param {Array}  args.existing       confirmed bookings of this stylist [{start_utc,end_utc}]
 * @returns {Array} slots [{start_utc,end_utc,start_local_time,label}]
 */
function slotsForStylistDay({ service, stylistRow, dateStr, nowDt, existing }) {
  const day = DateTime.fromISO(dateStr, { zone: config.SALON_TZ });
  if (!day.isValid) return [];
  const win = stylistWindowFor(stylistRow, day.weekday);
  if (!win) return [];

  const minStartMs = nowDt.valueOf() + config.MIN_LEAD_HOURS * 3600 * 1000;
  const maxStartMs = nowDt.valueOf() + config.MAX_HORIZON_DAYS * 24 * 3600 * 1000;
  const duration = service.duration_minutes;
  const slots = [];

  for (let m = win.startMin; m + duration <= win.endMin; m += config.SLOT_STEP_MIN) {
    // Wall-clock arithmetic in the salon zone; business hours never straddle
    // the 2 AM DST transition, so every step is unambiguous.
    const localStart = day.plus({ minutes: m });
    const startUtc = localStart.toUTC();
    if (startUtc.valueOf() < minStartMs || startUtc.valueOf() > maxStartMs) continue;
    const endUtc = startUtc.plus({ minutes: duration });
    const sIso = config.fmtUtc(startUtc);
    const eIso = config.fmtUtc(endUtc);
    const conflict = (existing || []).some(
      (b) => b.start_utc < eIso && sIso < b.end_utc
    );
    if (conflict) continue;
    slots.push({
      start_utc: sIso,
      end_utc: eIso,
      start_local_time: localStart.toFormat('HH:mm'),
      label: localStart.toFormat('h:mm a'),
    });
  }
  return slots;
}

function confirmedBookingsFor(db, stylistId) {
  return db
    .prepare(
      `SELECT start_utc, end_utc FROM bookings
       WHERE stylist_id = ? AND status = 'confirmed'
       ORDER BY start_utc`
    )
    .all(stylistId);
}

/**
 * Public availability for one service + one stylist ("any" supported).
 * Returns { date, service_id, stylist_id, slots } where slots are sorted by
 * start time; for "any", a slot appears if at least one stylist can take it.
 */
function getAvailability(db, { serviceId, stylistId, dateStr }) {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!service) {
    const err = new Error('Unknown service.');
    err.status = 404;
    throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
    const err = new Error('The "date" parameter must be YYYY-MM-DD (salon local date).');
    err.status = 400;
    throw err;
  }

  const nowDt = config.nowUtc();
  let stylists;
  if (stylistId === 'any' || stylistId == null) {
    stylists = db.prepare('SELECT * FROM stylists ORDER BY id').all();
    stylistId = 'any';
  } else {
    const st = db.prepare('SELECT * FROM stylists WHERE id = ?').get(stylistId);
    if (!st) {
      const err = new Error('Unknown stylist.');
      err.status = 404;
      throw err;
    }
    stylists = [st];
    stylistId = st.id;
  }

  const byStart = new Map();
  for (const st of stylists) {
    const existing = confirmedBookingsFor(db, st.id);
    for (const slot of slotsForStylistDay({ service, stylistRow: st, dateStr, nowDt, existing })) {
      if (!byStart.has(slot.start_utc)) byStart.set(slot.start_utc, slot);
    }
  }

  const slots = [...byStart.values()].sort((a, b) =>
    a.start_utc < b.start_utc ? -1 : 1
  );
  return { date: dateStr, service_id: service.id, stylist_id: stylistId, slots };
}

module.exports = { slotsForStylistDay, stylistWindowFor, getAvailability, confirmedBookingsFor };
