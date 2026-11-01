import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

let tasks = [];
let nextId = 1;
let dataFile = process.env.TASKBOX_DATA_FILE || path.join(here, "data", "tasks.json");

// C8: the store keeps its tasks in a JSON file so they survive a restart.
// Tests can point it at a scratch file with setDataFile().
export function setDataFile(p) {
  dataFile = p;
}

export function getDataFile() {
  return dataFile;
}

// C1: a valid due is null or a real calendar date in YYYY-MM-DD form.
// The round-trip check rejects dates that do not exist, e.g. 2030-02-30.
export function isValidDue(value) {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
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

// ---- persistence (C8) ----

// Write-through on every mutation, via a temp file + rename so a crash
// mid-write can never leave a half-written (corrupt) tasks.json behind.
function save() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
  fs.renameSync(tmp, dataFile);
}

function parseStoredTask(raw, index) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`data file ${dataFile} is corrupt: entry ${index} is not a task object`);
  }
  if (!Number.isInteger(raw.id)) {
    throw new Error(`data file ${dataFile} is corrupt: entry ${index} has no numeric id`);
  }
  if (typeof raw.title !== "string") {
    throw new Error(`data file ${dataFile} is corrupt: task ${raw.id} has no title`);
  }
  if (!("done" in raw)) raw.done = false;
  if (typeof raw.done !== "boolean") {
    throw new Error(`data file ${dataFile} is corrupt: task ${raw.id} has a non-boolean done`);
  }
  if (!("due" in raw)) raw.due = null;
  if (!isValidDue(raw.due)) {
    throw new Error(
      `data file ${dataFile} is corrupt: task ${raw.id} has an invalid due ${JSON.stringify(raw.due)}`
    );
  }
  return raw;
}

// Called when the server starts. A missing file is an empty store; a corrupt
// file is a loud start-up error so we never silently drop someone's tasks.
export function load() {
  let raw;
  try {
    raw = fs.readFileSync(dataFile, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") {
      tasks = [];
      nextId = 1;
      return;
    }
    throw new Error(`cannot read data file ${dataFile}: ${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`data file ${dataFile} is corrupt (not valid JSON): ${e.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`data file ${dataFile} is corrupt: expected a JSON array, got ${typeof parsed}`);
  }
  tasks = parsed.map(parseStoredTask);
  // A restart must never hand out an id that already exists.
  nextId = tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1;
}
