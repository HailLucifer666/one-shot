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

test("DELETE of a missing id returns 404 with an error body", async () => {
  const res = await fetch(`${base}/api/tasks/999`, { method: "DELETE" });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not found" });
});

test("DELETE of an existing id still returns 204", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal((await fetch(`${base}/api/tasks/${t.id}`, { method: "DELETE" })).status, 204);
});

test("PATCH with an empty title returns 400", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal((await patch(t.id, { title: "" })).status, 400);
});

test("PATCH with a whitespace-only title returns 400", async () => {
  const t = await (await post({ title: "milk" })).json();
  for (const title of ["   ", "\t", "\n "]) {
    assert.equal((await patch(t.id, { title })).status, 400, JSON.stringify(title));
  }
  const after = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(after.title, "milk", "a rejected patch must not change the task");
});

test("PATCH of a missing id still returns 404", async () => {
  assert.equal((await patch(999, { done: true })).status, 404);
});

test("PATCH with a real title still works", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await patch(t.id, { title: "bread" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, "bread");
});
