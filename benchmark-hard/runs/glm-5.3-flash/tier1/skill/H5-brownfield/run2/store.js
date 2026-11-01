import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = path.join(here, "data", "tasks.json");

let tasks = [];
let nextId = 1;
let dataFile = process.env.TASKBOX_DATA_FILE || DEFAULT_DATA_FILE;
// Persistence only becomes active once the store has been loaded from its file
// (the server does this at start-up). This keeps plain library use, including
// the original unit tests, free of surprise disk writes.
let persistenceOn = false;

export function reset() {
  tasks = [];
  nextId = 1;
}

function corrupt(reason) {
  return new Error(
    `taskbox: data file ${dataFile} is corrupt (${reason}). ` +
      "Fix or delete it by hand - the server refuses to start rather than silently lose your tasks."
  );
}

// Reads the data file into memory. A missing file is an empty store; a corrupt
// file throws a clear error (never silent data loss). After a successful load,
// every mutation is written back to the file.
export function load() {
  let raw;
  try {
    raw = fs.readFileSync(dataFile, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      tasks = [];
      nextId = 1;
      persistenceOn = true;
      return;
    }
    throw new Error(`taskbox: could not read data file ${dataFile}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw corrupt("not valid JSON");
  }
  if (!Array.isArray(parsed)) throw corrupt("expected a JSON array of tasks");

  tasks = parsed.map((t) => {
    if (t === null || typeof t !== "object" || Array.isArray(t)) {
      throw corrupt("task entries must be objects");
    }
    if (!Number.isInteger(t.id)) throw corrupt("a task is missing an integer id");
    if (typeof t.title !== "string") throw corrupt("a task is missing a title string");
    if (typeof t.done !== "boolean") throw corrupt("a task is missing a done boolean");
    if (t.due !== undefined && t.due !== null && typeof t.due !== "string") {
      throw corrupt("a task has a non-string due");
    }
    // Tasks written by older versions have no due field; it becomes null.
    return { id: t.id, title: t.title, done: t.done, due: typeof t.due === "string" ? t.due : null };
  });

  // Ids continue past every stored id, so a restart never reissues one.
  const maxId = tasks.reduce((m, t) => Math.max(m, t.id), 0);
  nextId = maxId + 1;
  persistenceOn = true;
}

// Point the store at a file and load it. Used by tests to simulate a restart.
export function loadFile(file) {
  dataFile = file;
  persistenceOn = false;
  load();
}

export function save() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  // Write to a temp file and rename, so a crash mid-write cannot corrupt the
  // previous good contents.
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2) + "\n");
  fs.renameSync(tmp, dataFile);
}

function persist() {
  if (persistenceOn) save();
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
