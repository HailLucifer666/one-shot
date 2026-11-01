import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

let tasks = [];
let nextId = 1;

function dataFile() {
  return process.env.TASKBOX_DATA_FILE || path.join(here, "data", "tasks.json");
}

// A due date must be an existing calendar day written as YYYY-MM-DD.
export function isValidDue(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function reset() {
  tasks = [];
  nextId = 1;
}

export function list() {
  return tasks.map((t) => ({ ...t }));
}

export function get(id) {
  const t = tasks.find((x) => x.id === id);
  return t ? { ...t } : null;
}

export function add(title, due = null) {
  const t = { id: nextId++, title, done: false, due };
  tasks.push(t);
  save();
  return { ...t };
}

export function update(id, patch) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  if ("title" in patch) t.title = patch.title;
  if ("done" in patch) t.done = patch.done;
  if ("due" in patch) t.due = patch.due;
  save();
  return { ...t };
}

export function remove(id) {
  const i = tasks.findIndex((x) => x.id === id);
  if (i === -1) return false;
  tasks.splice(i, 1);
  save();
  return true;
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
}

// Write the current tasks to disk. The write goes to a per-process temp file
// that is then renamed over the real one, so a crash mid-write can never leave
// a half written (corrupt) data file behind. Concurrent writers (for example
// several test runner processes) each get their own temp name; if Windows
// briefly refuses the replace because another process is reading the target,
// retry a few times instead of crashing mid-request.
export function save() {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2) + "\n");
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const transient = err && (err.code === "EPERM" || err.code === "EACCES" || err.code === "ENOENT");
      if (!transient || attempt >= 10) {
        try {
          fs.rmSync(tmp, { force: true });
        } catch {}
        throw err;
      }
      sleepSync(25);
    }
  }
}

// Load tasks from disk. A missing file is an empty store. Anything unreadable,
// unparseable, or not an array of well-formed tasks throws a clear error so
// the server refuses to start instead of silently losing data.
export function load() {
  const file = dataFile();
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      tasks = [];
      nextId = 1;
      return;
    }
    throw new Error(`cannot read data file ${file}: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`data file ${file} is corrupt: not valid JSON`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`data file ${file} is corrupt: expected a JSON array of tasks`);
  }
  const loaded = data.map((t, i) => {
    const at = `data file ${file} is corrupt: task at index ${i}`;
    if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error(`${at} is not an object`);
    if (!Number.isInteger(t.id)) throw new Error(`${at} has no integer id`);
    if (typeof t.title !== "string") throw new Error(`${at} has a non-string title`);
    if ("done" in t && typeof t.done !== "boolean") throw new Error(`${at} has a non-boolean done`);
    if ("due" in t && t.due !== null && !isValidDue(t.due)) throw new Error(`${at} has an invalid due date`);
    return { id: t.id, title: t.title, done: t.done === true, due: t.due === undefined ? null : t.due };
  });
  tasks = loaded;
  // A restart must never hand out an id that already exists.
  nextId = loaded.reduce((m, t) => Math.max(m, t.id), 0) + 1;
}
