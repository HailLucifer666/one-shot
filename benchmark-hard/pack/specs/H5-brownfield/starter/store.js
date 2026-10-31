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

export function add(title) {
  const t = { id: nextId++, title, done: false };
  tasks.push(t);
  return { ...t };
}

export function update(id, patch) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  if ("title" in patch) t.title = patch.title;
  if ("done" in patch) t.done = patch.done;
  return { ...t };
}

export function remove(id) {
  const i = tasks.findIndex((x) => x.id === id);
  if (i === -1) return false;
  tasks.splice(i, 1);
  return true;
}
