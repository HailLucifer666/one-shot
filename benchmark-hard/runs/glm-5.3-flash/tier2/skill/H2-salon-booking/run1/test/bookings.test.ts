import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { startTestServer, Client, DEFAULT_NOW, type TestServer } from "./helpers/http.ts";
import { registerCustomer } from "./helpers/auth.ts";
import { createBooking } from "../src/bookings.ts";
import { refFormatOk } from "../src/refs.ts";
import { SALON_TZ } from "../src/salon.ts";

// Fixed clock: Wednesday 2026-11-04, 06:00 salon time.
// Handy local dates relative to that clock:
const THU = "2026-11-05";
const SAT = "2026-11-07";
const SUN = "2026-11-08";
const MON = "2026-11-09";
const WED = "2026-11-04";

async function withServer(clockIso: string | undefined, fn: (ts: TestServer, db: DatabaseSync) => void | Promise<void>) {
  const ts = await startTestServer(clockIso);
  try {
    const db = new DatabaseSync(join(ts.dataDir, "cutwell.db"));
    await fn(ts, db);
    db.close();
  } finally {
    ts.close();
  }
}

async function newCustomer(ts: TestServer, email: string): Promise<Client> {
  const client = new Client(ts.port);
  const res = await registerCustomer(client, email);
  assert.equal(res.status, 303, `registering ${email} should sign in`);
  return client;
}

function book(
  client: Client,
  opts: { service: string; stylist: string; date: string; start: string },
) {
  return client.request("/book", { form: opts });
}

/** "/bookings/CW-7K2M9P?booked=1" -> "CW-7K2M9P" */
function refFromLocation(location: string | null): string {
  const path = (location ?? "").split("?")[0] ?? "";
  return path.split("/").pop() ?? "";
}

test("anonymous visitors are redirected to sign in", async () => {
  await withServer(undefined, async (ts) => {
    const res = await fetch(`http://127.0.0.1:${ts.port}/book`, { redirect: "manual" });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/login");
  });
});

test("end to end: register, book with a chosen stylist, view, cancel", async () => {
  await withServer(undefined, async (ts) => {
    const client = await newCustomer(ts, "e2e@example.com");

    // Booking form renders with labeled controls.
    const form = await client.request("/book");
    assert.equal(form.status, 200);
    assert.match(form.text, /Haircut — 30 min/);
    assert.match(form.text, /Any available stylist/);

    // Slots for Ben on Saturday include 12:30 but not 12:45 (criterion 2).
    const slots = await client.request(`/book?service=haircut&stylist=2&date=${SAT}`);
    assert.match(slots.text, /12:30 PM/);
    assert.doesNotMatch(slots.text, /12:45 PM/);

    // Book Ana Thursday 10:00.
    const created = await book(client, { service: "haircut", stylist: "1", date: THU, start: "10:00" });
    assert.equal(created.status, 303);
    const ref = refFromLocation(created.location);
    assert.ok(refFormatOk(ref), `ref ${ref} matches CW-XXXXXX`);

    // Detail page shows the booking in salon time.
    const detail = await client.request(`/bookings/${ref}`);
    assert.equal(detail.status, 200);
    assert.match(detail.text, new RegExp(ref));
    assert.match(detail.text, /Haircut/);
    assert.match(detail.text, /Ana/);
    assert.match(detail.text, /10:00 AM/);

    // My bookings lists it.
    const list = await client.request("/bookings");
    assert.match(list.text, new RegExp(ref));

    // Cancel it (more than 24h ahead).
    const cancelPage = await client.request(`/bookings/${ref}/cancel`);
    assert.match(cancelPage.text, /Cancel booking/);
    const cancelled = await client.request(`/bookings/${ref}/cancel`, { method: "POST", form: {} });
    assert.equal(cancelled.status, 303);
    const after = await client.request(`/bookings/${ref}`);
    assert.match(after.text, /Cancelled/);

    // Cancellation email in the outbox (criterion 17).
    const files = readdirSync(ts.outboxDir);
    assert.ok(files.includes(`${ref}-confirmation.txt`), "confirmation email file exists");
    assert.ok(files.includes(`${ref}-cancellation.txt`), "cancellation email file exists");
    const cancelEmail = readFileSync(join(ts.outboxDir, `${ref}-cancellation.txt`), "utf8");
    assert.match(cancelEmail, new RegExp(ref));
    assert.match(cancelEmail, /e2e@example\.com/);
  });
});

