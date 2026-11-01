import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { startTestServer, Client, type TestServer } from "./helpers/http.ts";
import { registerCustomer, signIn, SEED } from "./helpers/auth.ts";
import { createBooking } from "../src/bookings.ts";
import { DateTime } from "luxon";
import { SALON_TZ } from "../src/salon.ts";

const THU = "2026-11-05";
const FRI = "2026-11-06";
const MON = "2026-11-09";

async function withServer(fn: (ts: TestServer, db: DatabaseSync, admin: Client) => Promise<void>) {
  const ts = await startTestServer();
  try {
    const db = new DatabaseSync(join(ts.dataDir, "cutwell.db"));
    const admin = new Client(ts.port);
    const login = await signIn(admin, SEED.adminEmail, SEED.adminPassword);
    assert.equal(login.status, 303);
    await fn(ts, db, admin);
    db.close();
  } finally {
    ts.close();
  }
}

async function newCustomer(ts: TestServer, email: string): Promise<Client> {
  const client = new Client(ts.port);
  const res = await registerCustomer(client, email);
  assert.equal(res.status, 303);
  return client;
}

test("admin pages are blocked for customers and anonymous visitors", async () => {
  await withServer(async (ts, _db, admin) => {
    for (const path of ["/admin/bookings", "/admin/audit", "/admin/bookings/export.csv"]) {
      const anonymous = await fetch(`http://127.0.0.1:${ts.port}${path}`, { redirect: "manual" });
      assert.equal(anonymous.status, 303, `${path} redirects anonymous visitors`);
      const adminRes = await admin.request(path);
      assert.equal(adminRes.status, 200, `admin can open ${path}`);
    }
    const customer = await newCustomer(ts, "blocked@example.com");
    for (const path of ["/admin/bookings", "/admin/audit"]) {
      const res = await customer.request(path);
      assert.equal(res.status, 403, `customer blocked from ${path}`);
    }
  });
});

test("admin list paginates at 20 per page (criterion 18)", async () => {
  await withServer(async (_ts, db, admin) => {
    // 25 bookings: Ana haircut, 18 slots per working day, two days.
    const days = [THU, FRI];
    for (let n = 0; n < 25; n++) {
      const day = days[Math.floor(n / 18)]!;
      const minute = 9 * 60 + (n % 18) * 30;
      const result = createBooking(db, { customerId: 1, serviceId: "haircut", stylistId: 1, date: day, startMinute: minute });
      assert.ok(result.ok, `booking ${n} created`);
    }
    const page1 = await admin.request("/admin/bookings");
    const page1Count = (page1.text.match(/<span class="ref-code">/g) ?? []).length;
    assert.equal(page1Count, 20, "page 1 has 20 rows");
    assert.match(page1.text, /Page 1 of 2 · 25 bookings/);
    const page2 = await admin.request("/admin/bookings?page=2");
    const page2Count = (page2.text.match(/<span class="ref-code">/g) ?? []).length;
    assert.equal(page2Count, 5, "page 2 has the remaining 5 rows");
  });
});

test("date, stylist and status filters combine (criterion 18)", async () => {
  await withServer(async (_ts, db, admin) => {
    createBooking(db, { customerId: 1, serviceId: "haircut", stylistId: 1, date: MON, startMinute: 9 * 60 });
    createBooking(db, { customerId: 1, serviceId: "haircut", stylistId: 1, date: MON, startMinute: 10 * 60 });
    createBooking(db, { customerId: 1, serviceId: "haircut", stylistId: 2, date: MON, startMinute: 9 * 60 });
    createBooking(db, { customerId: 1, serviceId: "haircut", stylistId: 1, date: THU, startMinute: 9 * 60 });

    // Ana + Monday + Confirmed -> exactly the two Ana Monday bookings.
    const both = await admin.request(`/admin/bookings?stylist=1&date=${MON}&status=CONFIRMED`);
    assert.match(both.text, /2 bookings/, "two rows match the combined filters");
    // Cancel one, then the CANCELLED filter shows exactly it.
    const refRow = db
      .prepare("SELECT ref FROM bookings WHERE stylist_id = 1 AND local_date = ? AND start_utc = ?")
      .get(MON, "2026-11-09T15:00:00.000Z") as { ref: string };
    const cancel = await admin.request(`/admin/bookings/${refRow.ref}/cancel`, {
      method: "POST",
      form: { reason: "salon maintenance" },
    });
    assert.equal(cancel.status, 303);
    const cancelledFilter = await admin.request(`/admin/bookings?stylist=1&date=${MON}&status=CANCELLED`);
    assert.match(cancelledFilter.text, /1 booking(s)?/);
    assert.match(cancelledFilter.text, new RegExp(refRow.ref));
  });
});

