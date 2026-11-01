import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import {
  SALON_TZ,
  STYLISTS,
  serviceById,
  shiftFor,
  localMinutesToUtc,
  weekdayOf,
  type Service,
} from "./salon.ts";
import { firstFreeStylist, tooLateToChange, windowError, type Interval } from "./slots.ts";
import { inTransaction } from "./db.ts";
import { generateRef } from "./refs.ts";
import { bookingSnapshot, writeAudit } from "./audit.ts";
import { now as clockNow } from "./clock.ts";

export type BookingRow = {
  id: number;
  ref: string;
  customer_id: number;
  stylist_id: number;
  service_id: string;
  start_utc: string;
  end_utc: string;
  local_date: string;
  status: "CONFIRMED" | "CANCELLED";
  cancelled_by_user_id: number | null;
  cancelled_reason: string | null;
  cancelled_at_utc: string | null;
  created_at_utc: string;
  updated_at_utc: string;
};

export type BookingWithNames = BookingRow & { customer_email: string; customer_name: string; stylist_name: string };

export type SlotOutcome = { ok: true; startUtc: Date; endUtc: Date } | { ok: false; error: string };

export function getBookingByRef(db: DatabaseSync, ref: string): BookingRow | undefined {
  return db.prepare("SELECT * FROM bookings WHERE ref = ?").get(ref) as BookingRow | undefined;
}

export function getBookingWithNames(db: DatabaseSync, ref: string): BookingWithNames | undefined {
  return db
    .prepare(
      `SELECT b.*, u.email AS customer_email, u.name AS customer_name, s.name AS stylist_name
       FROM bookings b
       JOIN users u ON u.id = b.customer_id
       JOIN stylists s ON s.id = b.stylist_id
       WHERE b.ref = ?`,
    )
    .get(ref) as BookingWithNames | undefined;
}

/** Active (non-cancelled) bookings for one stylist on one local date. */
export function activeBookingsForDate(db: DatabaseSync, stylistId: number, date: string, excludeBookingId?: number): Interval[] {
  const rows =
    excludeBookingId !== undefined
      ? (db
          .prepare(
            "SELECT start_utc, end_utc FROM bookings WHERE stylist_id = ? AND status = 'CONFIRMED' AND local_date = ? AND id != ?",
          )
          .all(stylistId, date, excludeBookingId) as unknown as Array<{ start_utc: string; end_utc: string }>)
      : (db
          .prepare("SELECT start_utc, end_utc FROM bookings WHERE stylist_id = ? AND status = 'CONFIRMED' AND local_date = ?")
          .all(stylistId, date) as unknown as Array<{ start_utc: string; end_utc: string }>);
  return rows.map((row) => ({ startUtc: row.start_utc, endUtc: row.end_utc }));
}

export function activeBookingsForDateByStylist(db: DatabaseSync, date: string): Map<number, Interval[]> {
  const rows = db
    .prepare("SELECT stylist_id, start_utc, end_utc FROM bookings WHERE status = 'CONFIRMED' AND local_date = ?")
    .all(date) as unknown as Array<{ stylist_id: number; start_utc: string; end_utc: string }>;
  const map = new Map<number, Interval[]>();
  for (const row of rows) {
    const list = map.get(row.stylist_id) ?? [];
    list.push({ startUtc: row.start_utc, endUtc: row.end_utc });
    map.set(row.stylist_id, list);
  }
  return map;
}

/**
 * Validates a start time for ONE stylist: shift fit (slot starts within the
 * shift and the service ends by the stylist's finish time), booking window
 * (2h-60d ahead, never past) and overlap against existing bookings. Call
 * inside a transaction so the overlap check is race-safe; use
 * excludeBookingId when rescheduling so the booking does not clash with itself.
 */
export function validateSlotForStylist(db: DatabaseSync, opts: {
  service: Service;
  stylistId: number;
  date: string;
  startMinute: number;
  now: Date;
  excludeBookingId?: number;
}): SlotOutcome {
  const { service, stylistId, date, startMinute, now, excludeBookingId } = opts;
  const weekday = weekdayOf(date);
  const shift = shiftFor(stylistId, weekday);
  if (!shift) return { ok: false, error: "That stylist does not work on this day. Please pick another day or stylist." };
  if (startMinute < shift.startMinute || startMinute + service.minutes > shift.endMinute) {
    return { ok: false, error: "The service does not fit into that stylist's working hours. Please pick an offered slot." };
  }
  const startUtc = localMinutesToUtc(date, startMinute);
  if (Number.isNaN(startUtc.getTime())) {
    return { ok: false, error: "That local time does not exist on this date (daylight saving change). Please pick another slot." };
  }
  const windowErr = windowError(startUtc, now);
  if (windowErr) return { ok: false, error: windowErr };
  const endUtc = new Date(startUtc.getTime() + service.minutes * 60_000);
  const others = activeBookingsForDate(db, stylistId, date, excludeBookingId);
  const clash = others.some(
    (other) =>
      startUtc.getTime() < new Date(other.endUtc).getTime() && endUtc.getTime() > new Date(other.startUtc).getTime(),
  );
  if (clash) return { ok: false, error: "That time is no longer available. Please pick another slot." };
  return { ok: true, startUtc, endUtc };
}

