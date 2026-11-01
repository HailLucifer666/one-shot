'use strict';

/**
 * Booking service layer: create / cancel / reschedule.
 *
 * Rules enforced here (see README for the acceptance-criteria mapping):
 *  - start on the 15-minute grid, at least 2h ahead, at most 60 days ahead,
 *    never in the past (implied by the 2h lead), never on a Sunday, inside
 *    salon hours, inside the stylist's working window that day;
 *  - no overlapping confirmed bookings for the same stylist (full or partial);
 *  - concurrent requests are serialized by the synchronous SQLite
 *    transaction + a partial UNIQUE index, so exactly one of two simultaneous
 *    requests for the same slot succeeds;
 *  - customers cancel/reschedule only up to 24 hours before the start;
 *  - admins cancel any time but must give a written reason;
 *  - reschedule keeps the reference code and re-checks every rule;
 *  - every mutation writes an audit entry and an outbox email file.
 */

const { DateTime } = require('luxon');
const crypto = require('crypto');
const config = require('./config');
const time = require('./time');
const { priceDisplay } = require('./outbox');
const { writeAudit } = require('./audit');
const { writeOutbox } = require('./outbox');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Unambiguous alphabet for reference codes, e.g. CW-7K2M9P (no 0/O/1/I/L).
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newRef() {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  }
  return `CW-${s}`;
}

// ---- Validation ----------------------------------------------------------

/** Parse a client-supplied start time; must be an ISO 8601 datetime. */
function parseStart(iso) {
  if (typeof iso !== 'string' || !iso.trim()) {
    throw new HttpError(
      400,
      'A start time is required (ISO 8601 UTC, e.g. 2027-03-15T14:00:00Z).'
    );
  }
  const dt = DateTime.fromISO(iso.trim(), { zone: 'utc' });
  if (!dt.isValid) {
    throw new HttpError(400, 'The start time is not a valid ISO 8601 datetime.');
  }
  return dt;
}

