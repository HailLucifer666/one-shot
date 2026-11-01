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
const get = (query) => fetch(base + "/api/tasks" + query);
const titles = (res) => res.map((t) => t.title);

// All dates come from one timestamp so the suite cannot straddle UTC midnight.
const now = Date.now();
const day = (offset) => new Date(now + offset * 86400000).toISOString().slice(0, 10);
const yesterday = day(-1);
const today = day(0);
const tomorrow = day(1);

async function seed() {
  // One open task overdue, one open due today, one open due tomorrow,
  // one open with no due date, one DONE task overdue.
  await post({ title: "overdue-open", due: yesterday });
  await post({ title: "due-today", due: today });
  await post({ title: "due-tomorrow", due: tomorrow });
  await post({ title: "no-due" });
  const doneTask = await (await post({ title: "done-overdue", due: yesterday })).json();
  await fetch(`${base}/api/tasks/${doneTask.id}`, {
    method: "PATCH",
    body: JSON.stringify({ done: true }),
  });
}

test("no query parameters returns all tasks, unchanged", async () => {
  await seed();
  const res = await get("");
  assert.equal(res.status, 200);
  assert.equal(titles(await res.json()).length, 5);
});

test("status=open returns only tasks with done=false", async () => {
  await seed();
  const res = await get("?status=open");
  assert.equal(res.status, 200);
  assert.deepEqual(titles(await res.json()).sort(), ["due-today", "due-tomorrow", "no-due", "overdue-open"]);
});

test("status=done returns only tasks with done=true", async () => {
  await seed();
  const res = await get("?status=done");
  assert.equal(res.status, 200);
  assert.deepEqual(titles(await res.json()), ["done-overdue"]);
});

test("any other status value returns 400", async () => {
  for (const s of ["OPEN", "closed", "bogus", ""]) {
    const res = await get(`?status=${encodeURIComponent(s)}`);
    assert.equal(res.status, 400, `status=${JSON.stringify(s)}`);
    assert.ok((await res.json()).error);
  }
});

test("any query parameter other than status and overdue returns 400", async () => {
  assert.equal((await get("?foo=1")).status, 400);
  assert.equal((await get("?status=open&foo=1")).status, 400);
  assert.equal((await get("?overdue=true&bar=x")).status, 400);
});

test("overdue=true returns only open tasks due before today UTC", async () => {
  await seed();
  const res = await get("?overdue=true");
  assert.equal(res.status, 200);
  assert.deepEqual(titles(await res.json()), ["overdue-open"]);
});

test("overdue combined with status", async () => {
  await seed();
  const open = await (await get("?status=open&overdue=true")).json();
  assert.deepEqual(titles(open), ["overdue-open"]);
  const done = await (await get("?status=done&overdue=true")).json();
  assert.deepEqual(done, [], "a done task is never overdue");
});

test("any overdue value other than true returns 400", async () => {
  for (const v of ["false", "TRUE", "1", "yes", ""]) {
    const res = await get(`?overdue=${encodeURIComponent(v)}`);
    assert.equal(res.status, 400, `overdue=${JSON.stringify(v)}`);
  }
});

test("filtered results keep the full task shape including due", async () => {
  await seed();
  const res = await get("?overdue=true");
  const tasks = await res.json();
  assert.deepEqual(Object.keys(tasks[0]).sort(), ["done", "due", "id", "title"]);
  assert.equal(tasks[0].due, yesterday);
});
