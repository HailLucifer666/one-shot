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
const patch = (id, body) =>
  fetch(`${base}/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });

test("POST stores due and every response includes the field", async () => {
  const res = await post({ title: "taxes", due: "2030-01-31" });
  assert.equal(res.status, 201);
  const t = await res.json();
  assert.equal(t.due, "2030-01-31");

  const one = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(one.due, "2030-01-31");

  const list = await (await fetch(base + "/api/tasks")).json();
  assert.ok(list.every((x) => "due" in x), "list items must include due");
});

test("POST without due returns due null everywhere", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal(t.due, null);
  const one = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(one.due, null);
  const list = await (await fetch(base + "/api/tasks")).json();
  assert.deepEqual(list.map((x) => x.due), [null]);
});

test("POST rejects malformed due values", async () => {
  const bad = ["2030/01/31", "2030-1-31", "31-01-2030", "not-a-date", "", "2030-13-01", "2030-00-10", "2030-01-00", 42, true];
  for (const due of bad) {
    const res = await post({ title: "x", due });
    assert.equal(res.status, 400, `expected 400 for due=${JSON.stringify(due)}`);
    assert.ok((await res.json()).error);
  }
});

test("POST rejects dates that do not exist", async () => {
  for (const due of ["2030-02-30", "2026-02-29", "2031-04-31"]) {
    const res = await post({ title: "x", due });
    assert.equal(res.status, 400, `expected 400 for due=${due}`);
  }
});

test("POST accepts real dates including a leap day", async () => {
  assert.equal((await post({ title: "a", due: "2028-02-29" })).status, 201);
  assert.equal((await post({ title: "b", due: null })).status, 201);
});

test("PATCH sets due and PATCH with null clears it", async () => {
  const t = await (await post({ title: "x" })).json();
  const set = await (await patch(t.id, { due: "2030-06-15" })).json();
  assert.equal(set.due, "2030-06-15");
  const cleared = await (await patch(t.id, { due: null })).json();
  assert.equal(cleared.due, null);
});

test("PATCH rejects invalid due and leaves the task unchanged", async () => {
  const t = await (await post({ title: "x", due: "2030-01-01" })).json();
  assert.equal((await patch(t.id, { due: "2030-02-30" })).status, 400);
  assert.equal((await patch(t.id, { due: "junk" })).status, 400);
  const after = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(after.due, "2030-01-01");
});