test("a booking less than 2 hours ahead is refused; exactly 2 hours is allowed", async () => {
  // Clock: Monday 2026-11-09, 09:00 salon time. The 2h boundary is 11:00 local,
  // which is inside Ana's Monday shift, so the boundary is bookable.
  await withServer("2026-11-09T15:00:00Z", async (ts) => {
    const client = await newCustomer(ts, "lead@example.com");
    const tooSoon = await book(client, { service: "haircut", stylist: "1", date: MON, start: "10:45" });
    assert.equal(tooSoon.status, 409);
    assert.match(tooSoon.text, /at least 2 hours/);
    const edge = await book(client, { service: "haircut", stylist: "1", date: MON, start: "11:00" });
    assert.equal(edge.status, 303, "exactly 2 hours ahead is allowed (at least 2 hours)");
  });
});

test("a booking more than 60 days ahead is refused; exactly 60 days is allowed", async () => {
  // Clock: Thursday 2026-09-10, 12:00 salon time (CDT). now + 60 days is
  // Monday 2026-11-09 11:00 salon time (CST) — a bookable slot, so the exact
  // boundary can be exercised on both sides.
  await withServer("2026-09-10T17:00:00Z", async (ts) => {
    const client = await newCustomer(ts, "horizon@example.com");
    const tooFar = await book(client, { service: "haircut", stylist: "1", date: MON, start: "11:15" });
    assert.equal(tooFar.status, 409);
    assert.match(tooFar.text, /60 days/);
    const edge = await book(client, { service: "haircut", stylist: "1", date: MON, start: "11:00" });
    assert.equal(edge.status, 303, "exactly 60 days ahead is allowed (at most 60 days)");
  });
});

test("a booking in the past is refused", async () => {
  await withServer(undefined, async (ts) => {
    const client = await newCustomer(ts, "past@example.com");
    // Tuesday (yesterday relative to the fixed Wednesday clock), Ana works Tuesdays.
    const res = await book(client, { service: "haircut", stylist: "1", date: "2026-11-03", start: "10:00" });
    assert.equal(res.status, 409);
    assert.match(res.text, /past/);
  });
});

test("partial overlap is refused: a 90-minute color at 10:00 blocks a haircut at 11:15", async () => {
  await withServer(undefined, async (ts) => {
    const a = await newCustomer(ts, "overlap-a@example.com");
    const b = await newCustomer(ts, "overlap-b@example.com");
    const color = await book(a, { service: "color", stylist: "1", date: MON, start: "10:00" });
    assert.equal(color.status, 303, "the color books fine");
    const clash = await book(b, { service: "haircut", stylist: "1", date: MON, start: "11:15" });
    assert.equal(clash.status, 409);
    assert.match(clash.text, /no longer available/);
    // A slot starting exactly when the color ends is fine.
    const after = await book(b, { service: "haircut", stylist: "1", date: MON, start: "11:30" });
    assert.equal(after.status, 303);
  });
});

test("the confirm page shows the chosen slot in salon time, not the server's zone", async () => {
  await withServer(undefined, async (ts) => {
    const client = await newCustomer(ts, "preview-tz@example.com");
    const res = await client.request("/book/preview", {
      form: { service: "haircut", stylist: "1", date: THU, start: "10:00" },
    });
    assert.equal(res.status, 200);
    assert.match(res.text, /10:00 AM/, "confirm page shows 10:00 AM salon time");
    assert.doesNotMatch(res.text, /10:30 PM/, "no shift from mis-zoned parsing");
  });
});

test("any available stylist picks someone who is actually free", async () => {
  await withServer(undefined, async (ts) => {
    const a = await newCustomer(ts, "any-a@example.com");
    const b = await newCustomer(ts, "any-b@example.com");
    // Ana is booked 10:00-11:30 on Thursday; Cleo does not work Thursdays.
    const color = await book(a, { service: "color", stylist: "1", date: THU, start: "10:00" });
    assert.equal(color.status, 303);
    const anyBooking = await book(b, { service: "haircut", stylist: "any", date: THU, start: "10:00" });
    assert.equal(anyBooking.status, 303);
    const ref = refFromLocation(anyBooking.location);
    const detail = await b.request(`/bookings/${ref}`);
    assert.match(detail.text, /Ben/, "Ben must be assigned because Ana is busy and Cleo is off");
  });
});

test("Sunday is never bookable, on the form or by direct POST", async () => {
  await withServer(undefined, async (ts) => {
    const client = await newCustomer(ts, "sunday@example.com");
    const form = await client.request(`/book?service=haircut&stylist=1&date=${SUN}`);
    assert.match(form.text, /No free slots for this day/);
    const direct = await book(client, { service: "haircut", stylist: "1", date: SUN, start: "10:00" });
    assert.equal(direct.status, 409);
    assert.match(direct.text, /does not work on this day/);
  });
});

