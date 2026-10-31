import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import * as store from "../store.js";

let server;
let base;

test.before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());
test.beforeEach(() => store.reset());

const post = (body) => fetch(base + "/api/tasks", { method: "POST", body: JSON.stringify(body) });

test("POST with a valid due date stores it", async () => {
  const res = await post({ title: "milk", due: "2030-01-31" });
  assert.equal(res.status, 201);
  const t = await res.json();
  assert.equal(t.due, "2030-01-31");
});

test("POST without due leaves it null, and every listed task includes due", async () => {
  await post({ title: "milk" });
  await post({ title: "eggs", due: null });
  const listed = await (await fetch(base + "/api/tasks")).json();
  assert.equal(listed.length, 2);
  for (const t of listed) {
    assert.ok("due" in t);
    assert.equal(t.due, null);
  }
});

test("GET one task includes due", async () => {
  const t = await (await post({ title: "milk", due: "2030-01-01" })).json();
  const one = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(one.due, "2030-01-01");
});

test("POST rejects dates that do not exist", async () => {
  assert.equal((await post({ title: "x", due: "2030-02-30" })).status, 400);
  assert.equal((await post({ title: "x", due: "2027-02-29" })).status, 400); // not a leap year
  assert.equal((await post({ title: "x", due: "2030-04-31" })).status, 400);
});

test("POST rejects malformed due values with an error body", async () => {
  for (const due of ["2030-13-01", "2030-00-10", "2030-1-3", "01-31-2030", "not-a-date", "", 123, true]) {
    const res = await post({ title: "x", due });
    assert.equal(res.status, 400, `due=${JSON.stringify(due)}`);
    assert.ok((await res.json()).error);
  }
});

test("PATCH sets due", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await fetch(`${base}/api/tasks/${t.id}`, {
    method: "PATCH",
    body: JSON.stringify({ due: "2030-06-15" }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).due, "2030-06-15");
});

test('PATCH with "due": null clears it', async () => {
  const t = await (await post({ title: "milk", due: "2030-06-15" })).json();
  const res = await fetch(`${base}/api/tasks/${t.id}`, {
    method: "PATCH",
    body: JSON.stringify({ due: null }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).due, null);
});

test("PATCH with an invalid due value is 400", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await fetch(`${base}/api/tasks/${t.id}`, {
    method: "PATCH",
    body: JSON.stringify({ due: "2030-02-30" }),
  });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
  assert.equal((await (await fetch(`${base}/api/tasks/${t.id}`)).json()).due, null);
});

test("store.parseDue validates format and calendar existence", () => {
  assert.deepEqual(store.parseDue("2030-01-31"), { ok: true, due: "2030-01-31" });
  assert.deepEqual(store.parseDue(null), { ok: true, due: null });
  assert.equal(store.parseDue("2030-02-30").ok, false);
  assert.equal(store.parseDue("2030-1-3").ok, false);
  assert.equal(store.parseDue("junk").ok, false);
  assert.equal(store.parseDue(5).ok, false);
  assert.equal(store.parseDue(undefined).ok, false);
});

test("store.isOverdue means not done and due before today (UTC)", () => {
  const past = "2000-01-01";
  const future = "2999-01-01";
  assert.equal(store.isOverdue({ done: false, due: past }), true);
  assert.equal(store.isOverdue({ done: true, due: past }), false);
  assert.equal(store.isOverdue({ done: false, due: future }), false);
  assert.equal(store.isOverdue({ done: false, due: null }), false);
});
