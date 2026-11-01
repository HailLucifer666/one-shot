import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.js";
import * as store from "../store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "data");
let tmpDir;

test.before(() => {
  fs.mkdirSync(dataDir, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(dataDir, "persistence-test-"));
});
test.after(() => {
  store.setDataFile(null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const readDisk = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("a missing data file means an empty store", () => {
  store.setDataFile(path.join(tmpDir, "missing.json"));
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.add("first"), { id: 1, title: "first", done: false, due: null });
});

test("every mutation is written through to the file", () => {
  const file = path.join(tmpDir, "mutations.json");
  store.setDataFile(file);
  const t = store.add("write tests");
  assert.deepEqual(readDisk(file), [{ id: t.id, title: "write tests", done: false, due: null }]);

  store.update(t.id, { done: true });
  assert.equal(readDisk(file)[0].done, true);

  store.update(t.id, { due: "2030-01-31" });
  assert.equal(readDisk(file)[0].due, "2030-01-31");

  store.remove(t.id);
  assert.deepEqual(readDisk(file), []);
});

test("tasks survive a restart and ids continue past the stored ones", () => {
  const file = path.join(tmpDir, "restart.json");
  store.setDataFile(file);
  const a = store.add("survives");
  store.update(a.id, { done: true });

  // Simulate a process restart: reload the file into fresh state.
  store.setDataFile(file);
  assert.deepEqual(store.list(), [{ id: a.id, title: "survives", done: true, due: null }]);
  const b = store.add("after restart");
  assert.equal(b.id, a.id + 1, "a restart must never hand out an id that already exists");

  // Id numbering also continues past ids in a hand-written file.
  fs.writeFileSync(
    file,
    JSON.stringify([{ id: 7, title: "hand written", done: false, due: "2020-01-01" }])
  );
  store.setDataFile(file);
  assert.equal(store.add("next").id, 8);
  assert.equal(store.list().length, 2);
});

test("tasks survive a real server restart over HTTP", async () => {
  const file = path.join(tmpDir, "http-restart.json");
  store.setDataFile(file);

  const listen = (s) => new Promise((r) => s.listen(0, r));
  const s1 = createServer();
  await listen(s1);
  const b1 = `http://localhost:${s1.address().port}`;
  const created = await (
    await fetch(b1 + "/api/tasks", { method: "POST", body: JSON.stringify({ title: "survive me", due: "2030-03-03" }) })
  ).json();
  assert.equal(created.id, 1);
  await new Promise((r) => s1.close(r));

  // A new process would load the file when the server starts.
  store.setDataFile(file);
  const s2 = createServer();
  await listen(s2);
  const b2 = `http://localhost:${s2.address().port}`;
  assert.deepEqual(await (await fetch(b2 + "/api/tasks")).json(), [
    { id: 1, title: "survive me", done: false, due: "2030-03-03" },
  ]);
  const next = await (
    await fetch(b2 + "/api/tasks", { method: "POST", body: JSON.stringify({ title: "second" }) })
  ).json();
  assert.equal(next.id, 2);
  await new Promise((r) => s2.close(r));
});

test("a corrupt data file is a startup error, never silent data loss", () => {
  const file = path.join(tmpDir, "corrupt.json");
  fs.writeFileSync(file, "{ definitely not json");
  assert.throws(() => store.setDataFile(file), /corrupt/);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    "{ definitely not json",
    "the file must be left untouched so nothing is lost"
  );
});

test("a data file that is not an array is a startup error", () => {
  const file = path.join(tmpDir, "notarray.json");
  fs.writeFileSync(file, JSON.stringify({ tasks: [] }));
  assert.throws(() => store.setDataFile(file), /corrupt/);
});

test("entries that are not task objects are a startup error", () => {
  const file = path.join(tmpDir, "badentry.json");
  fs.writeFileSync(file, JSON.stringify([1, 2]));
  assert.throws(() => store.setDataFile(file), /corrupt/);
});
