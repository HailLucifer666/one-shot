import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

// C1: a valid due is null/absent or a real calendar date in YYYY-MM-DD form.
// Returns null when valid, an error message otherwise.
function dueError(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "invalid due";
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return "invalid due"; // e.g. 2030-02-30 does not exist
  }
  return null;
}

// C3: today's date in UTC, as YYYY-MM-DD.
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/") {
      const html = fs.readFileSync(path.join(here, "public", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(html);
    }

    if (parts[0] !== "api" || parts[1] !== "tasks") return send(res, 404, { error: "not found" });

    if (parts.length === 2) {
      if (req.method === "GET") {
        // C2/C3: only status and overdue are accepted as query parameters.
        for (const key of new Set(url.searchParams.keys())) {
          if (key !== "status" && key !== "overdue") {
            return send(res, 400, { error: `unknown query parameter: ${key}` });
          }
        }
        const status = url.searchParams.get("status");
        if (status !== null && status !== "open" && status !== "done") {
          return send(res, 400, { error: "invalid status, expected open or done" });
        }
        const overdue = url.searchParams.get("overdue");
        if (overdue !== null && overdue !== "true") {
          return send(res, 400, { error: "invalid overdue, expected true" });
        }
        let tasks = store.list();
        if (status === "open") tasks = tasks.filter((t) => !t.done);
        if (status === "done") tasks = tasks.filter((t) => t.done);
        if (overdue === "true") {
          const today = todayUTC();
          tasks = tasks.filter((t) => !t.done && t.due !== null && t.due < today);
        }
        return send(res, 200, tasks);
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        if (!body || typeof body.title !== "string" || body.title.trim() === "") {
          return send(res, 400, { error: "title required" });
        }
        const dueErr = dueError(body.due);
        if (dueErr) return send(res, 400, { error: dueErr });
        return send(res, 201, store.add(body.title.trim(), body.due ?? null));
      }
      return send(res, 405, { error: "method not allowed" });
    }

    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return send(res, 400, { error: "bad id" });

    if (req.method === "GET") {
      const t = store.get(id);
      return t ? send(res, 200, t) : send(res, 404, { error: "not found" });
    }
    if (req.method === "PATCH") {
      const body = await readJson(req);
      if (!body) return send(res, 400, { error: "bad json" });
      // C4: an empty or whitespace-only title is rejected.
      if ("title" in body && (typeof body.title !== "string" || body.title.trim() === "")) {
        return send(res, 400, { error: "title required" });
      }
      const dueErr = dueError(body.due);
      if (dueErr) return send(res, 400, { error: dueErr });
      const t = store.update(id, body);
      return t ? send(res, 200, t) : send(res, 404, { error: "not found" });
    }
    if (req.method === "DELETE") {
      // C4: deleting a missing id is 404, not 204.
      return store.remove(id) ? send(res, 204) : send(res, 404, { error: "not found" });
    }
    return send(res, 405, { error: "method not allowed" });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // C8: load persisted tasks before accepting requests. A corrupt data file is
  // a start-up error with a clear message, never silent data loss.
  try {
    store.load();
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`taskbox listening on ${port}`));
}
