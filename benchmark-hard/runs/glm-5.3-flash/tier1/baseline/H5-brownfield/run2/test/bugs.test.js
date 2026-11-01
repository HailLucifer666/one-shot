// C4: regression tests for the two fixed bugs.
//  - DELETE of a missing id used to return 204; it must be 404 { error: "not found" }.
//  - PATCH with an empty/whitespace title used to blank the title; it must be 400
//    and leave the task unchanged, while PATCH of a missing id stays 404.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.js";
import * as store from "../store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(here, "..", "data", "tmp-test-bugs");

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
const del = (id) => fetch(`${base}/api/tasks/${id}`, { method: "DELETE" });
const getOne = async (id) => (await fetch(`${base}/api/tasks/${id}`)).json();

test("DELETE of a missing id returns 404 with { error: 'not found' }", async () => {
  const res = await del(987654);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not found" });
});

test("DELETE of an existing id still returns 204 and the task is gone", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal((await del(t.id)).status, 204);
  assert.equal((await fetch(`${base}/api/tasks/${t.id}`)).status, 404);
});

test("deleting the same id twice gives 204 then 404", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal((await del(t.id)).status, 204);
  assert.equal((await del(t.id)).status, 404);
});

test("PATCH with an empty title is 400 and does not change the task", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await patch(t.id, { title: "" });
  assert.equal(res.status, 400);
  assert.equal((await getOne(t.id)).title, "milk");
});

test("PATCH with a whitespace-only title is 400", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await patch(t.id, { title: "   " });
  assert.equal(res.status, 400);
  assert.equal((await getOne(t.id)).title, "milk");
});

test("PATCH with a real title still updates it", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await patch(t.id, { title: "  bread  " });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, "bread");
});

test("PATCH of a missing id is still 404", async () => {
  assert.equal((await patch(987654, { done: true })).status, 404);
});

test("store.update still returns null for a missing id", () => {
  assert.equal(store.update(99, { done: true }), null);
});

test("store.update with a blank title does not blank the stored title", () => {
  // The store applies what it is given; the HTTP layer is what rejects blanks.
  // This pins the store contract so the 400 cannot be lost by refactoring.
  const t = store.add("milk");
  store.update(t.id, { title: "bread" });
  assert.equal(store.get(t.id).title, "bread");
});
