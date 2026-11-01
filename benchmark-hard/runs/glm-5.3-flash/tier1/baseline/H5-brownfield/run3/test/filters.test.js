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

function utcDay(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// Seeds five tasks whose dates are relative to the real UTC today:
//   1 "past open"   open, due before today  -> overdue
//   2 "today open"  open, due today        -> NOT overdue (overdue is strictly before)
//   3 "future open" open, due after today  -> not overdue
//   4 "no due open" open, no due date      -> not overdue
//   5 "past done"   done, due before today -> done tasks are never overdue
async function seed() {
  const past = utcDay(-2);
  const todayStr = utcDay(0);
  const future = utcDay(3);
  await post({ title: "past open", due: past });
  await post({ title: "today open", due: todayStr });
  await post({ title: "future open", due: future });
  await post({ title: "no due open" });
  const done = await (await post({ title: "past done", due: past })).json();
  await fetch(`${base}/api/tasks/${done.id}`, {
    method: "PATCH",
    body: JSON.stringify({ done: true }),
  });
}

const titlesOf = async (qs) => (await (await fetch(base + "/api/tasks" + qs)).json()).map((t) => t.title);

test("no query parameter returns all tasks", async () => {
  await seed();
  assert.equal((await (await fetch(base + "/api/tasks")).json()).length, 5);
});

test("status=open returns only tasks that are not done", async () => {
  await seed();
  const res = await fetch(base + "/api/tasks?status=open");
  assert.equal(res.status, 200);
  const tasks = await res.json();
  assert.deepEqual(
    tasks.map((t) => t.title).sort(),
    ["future open", "no due open", "past open", "today open"]
  );
  assert.ok(tasks.every((t) => t.done === false));
});

test("status=done returns only tasks that are done", async () => {
  await seed();
  assert.deepEqual(await titlesOf("?status=done"), ["past done"]);
});

test("any other status value is a 400", async () => {
  for (const status of ["OPEN", "Open", "cancelled", "open ", "", "true"]) {
    const res = await fetch(base + "/api/tasks?status=" + encodeURIComponent(status));
    assert.equal(res.status, 400, `expected 400 for status=${JSON.stringify(status)}`);
    assert.ok((await res.json()).error);
  }
});

test("a query parameter other than status or overdue is a 400", async () => {
  for (const qs of ["?foo=1", "?sort=id", "?status=open&foo=1", "?overdue=true&x=y"]) {
    const res = await fetch(base + "/api/tasks" + qs);
    assert.equal(res.status, 400, `expected 400 for ${qs}`);
    assert.ok((await res.json()).error);
  }
});

test("overdue=true returns only open tasks due before today (UTC)", async () => {
  await seed();
  const res = await fetch(base + "/api/tasks?overdue=true");
  assert.equal(res.status, 200);
  const tasks = await res.json();
  assert.deepEqual(tasks.map((t) => t.title), ["past open"]);
  assert.ok(tasks.every((t) => !t.done && t.due !== null));
});

test("overdue=true combines with status", async () => {
  await seed();
  assert.deepEqual(await titlesOf("?overdue=true&status=open"), ["past open"]);
  assert.deepEqual(await titlesOf("?overdue=true&status=done"), []);
  assert.deepEqual(await titlesOf("?status=done&overdue=true"), []);
});

test("any overdue value other than true is a 400", async () => {
  for (const value of ["false", "0", "1", "TRUE", "True", ""]) {
    const res = await fetch(base + "/api/tasks?overdue=" + encodeURIComponent(value));
    assert.equal(res.status, 400, `expected 400 for overdue=${JSON.stringify(value)}`);
    assert.ok((await res.json()).error);
  }
});
