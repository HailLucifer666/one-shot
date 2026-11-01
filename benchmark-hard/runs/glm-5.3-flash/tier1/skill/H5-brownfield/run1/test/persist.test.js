import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as store from "../store.js";

// Keep every disk write in this file away from the real data/tasks.json.
const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(appRoot, "data", "persist-test-tasks.json");
const e2eFile = path.join(appRoot, "data", "persist-e2e-tasks.json");
process.env.TASKBOX_DATA_FILE = file;

const readDisk = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

test.beforeEach(() => {
  fs.rmSync(file, { force: true });
  store.reset();
});
test.after(() => {
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.${process.pid}.tmp`, { force: true });
  fs.rmSync(e2eFile, { force: true });
});

test("add writes the task (with due) to the data file", () => {
  store.add("a", "2030-01-01");
  assert.deepEqual(readDisk(file), [{ id: 1, title: "a", done: false, due: "2030-01-01" }]);
});

test("update and remove are persisted too", () => {
  const t = store.add("a");
  store.update(t.id, { done: true });
  assert.deepEqual(readDisk(file), [{ id: 1, title: "a", done: true, due: null }]);
  store.remove(t.id);
  assert.deepEqual(readDisk(file), []);
});

test("load restores tasks and continues ids after a restart", () => {
  store.add("a");
  store.add("b", "2026-12-31");
  store.update(1, { done: true });
  store.load(); // what server startup does in a fresh process
  assert.equal(store.list().length, 2);
  assert.deepEqual(store.get(2), { id: 2, title: "b", done: false, due: "2026-12-31" });
  assert.equal(store.add("c").id, 3);
});

test("load treats a missing file as an empty store", () => {
  fs.rmSync(file, { force: true });
  store.load();
  assert.deepEqual(store.list(), []);
  assert.equal(store.add("a").id, 1);
});

test("load throws a clear error on corrupt JSON", () => {
  fs.writeFileSync(file, "{not json");
  assert.throws(() => store.load(), /corrupt/);
});

test("load throws when the file is not an array", () => {
  fs.writeFileSync(file, JSON.stringify({ nope: true }));
  assert.throws(() => store.load(), /array/);
});

test("load throws when a task has no integer id", () => {
  fs.writeFileSync(file, JSON.stringify([{ title: "x" }]));
  assert.throws(() => store.load(), /id/);
});

test("load rejects an invalid stored due date", () => {
  fs.writeFileSync(file, JSON.stringify([{ id: 1, title: "x", done: false, due: "2030-02-30" }]));
  assert.throws(() => store.load(), /due/);
});

test("ids continue past the highest stored id", () => {
  fs.writeFileSync(
    file,
    JSON.stringify([
      { id: 7, title: "old", done: false, due: null },
      { id: 3, title: "older", done: true, due: null },
    ])
  );
  store.load();
  assert.equal(store.get(7).title, "old");
  assert.equal(store.add("new").id, 8);
});

test("isValidDue accepts real dates and rejects bad ones", () => {
  assert.equal(store.isValidDue("2026-02-15"), true);
  assert.equal(store.isValidDue("2028-02-29"), true); // leap year
  assert.equal(store.isValidDue("2026-02-29"), false); // not a leap year
  assert.equal(store.isValidDue("2030-02-30"), false);
  assert.equal(store.isValidDue("2030-13-01"), false);
  assert.equal(store.isValidDue("2030-00-10"), false);
  assert.equal(store.isValidDue("2030-1-1"), false);
  assert.equal(store.isValidDue("2030-01-01T00:00:00Z"), false);
  assert.equal(store.isValidDue(null), false);
  assert.equal(store.isValidDue(123), false);
});

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });

async function startServer(port, dataPath) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(port), TASKBOX_DATA_FILE: dataPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + "/api/tasks");
      if (r.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill();
  throw new Error("server did not start");
}

test("a task with a due date survives a real server restart and ids continue", async () => {
  fs.rmSync(e2eFile, { force: true });
  const port = await freePort();
  let server = await startServer(port, e2eFile);
  let made;
  try {
    made = await (
      await fetch(`http://localhost:${port}/api/tasks`, {
        method: "POST",
        body: JSON.stringify({ title: "survivor", due: "2030-06-15" }),
      })
    ).json();
    assert.equal(made.due, "2030-06-15");
  } finally {
    server.kill();
  }
  await new Promise((r) => setTimeout(r, 300));
  try {
    server = await startServer(port, e2eFile);
    const after = await (await fetch(`http://localhost:${port}/api/tasks`)).json();
    const found = after.find((t) => t.id === made.id);
    assert.ok(found, "task missing after restart");
    assert.deepEqual(found, { id: made.id, title: "survivor", done: false, due: "2030-06-15" });
    const made2 = await (
      await fetch(`http://localhost:${port}/api/tasks`, { method: "POST", body: JSON.stringify({ title: "next" }) })
    ).json();
    assert.ok(made2.id > made.id, `new id ${made2.id} must be greater than ${made.id}`);
  } finally {
    server.kill();
  }
});

test("a corrupt data file is a clear start-up error, never silent data loss", async () => {
  fs.rmSync(e2eFile, { force: true });
  fs.writeFileSync(e2eFile, "{{{broken");
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(port), TASKBOX_DATA_FILE: e2eFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  const timer = setTimeout(() => {
    try {
      child.kill();
    } catch {}
  }, 5000);
  timer.unref();
  const [code, out, err] = await new Promise((resolve) => {
    child.on("exit", (c) => resolve([c, stdout, stderr]));
  });
  assert.notEqual(code, 0, "server must refuse to start on a corrupt data file");
  assert.match(out + err, /corrupt/i);
  // the corrupt file must still be there untouched
  assert.equal(fs.readFileSync(e2eFile, "utf8"), "{{{broken");
  fs.rmSync(e2eFile, { force: true });
});