function fmtMinute(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function stylistEndFor(stylistRow, weekday) {
  if (weekday === 6 && stylistRow.saturday_end_minute != null) {
    return stylistRow.saturday_end_minute;
  }
  return stylistRow.end_minute;
}

/**
 * Every rule that depends only on service + stylist + time (not on other
 * bookings). Returns an array of user-facing error messages (empty = valid).
 */
function slotErrors(startUtc, service, stylistRow, nowDt) {
  const errors = [];
  const local = startUtc.setZone(config.SALON_TZ);

  if (
    local.second !== 0 ||
    local.millisecond !== 0 ||
    local.minute % config.SLOT_STEP_MIN !== 0
  ) {
    errors.push('Appointments start every 15 minutes, so pick a time on the :00, :15, :30 or :45.');
  }

  const nowMs = nowDt.valueOf();
  const startMs = startUtc.valueOf();
  if (startMs < nowMs + config.MIN_LEAD_HOURS * 3600 * 1000) {
    errors.push('Bookings must be at least 2 hours ahead.');
  } else if (startMs > nowMs + config.MAX_HORIZON_DAYS * 24 * 3600 * 1000) {
    errors.push('Bookings can be at most 60 days ahead.');
  }

  if (local.weekday === 7) {
    errors.push('The salon is closed on Sundays.');
    return errors;
  }

  const mins = local.hour * 60 + local.minute;
  const duration = service.duration_minutes;

  if (mins < config.SALON_OPEN_MIN) {
    errors.push('The salon opens at 9:00 AM.');
  }
  if (mins + duration > config.SALON_CLOSE_MIN) {
    errors.push('The booking must end by the salon closing time of 6:00 PM.');
  }

  const days = stylistRow.workdays.split(',').map((n) => Number.parseInt(n, 10));
  if (!days.includes(local.weekday)) {
    errors.push(`${stylistRow.name} does not work on ${local.weekdayLong}s.`);
  } else {
    if (mins < stylistRow.start_minute) {
      errors.push(`${stylistRow.name} starts at ${fmtMinute(stylistRow.start_minute)}.`);
    }
    const endMin = stylistEndFor(stylistRow, local.weekday);
    if (mins + duration > endMin) {
      errors.push(
        `${stylistRow.name} finishes at ${fmtMinute(endMin)} on this day, so a ${duration}-minute service does not fit.`
      );
    }
  }
  return errors;
}

/** True if the stylist has a confirmed booking overlapping [start, start+dur). */
function hasOverlap(db, stylistId, startUtc, service, excludeBookingId) {
  const s = config.fmtUtc(startUtc);
  const e = config.fmtUtc(startUtc.plus({ minutes: service.duration_minutes }));
  // Overlap condition: existing.start < newEnd AND existing.end > newStart.
  const sql = excludeBookingId
    ? `SELECT id FROM bookings
       WHERE stylist_id = @stylistId AND status = 'confirmed' AND id <> @excludeId
         AND start_utc < @end AND end_utc > @start`
    : `SELECT id FROM bookings
       WHERE stylist_id = @stylistId AND status = 'confirmed'
         AND start_utc < @end AND end_utc > @start`;
  const row = db
    .prepare(sql)
    .get({ stylistId, excludeId: excludeBookingId, start: s, end: e });
  return !!row;
}

// ---- Serialization -------------------------------------------------------

function bookingSnapshot(row, names) {
  return {
    ref: row.ref,
    customer_email: names.customerEmail,
    service: names.serviceName,
    stylist: names.stylistName,
    start_utc: row.start_utc,
    end_utc: row.end_utc,
    start_local: `${row.start_local_date} ${row.start_local_time}`,
    end_local: `${row.end_local_date} ${row.end_local_time}`,
    status: row.status,
    cancel_reason: row.cancel_reason || null,
  };
}

function bookingToJson(ctx, row, viewer) {
  const service = ctx.db.prepare('SELECT * FROM services WHERE id = ?').get(row.service_id);
  const stylist = ctx.db.prepare('SELECT * FROM stylists WHERE id = ?').get(row.stylist_id);
  const customer = ctx.db.prepare('SELECT email FROM users WHERE id = ?').get(row.customer_id);
  const now = config.nowUtc().valueOf();
  const start = DateTime.fromISO(row.start_utc, { zone: 'utc' }).valueOf();
  const isOwner = viewer && viewer.id === row.customer_id;
  const isAdmin = viewer && viewer.role === 'admin';
  const active = row.status === 'confirmed';

  const json = {
    ref: row.ref,
    status: row.status,
    service_id: service.id,
    stylist_id: stylist.id,
    service: {
      id: service.id,
      name: service.name,
      duration_minutes: service.duration_minutes,
      price_cents: service.price_cents,
      price_display: priceDisplay(service.price_cents),
    },
    stylist: { id: stylist.id, name: stylist.name },
    start_utc: row.start_utc,
    end_utc: row.end_utc,
    start_local: `${row.start_local_date} ${row.start_local_time}`,
    end_local: `${row.end_local_date} ${row.end_local_time}`,
    start_display: time.localLong(row.start_utc),
    end_display: time.localTime(row.end_utc),
    created_utc: row.created_utc,
    cancel_reason: row.cancel_reason || null,
    cancelled_utc: row.cancelled_utc || null,
    // 24-hour rule view for the current viewer: admins may cancel any time.
    can_cancel: active && (isAdmin || start - now >= config.CANCEL_CUTOFF_HOURS * 3600 * 1000),
    can_reschedule: active && start - now >= config.CANCEL_CUTOFF_HOURS * 3600 * 1000,
  };
  if (isOwner || isAdmin) json.customer_email = customer.email;
  if (isOwner) json.customer_name = viewer.name;
  return json;
}

// ---- Create --------------------------------------------------------------

function getBookingByRef(db, ref) {
  return db.prepare('SELECT * FROM bookings WHERE ref = ?').get(ref);
}

function insertBooking(ctx, { customer, service, stylist, startUtc, nowDt }) {
  const db = ctx.db;
  const nowIso = config.nowIso();
  const endUtc = startUtc.plus({ minutes: service.duration_minutes });
  const localStart = startUtc.setZone(config.SALON_TZ);
  const localEnd = endUtc.setZone(config.SALON_TZ);

  for (let attempt = 0; attempt < 10; attempt++) {
    const ref = newRef();
    try {
      const info = db
        .prepare(
          `INSERT INTO bookings
             (ref, customer_id, service_id, stylist_id,
              start_utc, end_utc,
              start_local_date, start_local_time, end_local_date, end_local_time,
              status, created_utc, updated_utc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`
        )
        .run(
          ref,
          customer.id,
          service.id,
          stylist.id,
          config.fmtUtc(startUtc),
          config.fmtUtc(endUtc),
          localStart.toFormat('yyyy-MM-dd'),
          localStart.toFormat('HH:mm'),
          localEnd.toFormat('yyyy-MM-dd'),
          localEnd.toFormat('HH:mm'),
          nowIso,
          nowIso
        );
      return getBookingByRef(db, ref);
    } catch (err) {
      const code = err && err.code ? String(err.code) : '';
      if (code.startsWith('SQLITE_CONSTRAINT')) {
        if (String(err.message).includes('bookings.ref')) continue; // ref collision: retry
        // idx_bookings_active_slot: someone booked this exact slot first.
        throw new HttpError(409, 'That time has just been taken. Please pick another slot.');
      }
      throw err;
    }
  }
  throw new HttpError(500, 'Could not generate a unique reference code.');
}

/**
 * @param {object} p
 * @param {object} p.customer       the booking customer (users row shape {id,email,name,role})
 * @param {number|'any'} p.stylistId
 * @param {string} p.startIso       ISO 8601 UTC start
 */
function createBooking(ctx, { customer, serviceId, stylistId, startIso }) {
  const db = ctx.db;
  const nowDt = config.nowUtc();
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!service) throw new HttpError(404, 'Unknown service.');
  const startUtc = parseStart(startIso);

  const tx = db.transaction(() => {
    let chosen = null;
    if (stylistId === 'any' || stylistId == null) {
      // "Any available stylist": first stylist (by id) free and working then.
      for (const st of db.prepare('SELECT * FROM stylists ORDER BY id').all()) {
        if (slotErrors(startUtc, service, st, nowDt).length > 0) continue;
        if (hasOverlap(db, st.id, startUtc, service, null)) continue;
        chosen = st;
        break;
      }
      if (!chosen) {
        throw new HttpError(409, 'No stylist is available for that time. Please pick another slot.');
      }
    } else {
      chosen = db.prepare('SELECT * FROM stylists WHERE id = ?').get(stylistId);
      if (!chosen) throw new HttpError(404, 'Unknown stylist.');
      const errs = slotErrors(startUtc, service, chosen, nowDt);
      if (errs.length > 0) throw new HttpError(422, errs[0]);
      if (hasOverlap(db, chosen.id, startUtc, service, null)) {
        throw new HttpError(409, 'That time has just been taken. Please pick another slot.');
      }
    }

    const row = insertBooking(ctx, { customer, service, stylist: chosen, startUtc, nowDt });

    const names = {
      ref: row.ref,
      customerEmail: customer.email,
      serviceName: service.name,
      stylistName: chosen.name,
      durationMinutes: service.duration_minutes,
      priceCents: service.price_cents,
      startUtc: row.start_utc,
      endUtc: row.end_utc,
      status: row.status,
    };
    writeAudit(ctx, {
      actor: customer,
      action: 'create',
      bookingRef: row.ref,
      before: null,
      after: bookingSnapshot(row, names),
    });
    writeOutbox(ctx, 'confirmation', names);
    return row;
  });

  return tx();
}

