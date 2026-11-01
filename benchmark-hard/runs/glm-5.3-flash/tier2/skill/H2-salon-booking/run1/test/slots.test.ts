import test from "node:test";
import assert from "node:assert/strict";
import {
  localMinutesToUtc,
  serviceById,
  weekdayOf,
} from "../src/salon.ts";
import {
  anyStylistSlots,
  availableSlots,
  firstFreeStylist,
  tooLateToChange,
  windowError,
  type Interval,
} from "../src/slots.ts";

const HAIRCUT = serviceById("haircut")!;
const COLOR = serviceById("color")!;
const CUTCOLOR = serviceById("cutcolor")!;
const BEARD = serviceById("beard")!;

// 2027-03-13 is a Saturday; 2027-03-15 the following Monday.
const SAT = "2027-03-13";
const MON = "2027-03-15";
// 06:00 local Chicago on that Saturday = 12:00Z (before DST starts 2027-03-14).
const SAT_MORNING = new Date("2027-03-13T12:00:00Z");

function labels(stylistId: number, date: string, service = HAIRCUT, now = SAT_MORNING, booked: Interval[] = []) {
  return availableSlots({ service, stylistId, date, now, activeBookings: booked }).map((s) => s.label);
}

test("weekdayOf treats 2027-03-13 as Saturday (6) and 2027-03-15 as Monday (1)", () => {
  assert.equal(weekdayOf(SAT), 6);
  assert.equal(weekdayOf(MON), 1);
});

test("Ben's Saturday 12:45 slot is not offered for a 30-minute haircut; Ana's is", () => {
  const ben = labels(2, SAT);
  const ana = labels(1, SAT);
  assert.ok(!ben.includes("12:45"), "Ben must not offer 12:45 on Saturday for a haircut");
  assert.ok(ben.includes("12:30"), "Ben's last Saturday haircut slot is 12:30 (ends 13:00)");
  assert.ok(ana.includes("12:45"), "Ana works until 18:00 so 12:45 is offered for her");
});

test("Cleo has no slots on Tuesday and none before 11:00 on Monday", () => {
  assert.deepEqual(labels(3, "2027-03-16"), [], "Cleo does not work Tuesdays");
  const monday = labels(3, MON, BEARD);
  assert.ok(!monday.includes("10:45"));
  assert.ok(monday.includes("11:00"), "Cleo's first Monday slot is 11:00");
});

test("Sunday is never bookable for any stylist", () => {
  const sunday = "2027-03-14";
  for (const stylistId of [1, 2, 3]) {
    assert.deepEqual(labels(stylistId, sunday), [], `stylist ${stylistId} must have no Sunday slots`);
  }
});

test("a service must end by the stylist's finish time", () => {
  // Ana Monday: 120-minute cut+color must start by 16:00 (ends 18:00).
  const slots = labels(1, MON, CUTCOLOR);
  assert.ok(slots.includes("16:00"));
  assert.ok(!slots.includes("16:15"));
  assert.ok(!slots.includes("17:30"), "17:30 is the last 30-min haircut slot, not valid for 120 minutes");
});

test("booking window: exactly 2 hours ahead is allowed, 1ms less is refused", () => {
  const now = new Date("2027-03-16T12:00:00Z");
  assert.equal(windowError(new Date("2027-03-16T14:00:00Z"), now), null);
  assert.match(windowError(new Date(now.getTime() + 2 * 3600_000 - 1), now) ?? "", /2 hours/);
});

test("booking window: exactly 60 days ahead is allowed, 1ms more is refused", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const at60 = new Date(now.getTime() + 60 * 24 * 3600_000);
  assert.equal(windowError(at60, now), null);
  assert.match(windowError(new Date(at60.getTime() + 1), now) ?? "", /60 days/);
});

test("booking window: a past start is refused", () => {
  const now = new Date("2027-03-16T12:00:00Z");
  assert.match(windowError(new Date("2027-03-16T11:59:59Z"), now) ?? "", /past/);
});

