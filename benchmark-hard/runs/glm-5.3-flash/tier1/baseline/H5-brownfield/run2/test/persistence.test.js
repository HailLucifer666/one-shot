// C8: persistence — data/tasks.json holds the tasks, written on every mutation,
// loaded when the server starts. Missing file = empty store; corrupt file = loud
// start-up error; ids continue past stored tasks after a restart.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.js";
import * as store from "../store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(here, "..", "data", "tmp-test-persist");

const scratch = (name) => path.join(tmpDir, name);
const writeRaw = (name, text) => {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(scratch(name), text);
};

test.before(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
});
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

test("a missing data file loads as an empty store", () => {
  store.setDataFile(scratch("missing.json"));
  store.load();
  assert.deepEqual(store.list(), []);
  assert.equal(store.add("first").id, 1);
});

test("every mutation is written to the data file as a JSON array", () => {
  const file = scratch("mutations.json");
  store.setDataFile(file);
  store.load();
  const a = store.add("a", "2030-01-01");
  const b = store.add("b");
  store.update(a.id, { done: true });
  store.remove(b.id);

  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(Array.isArray(onDisk));
  assert.equal(onDisk.length, 1);
  assert.deepEqual(onDisk[0], { id: a.id, title: "a", done: true, due: "2030-01-01" });
  assert.deepEqual(store.list(), onDisk);
});

test("load restores tasks and continues id numbering past the stored ids", () => {
  const file = scratch("ids.json");
  writeRaw("ids.json", JSON.stringify([{ id: 41, title: "kept", done: false, due: "2020-01-01" }]));
  store.setDataFile(file);
  store.load();
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].title, "kept");
  // A restart must never hand out an id that already exists.
  assert.equal(store.add("new").id, 42);
});

test("load normalizes an older task that has no due key to due null", () => {
  const file = scratch("legacy.json");
  writeRaw("legacy.json", JSON.stringify([{ id: 1, title: "old", done: false }]));
  store.setDataFile(file);
  store.load();
  assert.deepEqual(store.list()[0].due, null);
});

test("corrupt JSON is a loud start-up error, not silent data loss", () => {
  const file = scratch("corrupt.json");
  writeRaw("corrupt.json", "{ this is not json");
  store.setDataFile(file);
  assert.throws(() => store.load(), /corrupt/);
});

test("a data file that is not an array is corrupt", () => {
  const file = scratch("notarray.json");
  writeRaw("notarray.json", JSON.stringify({ hello: "world" }));
  store.setDataFile(file);
  assert.throws(() => store.load(), /corrupt/);
});

test("an entry without a numeric id is corrupt", () => {
  const file = scratch("noid.json");
  writeRaw("noid.json", JSON.stringify([{ title: "no id", done: false, due: null }]));
  store.setDataFile(file);
  assert.throws(() => store.load(), /corrupt/);
});

test("an entry with an invalid due value is corrupt", () => {
  const file = scratch("baddue.json");
  writeRaw("baddue.json", JSON.stringify([{ id: 1, title: "x", done: false, due: "2030-02-30" }]));
  store.setDataFile(file);
  assert.throws(() => store.load(), /corrupt/);
});

test("a corrupt data file fails server start-up with a clear message", async () => {
  const file = scratch("startup.json");
  writeRaw("startup.json", "{oops");
  store.setDataFile(file);
  assert.throws(() => createServer(), /corrupt/, "createServer loads the store and must throw");
});

test("tasks survive a server restart", async () => {
  const file = scratch("restart.json");
  store.setDataFile(file);
  store.load();

  const s1 = createServer();
  await new Promise((r) => s1.listen(0, r));
  const base1 = `http://localhost:${s1.address().port}`;
  const made = await (
    await fetch(base1 + "/api/tasks", { method: "POST", body: JSON.stringify({ title: "survivor", due: "2030-01-01" }) })
  ).json();
  s1.close();

  // "Restart": a second server over the same data file re-loads from disk.
  const s2 = createServer();
  await new Promise((r) => s2.listen(0, r));
  const base2 = `http://localhost:${s2.address().port}`;
  const after = await (await fetch(base2 + "/api/tasks")).json();
  const found = after.find((t) => t.id === made.id);
  assert.ok(found, "task created before the restart must exist after it");
  assert.deepEqual(found, { id: made.id, title: "survivor", done: false, due: "2030-01-01" });

  const next = await (
    await fetch(base2 + "/api/tasks", { method: "POST", body: JSON.stringify({ title: "after restart" }) })
  ).json();
  assert.ok(next.id > made.id, "ids continue past stored tasks after a restart");
  s2.close();
});
