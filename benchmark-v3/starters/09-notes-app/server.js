"use strict";

// Notes — a tiny zero-dependency note-taking app.
// Built-in `http` module only; the store is a single JSON file whose path
// comes from DATA_FILE (default ./data.json). The frontend lives in public/.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 1024 * 1024;

const STATIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/styles.css": "styles.css",
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The store shape is { nextId: <int>, notes: [...] }, with notes kept in
// creation order (oldest first). Every note looks like
// { id, title, body, createdAt }, where createdAt is a UTC ISO string.

function loadStore() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return { nextId: 0, notes: [] };
  }
  if (!parsed || !Number.isInteger(parsed.nextId) || !Array.isArray(parsed.notes)) {
    throw new Error(`store file ${DATA_FILE} is not a valid notes store`);
  }
  return parsed;
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function dayKey(iso) {
  // Calendar day a note belongs to, used for the date headers in the list.
  const naive = new Date(iso.replace("Z", ""));
  return naive.toISOString().slice(0, 10);
}

function byNewestFirst(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return b.id - a.id;
}

function listGroups(store) {
  const byDay = new Map();
  for (const note of store.notes) {
    const key = dayKey(note.createdAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(note);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, notes]) => ({ date, notes: notes.sort(byNewestFirst) }));
}

function searchNotes(store, q) {
  if (!q) return [];
  return store.notes.filter((note) => note.title.includes(q) || note.body.includes(q));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim() === "") return reject(new ApiError(400, "request body must be JSON"));
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, "request body must be valid JSON"));
      }
    });
    req.on("error", (err) => reject(new ApiError(400, err.message)));
  });
}

async function createNote(req, res) {
  const parsed = await readJsonBody(req);
  const title = typeof parsed.title === "string" ? parsed.title : "";
  const body = typeof parsed.body === "string" ? parsed.body : "";
  if (!title.trim()) throw new ApiError(400, "title is required");
  if (!body.trim()) throw new ApiError(400, "body is required");

  let createdAt = new Date().toISOString();
  if (parsed.createdAt !== undefined) {
    // Optional field so old notes can be backfilled/imported with their
    // original timestamps.
    if (typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt))) {
      throw new ApiError(400, "createdAt must be a valid ISO date string");
    }
    createdAt = new Date(parsed.createdAt).toISOString();
  }

  const store = loadStore();
  const note = { id: store.nextId, title, body, createdAt };
  store.nextId += 1;
  store.notes.push(note);
  saveStore(store);
  return sendJson(res, 201, note);
}

function deleteNote(res, rawId) {
  const store = loadStore();
  const index = Number(rawId);
  const note = store.notes[index];
  if (!note) throw new ApiError(404, `note ${rawId} not found`);
  store.notes.splice(index, 1);
  saveStore(store);
  return sendJson(res, 200, note);
}

function serveStatic(res, pathname) {
  const file = STATIC_FILES[pathname];
  if (!file) throw new ApiError(404, "not found");
  const full = path.join(PUBLIC_DIR, file);
  fs.readFile(full, (err, data) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] });
    res.end(data);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/notes") {
      if (req.method === "GET") return sendJson(res, 200, listGroups(loadStore()));
      if (req.method === "POST") return await createNote(req, res);
      return sendJson(res, 405, { error: "method not allowed" });
    }
    if (url.pathname === "/api/notes/search" && req.method === "GET") {
      return sendJson(res, 200, searchNotes(loadStore(), url.searchParams.get("q") || ""));
    }
    const idMatch = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
    if (idMatch && req.method === "DELETE") return deleteNote(res, idMatch[1]);
    if (idMatch) return sendJson(res, 405, { error: "method not allowed" });

    if (req.method === "GET") return serveStatic(res, url.pathname);
    return sendJson(res, 404, { error: "not found" });
  } catch (err) {
    if (err instanceof ApiError) return sendJson(res, err.status, { error: err.message });
    console.error("unhandled error:", err);
    return sendJson(res, 500, { error: "internal server error" });
  }
}

function createApp() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("unhandled request error:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal server error" });
      else res.destroy();
    });
  });
}

const server = createApp();
server.on("error", (err) => {
  console.error("server error:", err);
  process.exit(1);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Notes app listening on http://localhost:${PORT}`);
    console.log(`Data file: ${DATA_FILE}`);
  });
}

module.exports = { server, createApp };