// ---- Cancel --------------------------------------------------------------

function customerOwns(actor, row) {
  return actor && actor.id === row.customer_id;
}

function cancelBooking(ctx, { actor, ref, reason }) {
  const row = getBookingByRef(ctx.db, ref);
  if (!row) throw new HttpError(404, 'Booking not found.');

  let cancelledByLabel;
  if (actor.role === 'admin') {
    if (!reason || !String(reason).trim()) {
      throw new HttpError(400, 'An admin cancellation requires a written reason.');
    }
    cancelledByLabel = `admin (${actor.email})`;
  } else {
    if (!customerOwns(actor, row)) throw new HttpError(404, 'Booking not found.');
    const start = DateTime.fromISO(row.start_utc, { zone: 'utc' }).valueOf();
    const remaining = start - config.nowUtc().valueOf();
    if (remaining < config.CANCEL_CUTOFF_HOURS * 3600 * 1000) {
      throw new HttpError(
        422,
        'This booking starts in less than 24 hours, so it can no longer be cancelled online. Please contact the salon.'
      );
    }
    cancelledByLabel = `customer (${actor.email})`;
  }

  const tx = ctx.db.transaction(() => {
    if (row.status !== 'confirmed') {
      throw new HttpError(409, 'This booking is already cancelled.');
    }
    const before = snapshotFor(ctx, row);
    const trimmed = reason ? String(reason).trim() : null;
    ctx.db
      .prepare(
        `UPDATE bookings
         SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_utc = ?, updated_utc = ?
         WHERE id = ?`
      )
      .run(trimmed, actor.id, config.nowIso(), config.nowIso(), row.id);
    const afterRow = getBookingByRef(ctx.db, row.ref);
    const after = snapshotFor(ctx, afterRow);
    writeAudit(ctx, { actor, action: 'cancel', bookingRef: row.ref, before, after });
    writeOutbox(ctx, 'cancellation', { ...outboxNames(ctx, afterRow), cancelledByLabel, reason: trimmed });
    return afterRow;
  });

  return tx();
}

// ---- Reschedule ----------------------------------------------------------