test("admin can cancel inside the 24-hour window and must give a reason (criterion 8)", async () => {
  await withServer(async (ts, db, admin) => {
    const customer = await newCustomer(ts, "late-cancel@example.com");
    // Wednesday 17:30 is 17.5h ahead: a customer could not cancel this.
    const created = createBooking(db, { customerId: customerBookingId(db, "late-cancel@example.com"), serviceId: "haircut", stylistId: 1, date: "2026-11-04", startMinute: 17 * 60 + 30 });
    assert.ok(created.ok);
    const ref = created.ok ? created.booking.ref : "";

    const noReason = await admin.request(`/admin/bookings/${ref}/cancel`, { method: "POST", form: { reason: "   " } });
    assert.equal(noReason.status, 400);
    assert.match(noReason.text, /reason is required/);

    const ok = await admin.request(`/admin/bookings/${ref}/cancel`, {
      method: "POST",
      form: { reason: "stylist unwell" },
    });
    assert.equal(ok.status, 303, "admin cancels inside the 24h window");
    const row = db.prepare("SELECT status, cancelled_reason FROM bookings WHERE ref = ?").get(ref) as {
      status: string;
      cancelled_reason: string;
    };
    assert.equal(row.status, "CANCELLED");
    assert.equal(row.cancelled_reason, "stylist unwell");

    // Audit + email carry the reason.
    const audit = db.prepare("SELECT actor_role, details FROM audit_log WHERE booking_ref = ? AND action = 'CANCEL'").get(ref) as {
      actor_role: string;
      details: string;
    };
    assert.equal(audit.actor_role, "admin");
    assert.match(audit.details, /stylist unwell/);
    const email = await import("node:fs").then((fs) => fs.readFileSync(join(ts.outboxDir, `${ref}-cancellation.txt`), "utf8"));
    assert.match(email, /admin/i);
    assert.match(email, /stylist unwell/);
  });
});

test("CSV export covers exactly the next 7 days with local times and fixed columns (criterion 19)", async () => {
  await withServer(async (ts, db, admin) => {
    const customer = await newCustomer(ts, "csv@example.com");
    const customerId = customerBookingId(db, "csv@example.com");
    // In window: Thursday 10:00 (local 2026-11-05 10:00 = 16:00Z).
    createBooking(db, { customerId, serviceId: "haircut", stylistId: 1, date: THU, startMinute: 10 * 60 });
    // In window: Friday 13:15 (15-min boundary check).
    createBooking(db, { customerId, serviceId: "beard", stylistId: 2, date: FRI, startMinute: 13 * 60 + 15 });
    // Out of window: 8 days ahead.
    const eightDays = DateTime.fromISO("2026-11-04", { zone: SALON_TZ }).plus({ days: 8 }).toISODate() ?? "";
    createBooking(db, { customerId, serviceId: "haircut", stylistId: 1, date: eightDays, startMinute: 10 * 60 });

    const res = await admin.request("/admin/bookings/export.csv");
    assert.equal(res.status, 200);
    assert.match(res.contentType, /text\/csv/);
    const lines = res.text.trimEnd().split("\r\n");
    assert.equal(lines[0], "ref,start,end,service,stylist,customer_email,status");
    assert.equal(lines.length, 3, "header plus exactly the two in-window bookings");
    assert.match(lines[1] ?? "", /^CW-[2-9A-HJ-NP-Z]{6},2026-11-05 10:00,2026-11-05 10:30,Haircut,Ana,csv@example\.com,CONFIRMED$/);
    assert.match(lines[2] ?? "", /^CW-[2-9A-HJ-NP-Z]{6},2026-11-06 13:15,2026-11-06 13:30,Beard trim,Ben,csv@example\.com,CONFIRMED$/);
    assert.ok(!res.text.includes("2026-11-12"), "the booking 8 days out is not in the export");
  });
});

test("admin audit view shows entries with who, when, before and after (criterion 20)", async () => {
  await withServer(async (_ts, db, admin) => {
    const created = createBooking(db, { customerId: 1, serviceId: "haircut", stylistId: 1, date: THU, startMinute: 10 * 60 });
    assert.ok(created.ok);
    const ref = created.ok ? created.booking.ref : "";
    const res = await admin.request("/admin/audit");
    assert.equal(res.status, 200);
    assert.match(res.text, new RegExp(ref));
    assert.match(res.text, /admin@cutwell\.test/);
    assert.match(res.text, /CREATE/);
    assert.match(
      res.text,
      /&quot;status&quot;: &quot;CONFIRMED&quot;/,
      "after snapshot is rendered readably (HTML-escaped JSON)",
    );
  });
});

function customerBookingId(db: DatabaseSync, email: string): number {
  const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;
  if (row) return row.id;
  throw new Error(`customer ${email} not registered`);
}
