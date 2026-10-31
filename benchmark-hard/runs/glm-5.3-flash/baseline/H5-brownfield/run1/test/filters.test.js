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

// Deterministic seed: dates are hard-coded so the tests do not depend on the
// machine clock. 2000-* is always past, 2999-* always future.
async function seed() {
  const openFuture = await (await post({ title: "future open", due: "2999-01-01" })).json();
  const openPast = await (await post({ title: "past open", due: "2000-01-01" })).json();
  const donePast = await (await post({ title: "past done", due: "2000-01-02" })).json();
  await patch(donePast.id, { done: true });
  const openNoDue = await (await post({ title: "open no due" })).json();
  return { openFuture, openPast, donePast, openNoDue };
}

test("no filter params returns all tasks unchanged", async () => {
  const { openFuture, openPast, donePast, openNoDue } = await seed();
  const listed = await (await fetch(base + "/api/tasks")).json();
  assert.deepEqual(
    listed.map((t) => t.id).sort((a, b) => a - b),
    [openFuture.id, openPast.id, donePast.id, openNoDue.id].sort((a, b) => a - b)
  );
});

test("status=open returns only tasks with done=false", async () => {
  const { openFuture, openPast, openNoDue } = await seed();
  const listed = await (await fetch(base + "/api/tasks?status=open")).json();
  assert.deepEqual(
    listed.map((t) => t.id).sort((a, b) => a - b),
    [openFuture.id, openPast.id, openNoDue.id].sort((a, b) => a - b)
  );
  for (const t of listed) assert.equal(t.done, false);
});

test("status=done returns only tasks with done=true", async () => {
  const { donePast } = await seed();
  const listed = await (await fetch(base + "/api/tasks?status=done")).json();
  assert.deepEqual(listed.map((t) => t.id), [donePast.id]);
  for (const t of listed) assert.equal(t.done, true);
});

test("any other status value returns 400", async () => {
  for (const status of ["bogus", "OPEN", "all", "true", ""]) {
    const res = await fetch(base + "/api/tasks?status=" + encodeURIComponent(status));
    assert.equal(res.status, 400, `status=${JSON.stringify(status)}`);
    assert.ok((await res.json()).error);
  }
});

test("overdue=true returns only open tasks with a due before today (UTC)", async () => {
  const { openPast, donePast } = await seed();
  const listed = await (await fetch(base + "/api/tasks?overdue=true")).json();
  assert.deepEqual(listed.map((t) => t.id), [openPast.id]);
  assert.equal(listed[0].done, false);
  assert.ok(!listed.some((t) => t.id === donePast.id), "done tasks are never overdue");
});

test("overdue combines with status", async () => {
  const { openPast } = await seed();
  const openOverdue = await (await fetch(base + "/api/tasks?overdue=true&status=open")).json();
  assert.deepEqual(openOverdue.map((t) => t.id), [openPast.id]);

  const doneOverdue = await (await fetch(base + "/api/tasks?overdue=true&status=done")).json();
  assert.deepEqual(doneOverdue, []);
});

test("any overdue value other than true returns 400", async () => {
  for (const overdue of ["false", "1", "TRUE", "yes", ""]) {
    const res = await fetch(base + "/api/tasks?overdue=" + encodeURIComponent(overdue));
    assert.equal(res.status, 400, `overdue=${JSON.stringify(overdue)}`);
    assert.ok((await res.json()).error);
  }
});

test("invalid status is still 400 when combined with overdue=true", async () => {
  const res = await fetch(base + "/api/tasks?overdue=true&status=nope");
  assert.equal(res.status, 400);
});
