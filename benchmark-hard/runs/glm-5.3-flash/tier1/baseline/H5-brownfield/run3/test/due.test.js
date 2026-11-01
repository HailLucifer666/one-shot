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
const patch = (id, body) => fetch(`${base}/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });

test("POST accepts a valid due date", async () => {
  const res = await post({ title: "milk", due: "2030-06-15" });
  assert.equal(res.status, 201);
  const t = await res.json();
  assert.equal(t.due, "2030-06-15");
});

test("POST defaults due to null", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal(t.due, null);
});

test("POST rejects a badly formatted due value", async () => {
  for (const due of ["2030-6-15", "15-06-2030", "2030/06/15", "garbage", "", 123, false]) {
    const res = await post({ title: "milk", due });
    assert.equal(res.status, 400, `expected 400 for due=${JSON.stringify(due)}`);
    const body = await res.json();
    assert.ok(body.error, `expected an error body for due=${JSON.stringify(due)}`);
  }
});

test("POST rejects a date that does not exist", async () => {
  for (const due of ["2030-02-30", "2026-13-01", "2026-00-10", "2026-04-31"]) {
    const res = await post({ title: "milk", due });
    assert.equal(res.status, 400, `expected 400 for due=${due}`);
  }
});

test("every task response includes due", async () => {
  const t = await (await post({ title: "milk", due: "2030-06-15" })).json();
  const one = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(one.due, "2030-06-15");
  const all = await (await fetch(base + "/api/tasks")).json();
  assert.deepEqual(all.map((x) => x.due), ["2030-06-15"]);
});

test("PATCH sets due and PATCH with null clears it", async () => {
  const t = await (await post({ title: "milk" })).json();
  const set = await (await patch(t.id, { due: "2030-06-15" })).json();
  assert.equal(set.due, "2030-06-15");
  const cleared = await (await patch(t.id, { due: null })).json();
  assert.equal(cleared.due, null);
});

test("PATCH rejects an invalid due value and leaves the task unchanged", async () => {
  const t = await (await post({ title: "milk", due: "2030-06-15" })).json();
  for (const due of ["2030-02-30", "soon", 42]) {
    const res = await patch(t.id, { due });
    assert.equal(res.status, 400, `expected 400 for due=${JSON.stringify(due)}`);
  }
  const after = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(after.due, "2030-06-15", "task must be unchanged after a rejected patch");
});

test("a rejected POST with an invalid due creates nothing", async () => {
  await post({ title: "milk", due: "2030-02-30" });
  assert.deepEqual(await (await fetch(base + "/api/tasks")).json(), []);
});