test("Cleo is never offered before 11:00 or on Tuesday", async () => {
  await withServer(undefined, async (ts) => {
    const client = await newCustomer(ts, "cleo@example.com");
    const monday = await client.request(`/book?service=beard&stylist=3&date=${MON}`);
    assert.ok(!monday.text.includes("10:15 AM"), "no slot before 11:00");
    assert.match(monday.text, /11:00 AM/);
    const tuesday = await client.request(`/book?service=beard&stylist=3&date=2026-11-10`);
    assert.match(tuesday.text, /No free slots for this day/);
  });
});

test("confirmation email is written to the outbox and is readable", async () => {
  await withServer(undefined, async (ts) => {
    const client = await newCustomer(ts, "outbox@example.com");
    const created = await book(client, { service: "color", stylist: "3", date: MON, start: "11:00" });
    assert.equal(created.status, 303);
    const ref = refFromLocation(created.location);
    const email = readFileSync(join(ts.outboxDir, `${ref}-confirmation.txt`), "utf8");
    assert.match(email, /CUTWELL SALON — CONFIRMATION/);
    assert.match(email, new RegExp(ref));
    assert.match(email, /outbox@example\.com/);
    assert.match(email, /Cleo/);
    assert.match(email, /11:00 AM/);
  });
});

test("cancelling more than 24h ahead succeeds; cancelling inside 24h is refused with a clear message", async () => {
  await withServer(undefined, async (ts) => {
    const client = await newCustomer(ts, "cutoff@example.com");
    // Thursday 10:00 is 28h ahead: cancellable.
    const far = await book(client, { service: "haircut", stylist: "1", date: THU, start: "10:00" });
    assert.equal(far.status, 303);
    const farRef = refFromLocation(far.location);
    const okCancel = await client.request(`/bookings/${farRef}/cancel`, { method: "POST", form: {} });
    assert.equal(okCancel.status, 303);

    // Wednesday 17:30 is 17.5h ahead at the current clock: not cancellable.
    const near = await book(client, { service: "haircut", stylist: "1", date: WED, start: "17:30" });
    assert.equal(near.status, 303, "booking 17.5h ahead is allowed (2h rule)");
    const nearRef = refFromLocation(near.location);
    const refused = await client.request(`/bookings/${nearRef}/cancel`, { method: "POST", form: {} });
    assert.equal(refused.status, 409);
    assert.match(refused.text, /up to 24 hours before the start/);
    const still = await client.request(`/bookings/${nearRef}`);
    assert.match(still.text, /Confirmed/);
  });
});

test("reschedule keeps the reference and applies booking rules to the new time", async () => {
  await withServer(undefined, async (ts) => {
    const client = await newCustomer(ts, "resched@example.com");
    const created = await book(client, { service: "haircut", stylist: "1", date: THU, start: "10:00" });
    const ref = refFromLocation(created.location);

    const slotsPage = await client.request(`/bookings/${ref}/reschedule?date=2026-11-06`);
    assert.match(slotsPage.text, /Pick a new start time/);

    const moved = await client.request(`/bookings/${ref}/reschedule`, {
      method: "POST",
      form: { date: "2026-11-06", start: "11:00" },
    });
    assert.equal(moved.status, 303);
    assert.equal(moved.location, `/bookings/${ref}?rescheduled=1`, "same reference after reschedule");

    const detail = await client.request(`/bookings/${ref}`);
    assert.match(detail.text, /11:00 AM/, "detail shows the new time");
    assert.match(detail.text, /Fri 2026-11-06/, "new time is on the requested day");
  });
});

test("reschedule inside 24h of the ORIGINAL start is refused", async () => {
  await withServer(undefined, async (ts) => {
    const client = await newCustomer(ts, "resched-cutoff@example.com");
    // Wednesday 17:30 is 17.5h ahead: allowed to book, not to reschedule.
    const created = await book(client, { service: "haircut", stylist: "1", date: WED, start: "17:30" });
    const ref = refFromLocation(created.location);
    const refused = await client.request(`/bookings/${ref}/reschedule`, {
      method: "POST",
      form: { date: THU, start: "10:00" },
    });
    assert.equal(refused.status, 409);
    assert.match(refused.text, /up to 24 hours before the start/);
  });
});

test("reschedule refuses a new time that clashes with another booking", async () => {
  await withServer(undefined, async (ts) => {
    const a = await newCustomer(ts, "resched-a@example.com");
    const b = await newCustomer(ts, "resched-b@example.com");
    const aBooking = await book(a, { service: "haircut", stylist: "1", date: THU, start: "10:00" });
    const ref = refFromLocation(aBooking.location);
    const bBooking = await book(b, { service: "haircut", stylist: "1", date: THU, start: "11:00" });
    assert.equal(bBooking.status, 303, "Ana is free at 11:00");
    const clash = await a.request(`/bookings/${ref}/reschedule`, {
      method: "POST",
      form: { date: THU, start: "11:00" },
    });
    assert.equal(clash.status, 409);
    assert.match(clash.text, /no longer available/);
  });
});

