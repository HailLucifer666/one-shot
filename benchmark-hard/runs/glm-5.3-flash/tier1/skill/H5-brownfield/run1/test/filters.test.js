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
// UTC calendar day offset from now, same rule the API uses
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test("no query returns all tasks unchanged", async () => {
  await post({ title: "a" });
  const t = await (await post({ title: "b" })).json();
  await fetch(`${base}/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  const all = await (await fetch(base + "/api/tasks")).json();
  assert.deepEqual(all.map((x) => x.title).sort(), ["a", "b"]);
});

test("status=open returns only tasks that are not done", async () => {
  await post({ title: "open1" });
  const t = await (await post({ title: "done1" })).json();
  await fetch(`${base}/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  const res = await fetch(base + "/api/tasks?status=open");
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).map((x) => x.title), ["open1"]);
});

test("status=done returns only tasks that are done", async () => {
  await post({ title: "open1" });
  const t = await (await post({ title: "done1" })).json();
  await fetch(`${base}/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  const res = await fetch(base + "/api/tasks?status=done");
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).map((x) => x.title), ["done1"]);
});

test("any status value other than open or done is rejected", async () => {
  for (const v of ["OPEN", "all", "", "2", "open "]) {
    const res = await fetch(`${base}/api/tasks?status=${encodeURIComponent(v)}`);
    assert.equal(res.status, 400, `expected 400 for status=${JSON.stringify(v)}`);
    assert.ok((await res.json()).error);
  }
});

test("any query parameter other than status and overdue is rejected", async () => {
  assert.equal((await fetch(base + "/api/tasks?foo=bar")).status, 400);
  assert.equal((await fetch(base + "/api/tasks?status=open&foo=bar")).status, 400);
});

test("overdue=true returns only open tasks due before today UTC", async () => {
  await post({ title: "past", due: day(-2) });
  await post({ title: "today", due: day(0) }); // due today is not overdue
  await post({ title: "future", due: day(2) });
  await post({ title: "nodue" });
  const done = await (await post({ title: "finished", due: day(-2) })).json();
  await fetch(`${base}/api/tasks/${done.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  const res = await fetch(base + "/api/tasks?overdue=true");
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).map((x) => x.title), ["past"]);
});

test("overdue=true combines with status", async () => {
  await post({ title: "past", due: day(-2) });
  const done = await (await post({ title: "finished", due: day(-2) })).json();
  await fetch(`${base}/api/tasks/${done.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  const open = await (await fetch(base + "/api/tasks?status=open&overdue=true")).json();
  assert.deepEqual(open.map((x) => x.title), ["past"]);
  const doneList = await (await fetch(base + "/api/tasks?status=done&overdue=true")).json();
  assert.deepEqual(doneList, []);
});

test("any overdue value other than true is rejected", async () => {
  for (const v of ["false", "TRUE", "1", ""]) {
    const res = await fetch(`${base}/api/tasks?overdue=${encodeURIComponent(v)}`);
    assert.equal(res.status, 400, `expected 400 for overdue=${JSON.stringify(v)}`);
    assert.ok((await res.json()).error);
  }
});
