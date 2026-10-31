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
      if (req.method === "GET") return send(res, 200, store.list());
      if (req.method === "POST") {
        const body = await readJson(req);
        if (!body || typeof body.title !== "string" || body.title.trim() === "") {
          return send(res, 400, { error: "title required" });
        }
        return send(res, 201, store.add(body.title.trim()));
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
      const t = store.update(id, body);
      return t ? send(res, 200, t) : send(res, 404, { error: "not found" });
    }
    if (req.method === "DELETE") {
      store.remove(id);
      return send(res, 204);
    }
    return send(res, 405, { error: "method not allowed" });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`taskbox listening on ${port}`));
}
