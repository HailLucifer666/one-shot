import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../store.js";

test.beforeEach(() => store.reset());

test("add returns a task with id, title and done=false", () => {
  const t = store.add("write docs");
  assert.equal(t.id, 1);
  assert.equal(t.title, "write docs");
  assert.equal(t.done, false);
});

test("ids increase", () => {
  assert.equal(store.add("a").id, 1);
  assert.equal(store.add("b").id, 2);
});

test("list returns all tasks", () => {
  store.add("a");
  store.add("b");
  assert.equal(store.list().length, 2);
});

test("get returns null for a missing id", () => {
  assert.equal(store.get(99), null);
});

test("update changes done", () => {
  const t = store.add("a");
  assert.equal(store.update(t.id, { done: true }).done, true);
});

test("remove deletes and reports", () => {
  const t = store.add("a");
  assert.equal(store.remove(t.id), true);
  assert.equal(store.remove(t.id), false);
});