export type CreateBookingInput = {
  customerId: number;
  serviceId: string;
  stylistId: number | null; // null = any available stylist
  date: string;
  startMinute: number;
};

export type BookingResult = { ok: true; booking: BookingRow } | { ok: false; error: string; conflict: boolean };

/**
 * Shape validation that does not touch the database (service id, stylist id,
 * date, time). Returns user-facing messages for the form.
 */
export function validateBookingInput(
  body: {
    service?: unknown;
    stylist?: unknown;
    date?: unknown;
    start?: unknown;
  },
  opts: { requireStart?: boolean } = {},
): { ok: true; serviceId: string; stylistId: number | null; date: string; startMinute: number } | { ok: false; errors: string[] } {
  const requireStart = opts.requireStart ?? true;
  const errors: string[] = [];
  const service = serviceById(typeof body.service === "string" ? body.service : "");
  if (!service) errors.push("Choose a service.");

  let stylistId: number | null = null;
  if (body.stylist === "any" || body.stylist === undefined || body.stylist === "") {
    stylistId = null;
  } else {
    const parsed = Number(body.stylist);
    if (!STYLISTS.some((s) => s.id === parsed)) errors.push("Choose a stylist.");
    else stylistId = parsed;
  }

  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date, { zone: SALON_TZ }).isValid) {
    errors.push("Choose a valid date.");
  }

  const start = typeof body.start === "string" ? body.start : "";
  let startMinute = -1;
  const match = /^(\d{2}):(\d{2})$/.exec(start);
  if (!match && requireStart) errors.push("Choose a start time.");
  if (match) {
    startMinute = Number(match[1]) * 60 + Number(match[2]);
    if (startMinute % 15 !== 0) errors.push("Slots start every 15 minutes.");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, serviceId: service!.id, stylistId, date, startMinute };
}

function actorOf(db: DatabaseSync, userId: number): { id: number; email: string; name: string; role: "customer" | "stylist" | "admin" } {
  const row = db.prepare("SELECT id, email, name, role FROM users WHERE id = ?").get(userId) as
    | { id: number; email: string; name: string; role: "customer" | "stylist" | "admin" }
    | undefined;
  return row ?? { id: userId, email: "", name: "", role: "customer" };
}

export function createBooking(db: DatabaseSync, input: CreateBookingInput): BookingResult {
  const service = serviceById(input.serviceId);
  if (!service) return { ok: false, error: "Choose a service.", conflict: false };
  const now = clockNow();
  return inTransaction(db, () => {
    let stylistId = input.stylistId;
    if (stylistId === null) {
      stylistId = firstFreeStylist({
        service,
        stylistIds: STYLISTS.map((s) => s.id),
        date: input.date,
        startMinute: input.startMinute,
        now,
        bookingsByStylist: activeBookingsForDateByStylist(db, input.date),
      });
      if (stylistId === null) {
        return { ok: false, error: "No stylist is free at that time. Please try another slot.", conflict: true };
      }
    }
    const slot = validateSlotForStylist(db, {
      service,
      stylistId,
      date: input.date,
      startMinute: input.startMinute,
      now,
    });
    if (!slot.ok) return { ok: false, error: slot.error, conflict: true };

    const ref = generateRef(db);
    const ts = new Date().toISOString();
    const startIso = slot.startUtc.toISOString();
    const endIso = slot.endUtc.toISOString();
    const localDate = DateTime.fromISO(startIso).setZone(SALON_TZ).toISODate() ?? input.date;
    const result = db
      .prepare(
        `INSERT INTO bookings (ref, customer_id, stylist_id, service_id, start_utc, end_utc, local_date, status, created_at_utc, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)`,
      )
      .run(ref, input.customerId, stylistId, service.id, startIso, endIso, localDate, ts, ts);
    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(Number(result.lastInsertRowid)) as BookingRow;
    writeAudit(db, {
      actor: actorOf(db, input.customerId),
      action: "CREATE",
      bookingRef: ref,
      before: null,
      after: bookingSnapshot(booking),
    });
    return { ok: true, booking };
  });
}

export type CancelResult = { ok: true; booking: BookingRow } | { ok: false; error: string };

export type Actor = { id: number; email: string; name: string; role: "customer" | "stylist" | "admin" };

/**
 * Cancels a booking. force=true is the admin path: allowed at any time and
 * requires a written reason. Otherwise the 24-hour cutoff applies.
 */
