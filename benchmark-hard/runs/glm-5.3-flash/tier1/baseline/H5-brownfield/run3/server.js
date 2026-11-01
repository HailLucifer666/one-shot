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
        for (const key of url.searchParams.keys()) {
          if (key !== "status" && key !== "overdue") {
            return send(res, 400, { error: `unknown query parameter "${key}"` });
          }
        }
        let status;
        if (url.searchParams.has("status")) {
          status = url.searchParams.get("status");
          if (status !== "open" && status !== "done") {
            return send(res, 400, { error: `invalid status "${status}", must be "open" or "done"` });
          }
        }
        let overdue = false;
        if (url.searchParams.has("overdue")) {
          if (url.searchParams.get("overdue") !== "true") {
            return send(res, 400, { error: `invalid overdue value, must be "true"` });
          }
          overdue = true;
        }
        if (!status && !overdue) return send(res, 200, store.list());
        return send(res, 200, store.query({ status, overdue }));
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        if (!body || typeof body.title !== "string" || body.title.trim() === "") {
          return send(res, 400, { error: "title required" });
        }
        if ("due" in body && !store.isValidDue(body.due)) {
          return send(res, 400, { error: "invalid due, must be a real date as YYYY-MM-DD or null" });
        }
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
      if (!body || typeof body !== "object") return send(res, 400, { error: "bad json" });
      const existing = store.get(id);
      if (!existing) return send(res, 404, { error: "not found" });
      if ("title" in body && (typeof body.title !== "string" || body.title.trim() === "")) {
        return send(res, 400, { error: "title must be a non-empty string" });
      }
      if ("due" in body && !store.isValidDue(body.due)) {
        return send(res, 400, { error: "invalid due, must be a real date as YYYY-MM-DD or null" });
      }
      const t = store.update(id, body);
      return t ? send(res, 200, t) : send(res, 404, { error: "not found" });
    }
    if (req.method === "DELETE") {
      const ok = store.remove(id);
      return ok ? send(res, 204) : send(res, 404, { error: "not found" });
    }
    return send(res, 405, { error: "method not allowed" });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  let server;
  try {
    store.setDataFile(path.join(here, "data", "tasks.json"));
    server = createServer();
  } catch (err) {
    console.error(`taskbox cannot start: ${err.message}`);
    process.exit(1);
  }
  server.listen(port, () => console.log(`taskbox listening on ${port}`));
}
