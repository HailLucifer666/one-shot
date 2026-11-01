// C1: optional due date on tasks (YYYY-MM-DD string or null), validated on POST and PATCH.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.js";
import * as store from "../store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(here, "..", "data", "tmp-test-due");

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
const patch = (id, body) => fetch(`${base}/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
const getOne = async (id) => (await fetch(`${base}/api/tasks/${id}`)).json();

test("POST with a valid due stores it", async () => {
  const res = await post({ title: "milk", due: "2030-05-01" });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).due, "2030-05-01");
});

test("POST with an explicit due null stores null", async () => {
  const t = await (await post({ title: "milk", due: null })).json();
  assert.equal(t.due, null);
});

test("a task created without due has due null, also when fetched", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal(t.due, null);
  assert.equal((await getOne(t.id)).due, null);
});

test("POST rejects due values that are not YYYY-MM-DD strings", async () => {
  for (const due of ["not-a-date", "2030-5-1", "05/01/2030", "2030-05-01T00:00:00Z", "", 20300501, true]) {
    const res = await post({ title: "milk", due });
    assert.equal(res.status, 400, `due=${JSON.stringify(due)} should be 400`);
    assert.ok("error" in (await res.json()));
  }
});

test("POST rejects dates that do not exist, like 2030-02-30", async () => {
  assert.equal((await post({ title: "milk", due: "2030-02-30" })).status, 400);
});

test("POST rejects impossible calendar dates like month 13 and non-leap Feb 29", async () => {
  assert.equal((await post({ title: "milk", due: "2030-13-01" })).status, 400);
  assert.equal((await post({ title: "milk", due: "2030-02-29" })).status, 400);
});

test("POST still accepts valid leap-day dates", async () => {
  const res = await post({ title: "milk", due: "2032-02-29" });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).due, "2032-02-29");
});

test("a rejected POST due does not create a task", async () => {
  await post({ title: "milk", due: "2030-02-30" });
  assert.equal(store.list().length, 0);
});

test("PATCH sets due", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await patch(t.id, { due: "2031-01-15" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).due, "2031-01-15");
  assert.equal((await getOne(t.id)).due, "2031-01-15");
});

test("PATCH with due null clears the due date", async () => {
  const t = await (await post({ title: "milk", due: "2031-01-15" })).json();
  const res = await patch(t.id, { due: null });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).due, null);
  assert.equal((await getOne(t.id)).due, null);
});

test("PATCH with an invalid due is 400 and leaves the task unchanged", async () => {
  const t = await (await post({ title: "milk", due: "2031-01-15" })).json();
  for (const due of ["2031-02-31", "soon", 20310115]) {
    assert.equal((await patch(t.id, { due })).status, 400, `due=${JSON.stringify(due)} should be 400`);
  }
  assert.equal((await getOne(t.id)).due, "2031-01-15");
});

test("every task in the list includes a due field", async () => {
  await post({ title: "a", due: "2030-05-01" });
  await post({ title: "b" });
  const tasks = await (await fetch(base + "/api/tasks")).json();
  assert.equal(tasks.length, 2);
  for (const t of tasks) assert.ok("due" in t, `task ${t.id} should have a due key`);
});

test("store.add stores due and defaults it to null", () => {
  assert.equal(store.add("plain").due, null);
  assert.equal(store.add("dated", "2030-01-01").due, "2030-01-01");
});

test("store.isValidDue accepts real dates and rejects impossible ones", () => {
  assert.equal(store.isValidDue(null), true);
  assert.equal(store.isValidDue("2030-05-01"), true);
  assert.equal(store.isValidDue("2032-02-29"), true);
  assert.equal(store.isValidDue("2030-02-30"), false);
  assert.equal(store.isValidDue("2030-13-01"), false);
  assert.equal(store.isValidDue("2030-5-1"), false);
  assert.equal(store.isValidDue("20300501"), false);
  assert.equal(store.isValidDue(20300501), false);
  assert.equal(store.isValidDue(undefined), false);
});
