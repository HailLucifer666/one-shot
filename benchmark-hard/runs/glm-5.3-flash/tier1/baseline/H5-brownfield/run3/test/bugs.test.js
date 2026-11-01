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
const patch = (id, body) => fetch(`${base}/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });

test("DELETE of an existing id still returns 204 and removes it", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await fetch(`${base}/api/tasks/${t.id}`, { method: "DELETE" });
  assert.equal(res.status, 204);
  assert.equal((await fetch(`${base}/api/tasks/${t.id}`)).status, 404);
});

test("DELETE of a missing id returns 404 with an error body", async () => {
  const res = await fetch(`${base}/api/tasks/999`, { method: "DELETE" });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not found" });
});

test("DELETE of a just-deleted id returns 404, not 204", async () => {
  const t = await (await post({ title: "milk" })).json();
  await fetch(`${base}/api/tasks/${t.id}`, { method: "DELETE" });
  const again = await fetch(`${base}/api/tasks/${t.id}`, { method: "DELETE" });
  assert.equal(again.status, 404);
  assert.deepEqual(await again.json(), { error: "not found" });
});

test("PATCH with an empty or whitespace-only title returns 400", async () => {
  const t = await (await post({ title: "milk" })).json();
  for (const title of ["", "   ", "\t", "\n \t"]) {
    const res = await patch(t.id, { title });
    assert.equal(res.status, 400, `expected 400 for title=${JSON.stringify(title)}`);
    assert.ok((await res.json()).error);
  }
  const after = await (await fetch(`${base}/api/tasks/${t.id}`)).json();
  assert.equal(after.title, "milk", "the title must be unchanged after a rejected patch");
});

test("PATCH can still rename a task with a real title", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await patch(t.id, { title: "bread" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, "bread");
});

test("PATCH of a missing id still returns 404", async () => {
  const res = await patch(999, { title: "bread", done: true });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not found" });
});

test("PATCH of a missing id returns 404 even with an invalid body", async () => {
  const res = await patch(999, { title: "" });
  assert.equal(res.status, 404);
});
