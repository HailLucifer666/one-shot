// JSON file store. Single writer per process, atomic writes via temp file + rename.
// Photos live in <dataDir>/uploads, which is never statically served; they are
// delivered only through the /photos/:name route after a strict name check.
import fs from "node:fs";
import path from "node:path";

export function createDb(dataDir) {
  const uploadsDir = path.join(dataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const file = path.join(dataDir, "db.json");

  const state = { users: [], sessions: {}, recipes: [], comments: [] };
  if (fs.existsSync(file)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      throw new Error(`data/db.json is not valid JSON (${err.message}). Fix or remove it; refusing to overwrite data.`);
    }
    for (const key of Object.keys(state)) {
      if (parsed[key] !== undefined) state[key] = parsed[key];
    }
  }

  function save() {
    const tmp = path.join(dataDir, `.db.json.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  return { state, save, dataDir, uploadsDir };
}

export function nextId() {
  return crypto.randomUUID();
}

export function findUserByEmail(state, email) {
  const needle = String(email || "").trim().toLowerCase();
  return state.users.find((u) => u.email === needle) || null;
}

export function findUser(state, id) {
  return state.users.find((u) => u.id === id) || null;
}

export function findRecipe(state, id) {
  return state.recipes.find((r) => r.id === id) || null;
}

export function findComment(state, id) {
  return state.comments.find((c) => c.id === id) || null;
}

export function commentsFor(state, recipeId) {
  return state.comments
    .filter((c) => c.recipeId === recipeId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
