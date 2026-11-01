// C2: ?status=open|done filter, unknown params/values rejected.
// C3: ?overdue=true filter (open tasks due before today, UTC), combinable with status.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.js";
import * as store from "../store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(here, "..", "data", "tmp-test-filters");

let server;
let base;

test.before(async () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  store.setDataFile(path.join(tmpDir, "tasks.json"));
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
test.beforeEach(() => store.reset());

const post = (body) => fetch(base + "/api/tasks", { method: "POST", body: JSON.stringify(body) });
const make = async (extra = {}) => (await post({ title: `task-${Math.random()}`, ...extra })).json();
const ids = (arr) => new Set(arr.map((t) => t.id));
const listIds = async (qs = "") => ids(await (await fetch(`${base}/api/tasks${qs}`)).json());

test("status=open returns only tasks with done=false", async () => {
  const open = await make();
  const done = await make();
  await fetch(`${base}/api/tasks/${done.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  const got = await listIds("?status=open");
  assert.ok(got.has(open.id));
  assert.ok(!got.has(done.id));
});

test("status=done returns only tasks with done=true", async () => {
  const open = await make();
  const done = await make();
  await fetch(`${base}/api/tasks/${done.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  const got = await listIds("?status=done");
  assert.ok(got.has(done.id));
  assert.ok(!got.has(open.id));
});

test("no status parameter returns all tasks", async () => {
  const open = await make();
  const done = await make();
  await fetch(`${base}/api/tasks/${done.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  const got = await listIds();
  assert.ok(got.has(open.id) && got.has(done.id));
});

test("an unknown status value is 400", async () => {
  assert.equal((await fetch(`${base}/api/tasks?status=bogus`)).status, 400);
  assert.equal((await fetch(`${base}/api/tasks?status=`)).status, 400);
});

test("a query parameter other than status or overdue is 400", async () => {
  assert.equal((await fetch(`${base}/api/tasks?foo=bar`)).status, 400);
  assert.equal((await fetch(`${base}/api/tasks?status=open&foo=1`)).status, 400);
  assert.equal((await fetch(`${base}/api/tasks?overdue=true&sort=id`)).status, 400);
});

test("overdue=true returns only open tasks whose due is before today (UTC)", async () => {
  const overdueOpen = await make({ due: "2000-01-01" });
  const overdueDone = await make({ due: "2000-01-01" });
  await fetch(`${base}/api/tasks/${overdueDone.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  const future = await make({ due: "2999-12-31" });
  const noDue = await make();
  const got = await listIds("?overdue=true");
  assert.ok(got.has(overdueOpen.id));
  assert.ok(!got.has(overdueDone.id), "done tasks are never overdue");
  assert.ok(!got.has(future.id), "future due dates are not overdue");
  assert.ok(!got.has(noDue.id), "tasks without a due date are not overdue");
});

test("overdue=true combines with status=open", async () => {
  const overdueOpen = await make({ due: "2000-01-01" });
  const got = await listIds("?overdue=true&status=open");
  assert.ok(got.has(overdueOpen.id));
});

test("overdue=true combines with status=done", async () => {
  const overdueOpen = await make({ due: "2000-01-01" });
  const got = await listIds("?overdue=true&status=done");
  assert.ok(!got.has(overdueOpen.id), "an open task must not appear under status=done");
});

test("a task due today is not overdue", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const dueToday = await make({ due: today });
  const got = await listIds("?overdue=true");
  assert.ok(!got.has(dueToday.id));
});

test("overdue values other than true are 400", async () => {
  assert.equal((await fetch(`${base}/api/tasks?overdue=false`)).status, 400);
  assert.equal((await fetch(`${base}/api/tasks?overdue=yes`)).status, 400);
  assert.equal((await fetch(`${base}/api/tasks?overdue=`)).status, 400);
});

test("filtered lists are still plain arrays of task objects with due", async () => {
  await make({ due: "2000-01-01" });
  const tasks = await (await fetch(`${base}/api/tasks?status=open`)).json();
  assert.ok(Array.isArray(tasks));
  for (const t of tasks) assert.ok("due" in t);
});
