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
const del = (id) => fetch(`${base}/api/tasks/${id}`, { method: "DELETE" });
const patch = (id, body) => fetch(`${base}/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });

test("DELETE of an existing task still returns 204", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal((await del(t.id)).status, 204);
});

test("DELETE of a missing id returns 404 with an error body", async () => {
  const res = await del(999);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not found" });
});

test("DELETE is 404 once the task is already gone", async () => {
  const t = await (await post({ title: "milk" })).json();
  assert.equal((await del(t.id)).status, 204);
  assert.equal((await del(t.id)).status, 404);
});

test("PATCH with an empty title returns 400", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await patch(t.id, { title: "" });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test("PATCH with a whitespace-only title returns 400", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await patch(t.id, { title: "   \t\n " });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test("PATCH with a valid title still works", async () => {
  const t = await (await post({ title: "milk" })).json();
  const res = await patch(t.id, { title: "bread" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, "bread");
});

test("PATCH of a missing id still returns 404", async () => {
  const res = await patch(999, { title: "x" });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not found" });
});
