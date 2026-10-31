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

test("GET /api/tasks starts empty", async () => {
  const res = await fetch(base + "/api/tasks");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test("POST creates a task", async () => {
  const res = await post({ title: "milk" });
  assert.equal(res.status, 201);
  const t = await res.json();
  assert.equal(t.title, "milk");
  assert.equal(t.done, false);
});

test("POST without a title is rejected", async () => {
  assert.equal((await post({})).status, 400);
});

test("GET one task", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await fetch(`${base}/api/tasks/${t.id}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, "milk");
});

test("GET a missing task is 404", async () => {
  assert.equal((await fetch(base + "/api/tasks/42")).status, 404);
});

test("PATCH marks a task done", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await fetch(`${base}/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  assert.equal((await res.json()).done, true);
});

test("DELETE removes a task", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal((await fetch(`${base}/api/tasks/${t.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${base}/api/tasks/${t.id}`)).status, 404);
});
