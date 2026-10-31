let tasks = [];
let nextId = 1;

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

// Validates a due-date value: null (unset) or a real calendar date in
// YYYY-MM-DD form. The round-trip through Date.UTC rejects dates that do not
// exist (e.g. 2030-02-30, which Date would normalize to 2030-03-02).
export function parseDue(value) {
  if (value === null) return { ok: true, due: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false };
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false };
  }
  return { ok: true, due: value };
}

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdue(t, today = todayUTC()) {
  return !t.done && t.due !== null && t.due < today;
}

export function add(title, due = null) {
  const t = { id: nextId++, title, done: false, due };
  tasks.push(t);
  return { ...t };
}

export function update(id, patch) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  if ("title" in patch) t.title = patch.title;
  if ("done" in patch) t.done = patch.done;
  if ("due" in patch) t.due = patch.due;
  return { ...t };
}

export function remove(id) {
  const i = tasks.findIndex((x) => x.id === id);
  if (i === -1) return false;
  tasks.splice(i, 1);
  return true;
}