test("overlap: a 90-minute color at 10:00 blocks a haircut at 11:15 but not at 11:30", () => {
  const booked: Interval[] = [
    { startUtc: localMinutesToUtc(MON, 10 * 60).toISOString(), endUtc: localMinutesToUtc(MON, 11 * 60 + 30).toISOString() },
  ];
  const slots = labels(1, MON, HAIRCUT, SAT_MORNING, booked);
  assert.ok(!slots.includes("11:15"), "11:15 haircut would overlap the color");
  assert.ok(!slots.includes("10:15"));
  assert.ok(slots.includes("11:30"), "a slot starting exactly when the color ends is fine");
});

test("any-stylist slots list only stylists who are actually free", () => {
  // Wednesday 2027-03-17: Ana and Ben work 9-18, Cleo 11-18.
  const WED = "2027-03-17";
  const bookingsByStylist = new Map<number, Interval[]>([
    [1, [{ startUtc: localMinutesToUtc(WED, 9 * 60).toISOString(), endUtc: localMinutesToUtc(WED, 10 * 60 + 30).toISOString() }]],
    [2, []],
    [3, []],
  ]);
  const slots = anyStylistSlots({
    service: HAIRCUT,
    stylistIds: [1, 2, 3],
    date: WED,
    now: SAT_MORNING,
    bookingsByStylist,
  });
  const at10 = slots.find((s) => s.label === "10:00");
  assert.ok(at10, "10:00 must be offered by someone free");
  assert.deepEqual(at10.stylistIds, [2], "Ana is busy 9:00-10:30, Cleo starts at 11:00, so only Ben is free");
  const at11 = slots.find((s) => s.label === "11:00");
  assert.deepEqual(at11?.stylistIds, [1, 2, 3]);
});

test("firstFreeStylist assigns a stylist who is free, skipping a busy one", () => {
  const WED = "2027-03-17";
  const bookingsByStylist = new Map<number, Interval[]>([
    [1, [{ startUtc: localMinutesToUtc(WED, 9 * 60).toISOString(), endUtc: localMinutesToUtc(WED, 10 * 60 + 30).toISOString() }]],
    [2, []],
    [3, []],
  ]);
  assert.equal(
    firstFreeStylist({ service: HAIRCUT, stylistIds: [1, 2, 3], date: WED, startMinute: 10 * 60, now: SAT_MORNING, bookingsByStylist }),
    2,
  );
  const busyNine = new Map<number, Interval[]>([
    [1, [{ startUtc: localMinutesToUtc(WED, 9 * 60).toISOString(), endUtc: localMinutesToUtc(WED, 10 * 60 + 30).toISOString() }]],
    [2, [{ startUtc: localMinutesToUtc(WED, 9 * 60).toISOString(), endUtc: localMinutesToUtc(WED, 10 * 60 + 30).toISOString() }]],
    [3, []],
  ]);
  assert.equal(
    firstFreeStylist({ service: HAIRCUT, stylistIds: [1, 2, 3], date: WED, startMinute: 9 * 60, now: SAT_MORNING, bookingsByStylist: busyNine }),
    null,
    "Ana and Ben are both busy 9:00-10:30 and Cleo starts at 11:00, so nobody is free at 09:00",
  );
});

test("DST: Saturday 2027-03-13 09:00 local is 15:00Z, Monday 2027-03-15 09:00 local is 14:00Z", () => {
  assert.equal(localMinutesToUtc(SAT, 9 * 60).toISOString(), "2027-03-13T15:00:00.000Z");
  assert.equal(localMinutesToUtc(MON, 9 * 60).toISOString(), "2027-03-15T14:00:00.000Z");
});

test("cancel cutoff: 23 hours before is too late, 24 hours before is allowed", () => {
  const start = "2027-03-20T15:00:00.000Z";
  const now23h = new Date(new Date(start).getTime() - 23 * 3600_000);
  const now24h = new Date(new Date(start).getTime() - 24 * 3600_000);
  assert.equal(tooLateToChange(start, now23h), true);
  assert.equal(tooLateToChange(start, now24h), false);
});
