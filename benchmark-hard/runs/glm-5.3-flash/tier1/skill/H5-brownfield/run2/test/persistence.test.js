import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as store from "../store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, "..");
// Temp files stay inside the project folder and are removed at the end.
const tmpDir = path.join(appRoot, ".tmp-persist-test");

test.before(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const file = (name) => path.join(tmpDir, name);
const readJson = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));

test("a missing data file is an empty store", () => {
  store.loadFile(file("missing.json"));
  assert.deepEqual(store.list(), []);
  assert.equal(store.add("first").id, 1);
});

test("mutations are written to the data file in API task shape", () => {
  store.loadFile(file("store.json"));
  const a = store.add("write docs", "2030-01-31");
  store.update(a.id, { done: true });
  const onDisk = readJson("store.json");
  assert.ok(Array.isArray(onDisk));
  assert.deepEqual(onDisk, [
    { id: a.id, title: "write docs", done: true, due: "2030-01-31" },
  ]);
});

test("a restart reloads tasks and ids continue past the stored ones", () => {
  store.loadFile(file("restart.json"));
  const a = store.add("a");
  const b = store.add("b");
  store.remove(a.id);

  // Simulate a restart: same file, fresh load.
  store.loadFile(file("restart.json"));
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].title, "b");
  assert.equal(store.add("c").id, b.id + 1);
});

test("ids continue past the highest stored id even with gaps", () => {
  store.loadFile(file("gaps.json"));
  fs.writeFileSync(file("gaps.json"), JSON.stringify([{ id: 1, title: "x", done: false }, { id: 5, title: "y", done: true, due: "2030-05-05" }]));
  store.loadFile(file("gaps.json"));
  const t = store.add("next");
  assert.equal(t.id, 6);
  assert.deepEqual(store.list().map((x) => x.due), [null, "2030-05-05", null]);
});

test("tasks saved before the due feature load with due null", () => {
  store.loadFile(file("legacy.json"));
  fs.writeFileSync(file("legacy.json"), JSON.stringify([{ id: 7, title: "legacy", done: false }]));
  store.loadFile(file("legacy.json"));
  assert.deepEqual(store.list(), [{ id: 7, title: "legacy", done: false, due: null }]);
  assert.equal(store.add("after restart").id, 8);
});

test("a corrupt data file is a start-up error, never silent loss", () => {
  store.loadFile(file("corrupt.json"));
  fs.writeFileSync(file("corrupt.json"), "{ this is not json");
  assert.throws(() => store.loadFile(file("corrupt.json")), /corrupt/);
  fs.writeFileSync(file("corrupt2.json"), JSON.stringify({ tasks: [] }));
  assert.throws(() => store.loadFile(file("corrupt2.json")), /corrupt/);
  fs.writeFileSync(file("corrupt3.json"), JSON.stringify(["nope"]));
  assert.throws(() => store.loadFile(file("corrupt3.json")), /corrupt/);
});

test("tasks survive a real server restart", async () => {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const dataFile = file("real-restart.json");
  const env = { ...process.env, TASKBOX_DATA_FILE: dataFile, PORT: String(port) };
  const base = `http://localhost:${port}`;
  const spawnServer = () => spawn(process.execPath, [path.join(appRoot, "server.js")], { env });

  const waitReady = async () => {
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(base + "/api/tasks");
        if (res.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("server did not become ready");
  };

  let child = spawnServer();
  try {
    await waitReady();
    const res = await fetch(base + "/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "survives restart", due: "2030-03-03" }),
    });
    assert.equal(res.status, 201);
  } finally {
    child.kill();
    await new Promise((r) => child.on("exit", r));
  }

  child = spawnServer();
  try {
    await waitReady();
    const tasks = await (await fetch(base + "/api/tasks")).json();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, "survives restart");
    assert.equal(tasks[0].due, "2030-03-03");
    // The restarted server must not reuse an existing id.
    const created = await (await fetch(base + "/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "new after restart" }),
    })).json();
    assert.equal(created.id, tasks[0].id + 1);
  } finally {
    child.kill();
    await new Promise((r) => child.on("exit", r));
  }
});
