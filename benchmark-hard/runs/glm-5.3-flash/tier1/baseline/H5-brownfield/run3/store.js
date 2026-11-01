import fs from "node:fs";
import path from "node:path";

let tasks = [];
let nextId = 1;
let dataFile = null;

export function reset() {
  tasks = [];
  nextId = 1;
}

// Point the store at a JSON file. This enables persistence: the current file
// content is loaded now, and every mutation is written through to the file.
// Call with null to disable persistence (the in-memory mode the tests use).
export function setDataFile(file) {
  dataFile = file;
  if (file) load();
}

// A due date is either null or a string "YYYY-MM-DD" that names a real
// calendar day (so 2030-02-30 is rejected, not just badly formatted strings).
export function isValidDue(value) {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function persist() {
  if (!dataFile) return;
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(tasks, null, 2) + "\n");
}

function load() {
  let raw;
  try {
    raw = fs.readFileSync(dataFile, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      // A missing file means an empty store; the file is created on first mutation.
      tasks = [];
      nextId = 1;
      return;
    }
    throw new Error(`cannot read task store file ${dataFile}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`task store file ${dataFile} is corrupt: not valid JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`task store file ${dataFile} is corrupt: expected a JSON array of tasks`);
  }
  tasks = parsed.map((t, i) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      throw new Error(`task store file ${dataFile} is corrupt: entry ${i} is not a task object`);
    }
    if (!Number.isInteger(t.id) || t.id < 1) {
      throw new Error(`task store file ${dataFile} is corrupt: entry ${i} has no valid id`);
    }
    return {
      id: t.id,
      title: typeof t.title === "string" ? t.title : "",
      done: t.done === true,
      due: isValidDue(t.due) ? t.due : null,
    };
  });
  // Never hand out an id that already exists, even if the file was hand-edited.
  nextId = tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;
}

export function list() {
  return tasks.map((t) => ({ ...t }));
}

// status: "open" | "done" (optional). overdue: true (optional) keeps only
// tasks that are not done and whose due date is strictly before today (UTC).
export function query({ status, overdue } = {}) {
  const today = utcToday();
  return tasks
    .filter((t) => {
      if (status === "open" && t.done) return false;
      if (status === "done" && !t.done) return false;
      if (overdue === true) {
        if (t.done) return false;
        if (!t.due || t.due >= today) return false;
      }
      return true;
    })
    .map((t) => ({ ...t }));
}

export function get(id) {
  const t = tasks.find((x) => x.id === id);
  return t ? { ...t } : null;
}

export function add(title, due = null) {
  const t = { id: nextId++, title, done: false, due: due ?? null };
  tasks.push(t);
  persist();
  return { ...t };
}

export function update(id, patch) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  if ("title" in patch) t.title = patch.title;
  if ("done" in patch) t.done = patch.done;
  if ("due" in patch) t.due = patch.due;
  persist();
  return { ...t };
}

export function remove(id) {
  const i = tasks.findIndex((x) => x.id === id);
  if (i === -1) return false;
  tasks.splice(i, 1);
  persist();
  return true;
}
