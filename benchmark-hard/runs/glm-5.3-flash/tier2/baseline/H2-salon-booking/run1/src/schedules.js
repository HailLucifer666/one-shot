'use strict';

/**
 * Static catalog data from the spec. These are seeded into the database on
 * first start (single source of truth at seed time; runtime reads the DB).
 *
 * Weekdays use ISO numbering (Luxon): 1 = Monday ... 6 = Saturday, 7 = Sunday.
 * The salon itself is open Monday-Saturday 09:00-18:00 and closed Sunday;
 * stylist windows are always intersected with salon hours at slot computation.
 */

const STYLISTS = [
  {
    code: 'ana',
    name: 'Ana',
    days: [1, 2, 3, 4, 5, 6], // Mon-Sat
    start: '09:00',
    end: '18:00',
    saturdayEnd: null,
  },
  {
    code: 'ben',
    name: 'Ben',
    days: [2, 3, 4, 5, 6], // Tue-Sat
    start: '09:00',
    end: '18:00',
    saturdayEnd: '13:00', // Saturday only until 13:00
  },
  {
    code: 'cleo',
    name: 'Cleo',
    days: [1, 3, 5], // Mon, Wed, Fri
    start: '11:00',
    end: '18:00',
    saturdayEnd: null,
  },
];

const SERVICES = [
  { code: 'haircut', name: 'Haircut', duration_minutes: 30, price_cents: 3500 },
  { code: 'color', name: 'Color', duration_minutes: 90, price_cents: 12000 },
  { code: 'beard', name: 'Beard trim', duration_minutes: 15, price_cents: 1500 },
  {
    code: 'cutcolor',
    name: 'Cut and color',
    duration_minutes: 120,
    price_cents: 14000,
  },
];

const WEEKDAY_NAMES = [
  null,
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function hmToMinutes(hm) {
  const [h, m] = hm.split(':').map((n) => Number.parseInt(n, 10));
  return h * 60 + m;
}

/** Human-readable schedule for the UI, e.g. "Mon-Sat 9:00 AM-6:00 PM". */
function scheduleText(row) {
  const days = row.workdays.split(',').map((n) => Number.parseInt(n, 10));
  const abbrev = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
  const dayTxt = days.map((d) => abbrev[d]).join(', ');
  const fmt = (min) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };
  let end = row.end_minute;
  if (days.includes(6) && row.saturday_end_minute != null) {
    return `${dayTxt} ${fmt(row.start_minute)}-${fmt(row.saturday_end_minute)} (Sat) / ${fmt(end)} (other days)`;
  }
  return `${dayTxt} ${fmt(row.start_minute)}-${fmt(end)}`;
}

module.exports = { STYLISTS, SERVICES, WEEKDAY_NAMES, hmToMinutes, scheduleText };
