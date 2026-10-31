// Hidden acceptance tests for H5. Run via tools/run_h5.mjs (needs H5_BASE).
import test from "node:test";
import assert from "node:assert/strict";

const base = process.env.H5_BASE;
const tag = Math.random().toString(36).slice(2, 8);
let n = 0;
const title = () => `h5-${tag}-${++n}`;

const post = (body) => fetch(base + "/api/tasks", { method: "POST", body: JSON.stringify(body) });
const patch = (id, body) => fetch(`${base}/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
const del = (id) => fetch(`${base}/api/tasks/${id}`, { method: "DELETE" });
const list = async (qs = "") => (await fetch(`${base}/api/tasks${qs}`)).json();
const make = async (extra = {}) => (await post({ title: title(), ...extra })).json();
const ids = (arr) => new Set(arr.map((t) => t.id));

test("C1: POST with a valid due stores it", async () => {
  const res = await post({ title: title(), due: "2030-05-01" });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).due, "2030-05-01");
});

test("C1: a task without due has due null", async () => {
  const t = await make();
  assert.equal(t.due, null);
  const got = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(got.due, null);
});

test("C1: invalid due formats are rejected", async () => {
  for (const due of ["not-a-date", "2030-5-1", "2030-02-30", "2030-13-01", "05/01/2030", 20300501]) {
    const res = await post({ title: title(), due });
    assert.equal(res.status, 400, `due=${JSON.stringify(due)} should be 400`);
  }
});

test("C1: PATCH sets and clears due", async () => {
  const t = await make();
  const set = await (await patch(t.id, { due: "2031-01-15" })).json();
  assert.equal(set.due, "2031-01-15");
  const cleared = await (await patch(t.id, { due: null })).json();
  assert.equal(cleared.due, null);
  assert.equal((await patch(t.id, { due: "2031-02-31" })).status, 400);
});

test("C1: list includes due on every task", async () => {
  await make({ due: "2030-05-01" });
  await make();
  for (const t of await list()) assert.ok("due" in t, "every task has due");
});

test("C2: status=open and status=done filter correctly", async () => {
  const open = await make();
  const done = await make();
  await patch(done.id, { done: true });
  const o = ids(await list("?status=open"));
  const d = ids(await list("?status=done"));
  assert.ok(o.has(open.id) && !o.has(done.id));
  assert.ok(d.has(done.id) && !d.has(open.id));
});

test("C2: no status returns both", async () => {
  const open = await make();
  const done = await make();
  await patch(done.id, { done: true });
  const all = ids(await list());
  assert.ok(all.has(open.id) && all.has(done.id));
});

test("C2: an unknown status is 400", async () => {
  assert.equal((await fetch(`${base}/api/tasks?status=bogus`)).status, 400);
});

test("C3: overdue=true returns only open tasks due before today", async () => {
  const overdueOpen = await make({ due: "2000-01-01" });
  const overdueDone = await make({ due: "2000-01-01" });
  await patch(overdueDone.id, { done: true });
  const future = await make({ due: "2999-12-31" });
  const noDue = await make();
  const got = ids(await list("?overdue=true"));
  assert.ok(got.has(overdueOpen.id));
  assert.ok(!got.has(overdueDone.id) && !got.has(future.id) && !got.has(noDue.id));
});

test("C3: overdue combines with status", async () => {
  const overdueOpen = await make({ due: "2000-01-01" });
  const openRes = ids(await list("?overdue=true&status=open"));
  const doneRes = ids(await list("?overdue=true&status=done"));
  assert.ok(openRes.has(overdueOpen.id));
  assert.ok(!doneRes.has(overdueOpen.id));
});

test("C3: overdue values other than true are 400", async () => {
  assert.equal((await fetch(`${base}/api/tasks?overdue=false`)).status, 400);
  assert.equal((await fetch(`${base}/api/tasks?overdue=yes`)).status, 400);
});

test("C4: DELETE of a missing id is 404 with an error body", async () => {
  const res = await del(987654);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not found");
});

test("C4: DELETE of an existing id is 204 and then gone", async () => {
  const t = await make();
  assert.equal((await del(t.id)).status, 204);
  assert.equal((await fetch(`${base}/api/tasks/${t.id}`)).status, 404);
  assert.equal((await del(t.id)).status, 404);
});

test("C4: PATCH with an empty or blank title is 400", async () => {
  const t = await make();
  assert.equal((await patch(t.id, { title: "" })).status, 400);
  assert.equal((await patch(t.id, { title: "   " })).status, 400);
  const still = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(still.title, t.title);
});

test("C4: PATCH of a missing id is still 404", async () => {
  assert.equal((await patch(987654, { done: true })).status, 404);
});

test("C6: create, read, toggle and delete keep their old shape", async () => {
  const res = await post({ title: title() });
  assert.equal(res.status, 201);
  const t = await res.json();
  for (const k of ["id", "title", "done"]) assert.ok(k in t, `${k} present`);
  assert.equal(t.done, false);
  assert.equal(typeof t.id, "number");
  assert.equal((await post({})).status, 400);
  assert.equal((await fetch(`${base}/api/tasks/not-a-number`)).status, 400);
  assert.equal((await (await patch(t.id, { done: true })).json()).done, true);
});

test("C6: the list is still a plain array", async () => {
  assert.ok(Array.isArray(await list()));
});
