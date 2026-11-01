import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { startTestServer, Client, DEFAULT_NOW, type TestServer } from "./helpers/http.ts";
import { registerCustomer, signIn, SEED } from "./helpers/auth.ts";

const THU = "2026-11-05";

async function withServer(fn: (ts: TestServer, db: DatabaseSync) => void | Promise<void>) {
  const ts = await startTestServer();
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
  assert.equal(res.status, 303);
  return client;
}

async function bookHaircut(client: Client, date: string, start: string): Promise<string> {
  const res = await client.request("/book", { form: { service: "haircut", stylist: "1", date, start } });
  assert.equal(res.status, 303);
  return ((res.location ?? "").split("?")[0] ?? "").split("/").pop() ?? "";
}

test("a customer cannot view, cancel or reschedule another customer's booking (criterion 12)", async () => {
  await withServer(async (ts, db) => {
    const owner = await newCustomer(ts, "owner@example.com");
    const attacker = await newCustomer(ts, "attacker@example.com");
    const ref = await bookHaircut(owner, THU, "10:00");

    const view = await attacker.request(`/bookings/${ref}`);
    assert.equal(view.status, 404, "viewing someone else's booking reads as not found");
    const cancelPage = await attacker.request(`/bookings/${ref}/cancel`);
    assert.equal(cancelPage.status, 404);
    const cancelPost = await attacker.request(`/bookings/${ref}/cancel`, { method: "POST", form: {} });
    assert.equal(cancelPost.status, 404);
    const rescheduleGet = await attacker.request(`/bookings/${ref}/reschedule?date=2026-11-06`);
    assert.equal(rescheduleGet.status, 404);
    const reschedulePost = await attacker.request(`/bookings/${ref}/reschedule`, {
      method: "POST",
      form: { date: "2026-11-06", start: "11:00" },
    });
    assert.equal(reschedulePost.status, 404);

    const row = db.prepare("SELECT status, start_utc FROM bookings WHERE ref = ?").get(ref) as {
      status: string;
      start_utc: string;
    };
    assert.equal(row.status, "CONFIRMED", "the booking is untouched");
    assert.equal(row.start_utc, "2026-11-05T16:00:00.000Z", "the booking time is unchanged");
  });
});

test("a nonexistent booking reference reads as not found, not as an error page", async () => {
  await withServer(async (ts) => {
    const client = await newCustomer(ts, "ghost@example.com");
    const res = await client.request("/bookings/CW-ZZZZZZ");
    assert.equal(res.status, 404);
  });
});

test("an admin can view a customer's booking (admin sees everything)", async () => {
  await withServer(async (ts) => {
    const owner = await newCustomer(ts, "adminview@example.com");
    const ref = await bookHaircut(owner, THU, "10:00");
    const admin = new Client(ts.port);
    await signIn(admin, SEED.adminEmail, SEED.adminPassword);
    const res = await admin.request(`/bookings/${ref}`);
    assert.equal(res.status, 200);
    assert.match(res.text, new RegExp(ref));
  });
});

test("reschedule writes an audit row with who, when, before and after (criterion 20)", async () => {
  await withServer(async (ts, db) => {
    const owner = await newCustomer(ts, "audit-resched@example.com");
    const ref = await bookHaircut(owner, THU, "10:00");
    const moved = await owner.request(`/bookings/${ref}/reschedule`, {
      method: "POST",
      form: { date: "2026-11-06", start: "11:00" },
    });
    assert.equal(moved.status, 303);
    const row = db.prepare("SELECT * FROM audit_log WHERE booking_ref = ? AND action = 'RESCHEDULE'").get(ref) as {
      actor_email: string;
      at_utc: string;
      before_json: string;
      after_json: string;
    } | undefined;
    assert.ok(row, "RESCHEDULE audit row exists");
    assert.equal(row.actor_email, "audit-resched@example.com", "who");
    const before = JSON.parse(row.before_json) as { start_utc: string; ref: string };
    const after = JSON.parse(row.after_json) as { start_utc: string; ref: string };
    assert.equal(before.start_utc, "2026-11-05T16:00:00.000Z");
    assert.equal(after.start_utc, "2026-11-06T17:00:00.000Z");
    assert.equal(before.ref, after.ref, "same reference before and after");
  });
});

test("cancellation writes an audit row with before and after status", async () => {
  await withServer(async (ts, db) => {
    const owner = await newCustomer(ts, "audit-cancel@example.com");
    const ref = await bookHaircut(owner, THU, "10:00");
    const cancelled = await owner.request(`/bookings/${ref}/cancel`, { method: "POST", form: {} });
    assert.equal(cancelled.status, 303);
    const row = db
      .prepare("SELECT * FROM audit_log WHERE booking_ref = ? AND action = 'CANCEL'")
      .get(ref) as { actor_email: string; before_json: string; after_json: string; details: string } | undefined;
    assert.ok(row, "CANCEL audit row exists");
    const before = JSON.parse(row.before_json) as { status: string };
    const after = JSON.parse(row.after_json) as { status: string };
    assert.equal(before.status, "CONFIRMED");
    assert.equal(after.status, "CANCELLED");
    assert.match(row.details, /customer/);
  });
});

test("the fixed clock is used end to end (DEFAULT_NOW drives booking windows)", async () => {
  const ts = await startTestServer(DEFAULT_NOW);
  try {
    const client = await newCustomer(ts, "clock@example.com");
    // 07:45 on the same salon day is 1h45m ahead -> refused, proving the clock override works.
    const res = await client.request("/book", {
      form: { service: "haircut", stylist: "1", date: "2026-11-04", start: "07:45" },
    });
    assert.equal(res.status, 409);
    assert.match(res.text, /at least 2 hours/);
  } finally {
    ts.close();
  }
});