test("DST: Monday 2027-03-15 09:00 local stores as 14:00Z; Saturday 2027-03-13 09:00 stores as 15:00Z", async () => {
  await withServer("2027-03-13T12:00:00Z", async (ts, db) => {
    const client = await newCustomer(ts, "dst@example.com");
    const monday = await book(client, { service: "haircut", stylist: "1", date: "2027-03-15", start: "09:00" });
    assert.equal(monday.status, 303);
    const mondayRef = refFromLocation(monday.location);
    const mondayRow = db.prepare("SELECT start_utc, end_utc FROM bookings WHERE ref = ?").get(mondayRef) as {
      start_utc: string;
      end_utc: string;
    };
    assert.equal(mondayRow.start_utc, "2027-03-15T14:00:00.000Z", "CDT (UTC-5) after the spring change");
    const shown = await client.request(`/bookings/${mondayRef}`);
    assert.match(shown.text, /9:00 AM/, "displayed as 9:00 AM in salon time");

    const saturday = await book(client, { service: "haircut", stylist: "1", date: "2027-03-13", start: "09:00" });
    assert.equal(saturday.status, 303);
    const saturdayRef = refFromLocation(saturday.location);
    const saturdayRow = db.prepare("SELECT start_utc FROM bookings WHERE ref = ?").get(saturdayRef) as { start_utc: string };
    assert.equal(saturdayRow.start_utc, "2027-03-13T15:00:00.000Z", "CST (UTC-6) before the spring change");
  });
});

test("two simultaneous requests for the same slot: exactly one succeeds, repeated 5 times", async () => {
  await withServer(undefined, async (ts, db) => {
    const a = await newCustomer(ts, "race-a@example.com");
    const b = await newCustomer(ts, "race-b@example.com");
    const slots = ["12:00", "12:30", "13:00", "14:00", "14:30"];
    let successes = 0;
    for (const start of slots) {
      const [r1, r2] = await Promise.all([
        book(a, { service: "haircut", stylist: "1", date: THU, start }),
        book(b, { service: "haircut", stylist: "1", date: THU, start }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, [303, 409], `round ${start}: exactly one winner and one 409`);
      successes += 1;
    }
    assert.equal(successes, 5);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE local_date = ? AND stylist_id = 1").get(THU) as { n: number }).n;
    assert.equal(count, 5, "exactly five bookings exist in the database");
  });
});

test("reference codes are unique across 200 generated bookings (criterion 16)", async () => {
  await withServer(undefined, async (_ts, db) => {
    // Ana works Mon-Sat 9-18; a 30-minute haircut fills a 15-min slot every
    // 30 minutes, so 18 non-overlapping bookings per day.
    const workingDays: string[] = [];
    let cursor = DateTime.fromISO("2026-11-04", { zone: SALON_TZ });
    while (workingDays.length < 12) {
      if (cursor.weekday <= 6) workingDays.push(cursor.toISODate() ?? "");
      cursor = cursor.plus({ days: 1 });
    }
    const refs = new Set<string>();
    for (let n = 0; n < 200; n++) {
      const dayIndex = Math.floor(n / 18) % workingDays.length;
      const minute = 9 * 60 + (n % 18) * 30;
      const customerId = (n % 4) + 1; // seeded users: admin 1, stylists 2-4
      const result = createBooking(db, {
        customerId,
        serviceId: "haircut",
        stylistId: 1,
        date: workingDays[dayIndex]!,
        startMinute: minute,
      });
      assert.ok(result.ok, `booking ${n} should succeed: ${JSON.stringify(result)}`);
      if (result.ok) {
        assert.ok(refFormatOk(result.booking.ref));
        refs.add(result.booking.ref);
      }
    }
    assert.equal(refs.size, 200, "all 200 reference codes are distinct");
  });
});

test("every create writes an audit row with actor and after snapshot", async () => {
  await withServer(undefined, async (ts, db) => {
    const client = await newCustomer(ts, "audit@example.com");
    const created = await book(client, { service: "haircut", stylist: "1", date: THU, start: "10:00" });
    const ref = refFromLocation(created.location);
    const row = db.prepare("SELECT * FROM audit_log WHERE booking_ref = ? AND action = 'CREATE'").get(ref) as {
      actor_email: string;
      before_json: string | null;
      after_json: string;
      at_utc: string;
    } | undefined;
    assert.ok(row, "CREATE audit row exists");
    assert.equal(row.actor_email, "audit@example.com");
    assert.equal(row.before_json, null);
    const after = JSON.parse(row.after_json) as { ref: string; status: string };
    assert.equal(after.ref, ref);
    assert.equal(after.status, "CONFIRMED");
  });
});
