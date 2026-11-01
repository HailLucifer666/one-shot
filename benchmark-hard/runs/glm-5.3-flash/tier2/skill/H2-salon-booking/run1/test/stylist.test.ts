import test from "node:test";
import assert from "node:assert/strict";
import { startTestServer, Client, type TestServer } from "./helpers/http.ts";
import { registerCustomer, signIn, SEED } from "./helpers/auth.ts";

const THU = "2026-11-05";

async function withServer(fn: (ts: TestServer) => Promise<void>) {
  const ts = await startTestServer();
  try {
    await fn(ts);
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

async function book(client: Client, service: string, stylist: string, date: string, start: string): Promise<string> {
  const res = await client.request("/book", { form: { service, stylist, date, start } });
  assert.equal(res.status, 303);
  return ((res.location ?? "").split("?")[0] ?? "").split("/").pop() ?? "";
}

test("a stylist sees only their own upcoming schedule, read-only (criterion 13)", async () => {
  await withServer(async (ts) => {
    const c1 = await newCustomer(ts, "sched-a@example.com");
    const c2 = await newCustomer(ts, "sched-b@example.com");
    const anaBooking = await book(c1, "haircut", "1", THU, "10:00");
    const benBooking = await book(c2, "haircut", "2", THU, "11:00");

    const ana = new Client(ts.port);
    const anaLogin = await signIn(ana, "ana@cutwell.test", SEED.stylistPassword);
    assert.equal(anaLogin.status, 303);
    const page = await ana.request("/stylist");
    assert.equal(page.status, 200);
    assert.match(page.text, /My schedule/);
    assert.match(page.text, new RegExp(anaBooking), "Ana sees her own booking");
    assert.doesNotMatch(page.text, new RegExp(benBooking), "Ana does not see Ben's booking");

    const ben = new Client(ts.port);
    await signIn(ben, "ben@cutwell.test", SEED.stylistPassword);
    const benPage = await ben.request("/stylist");
    assert.doesNotMatch(benPage.text, new RegExp(anaBooking), "Ben does not see Ana's booking");
  });
});

test("a stylist cannot change bookings: no cancel or reschedule route accepts a stylist", async () => {
  await withServer(async (ts) => {
    const customer = await newCustomer(ts, "stylist-try@example.com");
    const ref = await book(customer, "haircut", "1", THU, "10:00");

    const ana = new Client(ts.port);
    await signIn(ana, "ana@cutwell.test", SEED.stylistPassword);
    const cancel = await ana.request(`/bookings/${ref}/cancel`, { method: "POST", form: {} });
    assert.equal(cancel.status, 403, "cancel refuses the stylist role");
    const reschedule = await ana.request(`/bookings/${ref}/reschedule`, {
      method: "POST",
      form: { date: "2026-11-06", start: "11:00" },
    });
    assert.equal(reschedule.status, 403, "reschedule refuses the stylist role");
    const bookAttempt = await ana.request("/book", { form: { service: "haircut", stylist: "1", date: THU, start: "12:00" } });
    assert.equal(bookAttempt.status, 403, "stylists do not create bookings");
  });
});

test("a customer cannot open the stylist schedule page", async () => {
  await withServer(async (ts) => {
    const customer = await newCustomer(ts, "not-stylist@example.com");
    const res = await customer.request("/stylist");
    assert.equal(res.status, 403);
  });
});

test("an anonymous visitor is redirected from the stylist page", async () => {
  await withServer(async (ts) => {
    const res = await fetch(`http://127.0.0.1:${ts.port}/stylist`, { redirect: "manual" });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/login");
  });
});

test("an empty stylist schedule shows an empty state", async () => {
  await withServer(async (ts) => {
    const cleo = new Client(ts.port);
    await signIn(cleo, "cleo@cutwell.test", SEED.stylistPassword);
    const page = await cleo.request("/stylist");
    assert.match(page.text, /No upcoming appointments/);
  });
});
