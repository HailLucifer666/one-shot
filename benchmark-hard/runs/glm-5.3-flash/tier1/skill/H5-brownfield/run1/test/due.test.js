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
test.after(() => {
  server.close();
  store.reset();
  store.save(); // leave data/tasks.json empty for whoever runs next
});
test.beforeEach(() => store.reset());

const post = (body) => fetch(base + "/api/tasks", { method: "POST", body: JSON.stringify(body) });
const patch = (id, body) => fetch(`${base}/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });

test("POST stores a valid due date and echoes it back", async () => {
  const res = await post({ title: "milk", due: "2030-01-01" });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).due, "2030-01-01");
});

test("POST without due returns due null", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal(t.due, null);
});

test("POST with explicit due null returns due null", async () => {
  const t = await (await post({ title: "milk", due: null })).json();
  assert.equal(t.due, null);
});

test("POST rejects a wrongly formatted due", async () => {
  for (const due of ["2030-1-1", "01-01-2030", "2030/01/01", "2030-01-01T00:00:00Z"]) {
    const res = await post({ title: "milk", due });
    assert.equal(res.status, 400, `expected 400 for due=${due}`);
    assert.ok((await res.json()).error);
  }
});

test("POST rejects a date that does not exist", async () => {
  const res = await post({ title: "milk", due: "2030-02-30" });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test("POST rejects a non-string due", async () => {
  assert.equal((await post({ title: "milk", due: 42 })).status, 400);
});

test("POST accepts leap day 2028-02-29 but rejects 2026-02-29", async () => {
  assert.equal((await post({ title: "a", due: "2028-02-29" })).status, 201);
  assert.equal((await post({ title: "b", due: "2026-02-29" })).status, 400);
});

test("every task in GET list and GET one includes due", async () => {
  await post({ title: "a", due: "2030-01-01" });
  await post({ title: "b" });
  const all = await (await fetch(base + "/api/tasks")).json();
  assert.equal(all.length, 2);
  for (const t of all) assert.ok("due" in t);
  assert.equal(all[0].due, "2030-01-01");
  assert.equal(all[1].due, null);
  const one = await (await fetch(`${base}/api/tasks/${all[0].id}`)).json();
  assert.equal(one.due, "2030-01-01");
});

test("PATCH sets due and due null clears it", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal((await (await patch(t.id, { due: "2030-01-01" })).json()).due, "2030-01-01");
  assert.equal((await (await patch(t.id, { due: null })).json()).due, null);
});

test("PATCH rejects an invalid due and leaves the old value", async () => {
  const t = await (await post({ title: "milk", due: "2030-01-01" })).json();
  const res = await patch(t.id, { due: "2030-02-30" });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
  assert.equal((await (await fetch(`${base}/api/tasks/${t.id}`)).json()).due, "2030-01-01");
});

test("PATCH without due leaves due unchanged", async () => {
  const t = await (await post({ title: "milk", due: "2030-01-01" })).json();
  const res = await patch(t.id, { done: true });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).due, "2030-01-01");
});
