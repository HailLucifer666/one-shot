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

const utcToday = () => new Date().toISOString().slice(0, 10);

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch {
      // A failed disk write or unexpected store error must answer with 500
      // instead of taking the whole server process down mid-request.
      if (!res.headersSent) send(res, 500, { error: "internal error" });
      else res.end();
    }
  });
}

async function route(req, res) {
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
      const q = url.searchParams;
      for (const key of q.keys()) {
        if (key !== "status" && key !== "overdue") {
          return send(res, 400, { error: `unknown query parameter "${key}"` });
        }
      }
      const status = q.get("status");
      const overdue = q.get("overdue");
      if (status !== null && status !== "open" && status !== "done") {
        return send(res, 400, { error: 'status must be "open" or "done"' });
      }
      if (overdue !== null && overdue !== "true") {
        return send(res, 400, { error: 'overdue must be "true"' });
      }
      let tasks = store.list();
      if (status === "open") tasks = tasks.filter((t) => !t.done);
      if (status === "done") tasks = tasks.filter((t) => t.done);
      if (overdue === "true") {
        const today = utcToday();
        tasks = tasks.filter((t) => !t.done && t.due !== null && t.due < today);
      }
      return send(res, 200, tasks);
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body || typeof body.title !== "string" || body.title.trim() === "") {
        return send(res, 400, { error: "title required" });
      }
      if ("due" in body && body.due !== null && !store.isValidDue(body.due)) {
        return send(res, 400, { error: "due must be null or a date string YYYY-MM-DD" });
      }
      const due = "due" in body ? body.due : null;
      return send(res, 201, store.add(body.title.trim(), due));
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
    if ("title" in body && (typeof body.title !== "string" || body.title.trim() === "")) {
      return send(res, 400, { error: "title required" });
    }
    if ("due" in body && body.due !== null && !store.isValidDue(body.due)) {
      return send(res, 400, { error: "due must be null or a date string YYYY-MM-DD" });
    }
    const t = store.update(id, body);
    return t ? send(res, 200, t) : send(res, 404, { error: "not found" });
  }
  if (req.method === "DELETE") {
    if (!store.remove(id)) return send(res, 404, { error: "not found" });
    return send(res, 204);
  }
  return send(res, 405, { error: "method not allowed" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    store.load();
  } catch (err) {
    console.error(`taskbox: refusing to start: ${err.message}`);
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`taskbox listening on ${port}`));
}