export function cancelBooking(db: DatabaseSync, ref: string, actor: Actor, opts: { force: boolean; reason?: string }): CancelResult {
  const now = clockNow();
  const booking = getBookingByRef(db, ref);
  if (!booking) return { ok: false, error: "Booking not found." };
  if (booking.status === "CANCELLED") return { ok: false, error: "This booking is already cancelled." };
  if (!opts.force && tooLateToChange(booking.start_utc, now)) {
    return {
      ok: false,
      error:
        "Bookings can only be cancelled up to 24 hours before the start time. This appointment starts in less than 24 hours — please call the salon.",
    };
  }
  if (opts.force && !(opts.reason && opts.reason.trim().length > 0)) {
    return { ok: false, error: "A cancellation reason is required." };
  }
  return inTransaction(db, () => {
    const ts = new Date().toISOString();
    const reason = opts.force ? opts.reason!.trim() : "Cancelled by customer";
    db.prepare(
      `UPDATE bookings
       SET status = 'CANCELLED', cancelled_by_user_id = ?, cancelled_reason = ?, cancelled_at_utc = ?, updated_at_utc = ?
       WHERE id = ? AND status = 'CONFIRMED'`,
    ).run(actor.id, reason, ts, ts, booking.id);
    const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking.id) as BookingRow;
    writeAudit(db, {
      actor,
      action: "CANCEL",
      bookingRef: booking.ref,
      before: bookingSnapshot(booking),
      after: bookingSnapshot(updated),
      details: opts.force ? `admin cancel: ${reason}` : "customer cancel",
    });
    return { ok: true, booking: updated };
  });
}

export type RescheduleResult = { ok: true; booking: BookingRow } | { ok: false; error: string; conflict?: boolean };

/**
 * Reschedules a booking: keeps the reference, applies the 24-hour cutoff to
 * the ORIGINAL start time, and applies every booking rule to the new time.
 */
export function rescheduleBooking(db: DatabaseSync, ref: string, actor: Actor, input: { date: string; startMinute: number }): RescheduleResult {
  const now = clockNow();
  const booking = getBookingByRef(db, ref);
  if (!booking) return { ok: false, error: "Booking not found." };
  if (booking.status === "CANCELLED") return { ok: false, error: "Cancelled bookings cannot be rescheduled." };
  if (tooLateToChange(booking.start_utc, now)) {
    return {
      ok: false,
      error:
        "Bookings can only be rescheduled up to 24 hours before the start time. This appointment starts in less than 24 hours — please call the salon.",
    };
  }
  const service = serviceById(booking.service_id);
  if (!service) return { ok: false, error: "The service for this booking no longer exists." };

  const shape = validateBookingInput({
    service: booking.service_id,
    stylist: booking.stylist_id,
    date: input.date,
    start: minutesToLabelInput(input.startMinute),
  });
  if (!shape.ok) return { ok: false, error: shape.errors.join(" ") };
  const { date, startMinute } = shape;

  return inTransaction(db, () => {
    const slot = validateSlotForStylist(db, {
      service,
      stylistId: booking.stylist_id,
      date,
      startMinute,
      now,
      excludeBookingId: booking.id,
    });
    if (!slot.ok) return { ok: false, error: slot.error, conflict: true };
    const ts = new Date().toISOString();
    const startIso = slot.startUtc.toISOString();
    const endIso = slot.endUtc.toISOString();
    const localDate = DateTime.fromISO(startIso).setZone(SALON_TZ).toISODate() ?? input.date;
    db.prepare("UPDATE bookings SET start_utc = ?, end_utc = ?, local_date = ?, updated_at_utc = ? WHERE id = ?").run(
      startIso,
      endIso,
      localDate,
      ts,
      booking.id,
    );
    const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking.id) as BookingRow;
    writeAudit(db, {
      actor,
      action: "RESCHEDULE",
      bookingRef: booking.ref,
      before: bookingSnapshot(booking),
      after: bookingSnapshot(updated),
    });
    return { ok: true, booking: updated };
  });
}

function minutesToLabelInput(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** All bookings of one customer, newest first. */
export function bookingsForCustomer(db: DatabaseSync, customerId: number): BookingWithNames[] {
  return db
    .prepare(
      `SELECT b.*, u.email AS customer_email, u.name AS customer_name, s.name AS stylist_name
       FROM bookings b
       JOIN users u ON u.id = b.customer_id
       JOIN stylists s ON s.id = b.stylist_id
       WHERE b.customer_id = ?
       ORDER BY b.start_utc DESC`,
    )
    .all(customerId) as unknown as BookingWithNames[];
}

/** A stylist's own confirmed bookings from "now" onwards (read-only schedule). */
export function upcomingBookingsForStylist(db: DatabaseSync, stylistId: number, from: Date): BookingWithNames[] {
  return db
    .prepare(
      `SELECT b.*, u.email AS customer_email, u.name AS customer_name, s.name AS stylist_name
       FROM bookings b
       JOIN users u ON u.id = b.customer_id
       JOIN stylists s ON s.id = b.stylist_id
       WHERE b.stylist_id = ? AND b.start_utc >= ? AND b.status = 'CONFIRMED'
       ORDER BY b.start_utc ASC`,
    )
    .all(stylistId, from.toISOString()) as unknown as BookingWithNames[];
}
