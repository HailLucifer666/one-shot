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

// C3: "before today" is compared in UTC dates, as YYYY-MM-DD strings.
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function createServer() {
  // C8: load persisted tasks when the server starts (sync, before any request).
  store.load();
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
        // C2/C3: only status and overdue may appear in the query.
        for (const key of url.searchParams.keys()) {
          if (key !== "status" && key !== "overdue") {
            return send(res, 400, { error: "unknown query parameter" });
          }
        }
        const status = url.searchParams.get("status");
        if (status !== null && status !== "open" && status !== "done") {
          return send(res, 400, { error: "invalid status" });
        }
        const overdue = url.searchParams.get("overdue");
        if (overdue !== null && overdue !== "true") {
          return send(res, 400, { error: "invalid overdue value" });
        }

        let tasks = store.list();
        if (status === "open") tasks = tasks.filter((t) => t.done === false);
        if (status === "done") tasks = tasks.filter((t) => t.done === true);
        if (overdue === "true") {
          const today = todayUTC();
          tasks = tasks.filter((t) => t.done === false && t.due !== null && t.due < today);
        }
        return send(res, 200, tasks);
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        if (!body || typeof body.title !== "string" || body.title.trim() === "") {
          return send(res, 400, { error: "title required" });
        }
        const due = body.due === undefined ? null : body.due;
        if (!store.isValidDue(due)) return send(res, 400, { error: "invalid due" });
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
      if (!store.get(id)) return send(res, 404, { error: "not found" });
      // C4: a blank title is rejected; the task is left unchanged.
      if ("title" in body && (typeof body.title !== "string" || body.title.trim() === "")) {
        return send(res, 400, { error: "title required" });
      }
      // C1: due, when present, must be null or a valid date.
      if ("due" in body && !store.isValidDue(body.due)) {
        return send(res, 400, { error: "invalid due" });
      }
      const patch = { ...body };
      if ("title" in body) patch.title = body.title.trim();
      return send(res, 200, store.update(id, patch));
    }
    if (req.method === "DELETE") {
      // C4: deleting an id that does not exist is a 404, not a silent 204.
      return store.remove(id) ? send(res, 204) : send(res, 404, { error: "not found" });
    }
    return send(res, 405, { error: "method not allowed" });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  try {
    createServer().listen(port, () => console.log(`taskbox listening on ${port}`));
  } catch (e) {
    // C8: a corrupt data file stops the start-up loudly, with a clear message.
    console.error(`taskbox cannot start: ${e.message}`);
    process.exit(1);
  }
}