function rescheduleBooking(ctx, { actor, ref, newStartIso }) {
  const row = getBookingByRef(ctx.db, ref);
  if (!row) throw new HttpError(404, 'Booking not found.');
  if (actor.role !== 'admin' && !customerOwns(actor, row)) {
    throw new HttpError(404, 'Booking not found.');
  }

  const start = DateTime.fromISO(row.start_utc, { zone: 'utc' });
  const remaining = start.valueOf() - config.nowUtc().valueOf();
  if (remaining < config.CANCEL_CUTOFF_HOURS * 3600 * 1000) {
    throw new HttpError(
      422,
      'This booking starts in less than 24 hours, so it can no longer be rescheduled online. Please contact the salon.'
    );
  }

  const service = ctx.db.prepare('SELECT * FROM services WHERE id = ?').get(row.service_id);
  const stylist = ctx.db.prepare('SELECT * FROM stylists WHERE id = ?').get(row.stylist_id);
  const newStart = parseStart(newStartIso);
  const nowDt = config.nowUtc();

  const tx = ctx.db.transaction(() => {
    if (row.status !== 'confirmed') {
      throw new HttpError(409, 'Only confirmed bookings can be rescheduled.');
    }
    const errs = slotErrors(newStart, service, stylist, nowDt);
    if (errs.length > 0) throw new HttpError(422, errs[0]);
    if (hasOverlap(ctx.db, row.stylist_id, newStart, service, row.id)) {
      throw new HttpError(409, 'The new time is not available. Please pick another slot.');
    }

    const before = snapshotFor(ctx, row);
    const newEnd = newStart.plus({ minutes: service.duration_minutes });
    const localStart = newStart.setZone(config.SALON_TZ);
    const localEnd = newEnd.setZone(config.SALON_TZ);
    try {
      ctx.db
        .prepare(
          `UPDATE bookings
           SET start_utc = ?, end_utc = ?,
               start_local_date = ?, start_local_time = ?,
               end_local_date = ?, end_local_time = ?,
               updated_utc = ?
           WHERE id = ?`
        )
        .run(
          config.fmtUtc(newStart),
          config.fmtUtc(newEnd),
          localStart.toFormat('yyyy-MM-dd'),
          localStart.toFormat('HH:mm'),
          localEnd.toFormat('yyyy-MM-dd'),
          localEnd.toFormat('HH:mm'),
          config.nowIso(),
          row.id
        );
    } catch (err) {
      const code = err && err.code ? String(err.code) : '';
      if (code.startsWith('SQLITE_CONSTRAINT')) {
        throw new HttpError(409, 'The new time is not available. Please pick another slot.');
      }
      throw err;
    }

    const afterRow = getBookingByRef(ctx.db, row.ref);
    const after = snapshotFor(ctx, afterRow);
    writeAudit(ctx, { actor, action: 'reschedule', bookingRef: row.ref, before, after });
    writeOutbox(ctx, 'reschedule', {
      ...outboxNames(ctx, afterRow),
      oldStartUtc: row.start_utc,
      oldEndUtc: row.end_utc,
    });
    return afterRow;
  });

  return tx();
}

// ---- Shared helpers ------------------------------------------------------

function outboxNames(ctx, row) {
  const service = ctx.db.prepare('SELECT * FROM services WHERE id = ?').get(row.service_id);
  const stylist = ctx.db.prepare('SELECT * FROM stylists WHERE id = ?').get(row.stylist_id);
  const customer = ctx.db.prepare('SELECT email FROM users WHERE id = ?').get(row.customer_id);
  return {
    ref: row.ref,
    customerEmail: customer.email,
    serviceName: service.name,
    stylistName: stylist.name,
    durationMinutes: service.duration_minutes,
    priceCents: service.price_cents,
    startUtc: row.start_utc,
    endUtc: row.end_utc,
    status: row.status,
  };
}

function snapshotFor(ctx, row) {
  return bookingSnapshot(row, outboxNames(ctx, row));
}

function listBookingsFor(ctx, viewer) {
  if (viewer.role === 'admin') {
    return ctx.db.prepare('SELECT * FROM bookings ORDER BY start_utc').all();
  }
  return ctx.db
    .prepare('SELECT * FROM bookings WHERE customer_id = ? ORDER BY start_utc')
    .all(viewer.id);
}

module.exports = {
  HttpError,
  newRef,
  parseStart,
  slotErrors,
  hasOverlap,
  createBooking,
  cancelBooking,
  rescheduleBooking,
  bookingToJson,
  getBookingByRef,
  listBookingsFor,
  snapshotFor,
  outboxNames,
};
