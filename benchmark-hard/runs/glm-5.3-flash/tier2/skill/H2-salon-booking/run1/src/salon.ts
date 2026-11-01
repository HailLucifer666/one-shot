import { DateTime } from "luxon";

/** The salon's local time zone. All wall-clock times are interpreted here. */
export const SALON_TZ = "America/Chicago";

/** Slots start every 15 minutes. */
export const SLOT_STEP_MINUTES = 15;
/** Bookings must start at least this many minutes after "now". */
export const MIN_LEAD_MINUTES = 120;
/** Bookings may start at most this many days ahead. */
export const MAX_AHEAD_DAYS = 60;
/** Customers may cancel/reschedule up to this long before the start. */
export const CANCEL_CUTOFF_HOURS = 24;

export type ServiceId = "haircut" | "color" | "beard" | "cutcolor";

export type Service = {
  id: ServiceId;
  name: string;
  minutes: number;
  priceCents: number;
};

export const SERVICES: Service[] = [
  { id: "haircut", name: "Haircut", minutes: 30, priceCents: 3500 },
  { id: "color", name: "Color", minutes: 90, priceCents: 12000 },
  { id: "beard", name: "Beard trim", minutes: 15, priceCents: 1500 },
  { id: "cutcolor", name: "Cut and color", minutes: 120, priceCents: 14000 },
];

export function serviceById(id: string): Service | undefined {
  return SERVICES.find((s) => s.id === id);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

/**
 * Stylist shifts. weekday uses Luxon's convention: 1=Monday ... 7=Sunday.
 * start/end are minutes from local midnight; every shift sits inside the
 * salon's 9:00-18:00 Mon-Sat hours, and nobody works Sunday.
 */
export type Shift = { weekday: number; startMinute: number; endMinute: number };

export type Stylist = { id: number; name: string };

export const STYLISTS: Stylist[] = [
  { id: 1, name: "Ana" },
  { id: 2, name: "Ben" },
  { id: 3, name: "Cleo" },
];

const NINE = 9 * 60;
const THIRTEEN = 13 * 60;
const ELEVEN = 11 * 60;
const EIGHTEEN = 18 * 60;

export const SHIFTS: Record<number, Shift[]> = {
  // Ana: Monday to Saturday 9:00-18:00
  1: [
    { weekday: 1, startMinute: NINE, endMinute: EIGHTEEN },
    { weekday: 2, startMinute: NINE, endMinute: EIGHTEEN },
    { weekday: 3, startMinute: NINE, endMinute: EIGHTEEN },
    { weekday: 4, startMinute: NINE, endMinute: EIGHTEEN },
    { weekday: 5, startMinute: NINE, endMinute: EIGHTEEN },
    { weekday: 6, startMinute: NINE, endMinute: EIGHTEEN },
  ],
  // Ben: Tuesday to Saturday 9:00-18:00, but Saturday only until 13:00
  2: [
    { weekday: 2, startMinute: NINE, endMinute: EIGHTEEN },
    { weekday: 3, startMinute: NINE, endMinute: EIGHTEEN },
    { weekday: 4, startMinute: NINE, endMinute: EIGHTEEN },
    { weekday: 5, startMinute: NINE, endMinute: EIGHTEEN },
    { weekday: 6, startMinute: NINE, endMinute: THIRTEEN },
  ],
  // Cleo: Monday, Wednesday, Friday 11:00-18:00
  3: [
    { weekday: 1, startMinute: ELEVEN, endMinute: EIGHTEEN },
    { weekday: 3, startMinute: ELEVEN, endMinute: EIGHTEEN },
    { weekday: 5, startMinute: ELEVEN, endMinute: EIGHTEEN },
  ],
};

export function stylistById(id: number): Stylist | undefined {
  return STYLISTS.find((s) => s.id === id);
}

export function shiftFor(stylistId: number, weekday: number): Shift | undefined {
  return SHIFTS[stylistId]?.find((sh) => sh.weekday === weekday);
}

/** Luxon weekday of a local date (1=Monday ... 7=Sunday). */
export function weekdayOf(date: string): number {
  return DateTime.fromISO(date, { zone: SALON_TZ }).weekday;
}

/** Convert a local date + minutes-from-midnight in the salon zone to a UTC Date. */
export function localMinutesToUtc(date: string, minutes: number): Date {
  const dt = DateTime.fromObject(
    {
      year: Number(date.slice(0, 4)),
      month: Number(date.slice(5, 7)),
      day: Number(date.slice(8, 10)),
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
    },
    { zone: SALON_TZ },
  );
  return dt.toJSDate();
}

/** Format a stored UTC instant for display in the salon's time zone. */
export function formatLocal(isoUtc: string, format: string): string {
  return DateTime.fromISO(isoUtc).setZone(SALON_TZ).toFormat(format);
}

/** The local date (YYYY-MM-DD) of a stored UTC instant. */
export function localDateOf(isoUtc: string): string {
  return DateTime.fromISO(isoUtc).setZone(SALON_TZ).toFormat("yyyy-MM-dd");
}

export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function labelToMinutes(label: string): number {
  const parts = label.split(":");
  const h = Number(parts[0] ?? "0");
  const m = Number(parts[1] ?? "0");
  return h * 60 + m;
}

/** "13:15" -> "1:15 PM" for display. */
export function minutesToLabel12(minutes: number): string {
  return DateTime.fromObject({ hour: Math.floor(minutes / 60), minute: minutes % 60 }).toFormat("h:mm a");
}
