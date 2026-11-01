import { DateTime } from "luxon";
import {
  CANCEL_CUTOFF_HOURS,
  MAX_AHEAD_DAYS,
  MIN_LEAD_MINUTES,
  SLOT_STEP_MINUTES,
  type Service,
  localMinutesToUtc,
  minutesToLabel,
  shiftFor,
  weekdayOf,
} from "./salon.ts";

export type Interval = { startUtc: string; endUtc: string };

function ms(iso: string): number {
  return new Date(iso).getTime();
}

export function overlaps(startMs: number, endMs: number, intervals: Interval[]): boolean {
  return intervals.some((b) => startMs < ms(b.endUtc) && endMs > ms(b.startUtc));
}

/**
 * Returns a human-readable refusal reason when the start time is outside the
 * booking window (past, less than 2 hours ahead, or more than 60 days ahead),
 * and null when the start time is bookable. Inclusive boundaries: exactly 2h
 * ahead and exactly 60 days ahead are allowed.
 */
export function windowError(startUtc: Date, now: Date): string | null {
  const startMs = startUtc.getTime();
  const nowMs = now.getTime();
  if (startMs < nowMs) return "Bookings cannot be in the past.";
  if (startMs - nowMs < MIN_LEAD_MINUTES * 60_000) {
    return "Bookings must be made at least 2 hours ahead.";
  }
  if (startMs - nowMs > MAX_AHEAD_DAYS * 24 * 60 * 60_000) {
    return "Bookings can be at most 60 days ahead.";
  }
  return null;
}

/** Customer cancel/reschedule cutoff: allowed only up to 24h before the start. */
export function tooLateToChange(startUtc: string, now: Date): boolean {
  return ms(startUtc) - now.getTime() < CANCEL_CUTOFF_HOURS * 60 * 60_000;
}

export type Slot = { startMinute: number; label: string };

/**
 * All bookable slot start times for one stylist on one local date, given the
 * service duration and that stylist's active bookings (any status handled by
 * the caller, which passes only non-cancelled bookings).
 */
export function availableSlots(opts: {
  service: Service;
  stylistId: number;
  date: string;
  now: Date;
  activeBookings: Interval[];
}): Slot[] {
  const { service, stylistId, date, now, activeBookings } = opts;
  const weekday = weekdayOf(date);
  const shift = shiftFor(stylistId, weekday);
  if (!shift) return [];
  const slots: Slot[] = [];
  for (let start = shift.startMinute; start + service.minutes <= shift.endMinute; start += SLOT_STEP_MINUTES) {
    const startUtc = localMinutesToUtc(date, start);
    const endUtc = localMinutesToUtc(date, start + service.minutes);
    if (windowError(startUtc, now)) continue;
    if (overlaps(startUtc.getTime(), endUtc.getTime(), activeBookings)) continue;
    slots.push({ startMinute: start, label: minutesToLabel(start) });
  }
  return slots;
}

/**
 * Slots (union across the given stylists) for the "any available stylist"
 * view. Returns minutes plus which stylists are free at each slot.
 */
export function anyStylistSlots(opts: {
  service: Service;
  stylistIds: number[];
  date: string;
  now: Date;
  bookingsByStylist: Map<number, Interval[]>;
}): Array<Slot & { stylistIds: number[] }> {
  const byMinute = new Map<number, Slot & { stylistIds: number[] }>();
  for (const stylistId of opts.stylistIds) {
    const slots = availableSlots({
      service: opts.service,
      stylistId,
      date: opts.date,
      now: opts.now,
      activeBookings: opts.bookingsByStylist.get(stylistId) ?? [],
    });
    for (const slot of slots) {
      const existing = byMinute.get(slot.startMinute);
      if (existing) existing.stylistIds.push(stylistId);
      else byMinute.set(slot.startMinute, { ...slot, stylistIds: [stylistId] });
    }
  }
  return [...byMinute.values()].sort((a, b) => a.startMinute - b.startMinute);
}

/**
 * First stylist (in fixed STYLISTS order) who can take this booking. Used to
 * assign "any available stylist" inside the create transaction.
 */
export function firstFreeStylist(opts: {
  service: Service;
  stylistIds: number[];
  date: string;
  startMinute: number;
  now: Date;
  bookingsByStylist: Map<number, Interval[]>;
}): number | null {
  for (const stylistId of opts.stylistIds) {
    const slots = availableSlots({
      service: opts.service,
      stylistId,
      date: opts.date,
      now: opts.now,
      activeBookings: opts.bookingsByStylist.get(stylistId) ?? [],
    });
    if (slots.some((s) => s.startMinute === opts.startMinute)) return stylistId;
  }
  return null;
}

/** Local display string for a stored UTC instant, e.g. "Mon 2027-03-15, 9:00 AM". */
export function describeLocal(isoUtc: string): string {
  return DateTime.fromISO(isoUtc).setZone("America/Chicago").toFormat("ccc yyyy-MM-dd, h:mm a");
}
