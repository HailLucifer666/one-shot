// Test bootstrap: isolated app instance per test, cookie-jar client, sample image bytes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../src/app.js";
import { ensureAdmin } from "../src/auth.js";

export const ADMIN = { email: "admin@recipebox.local", password: "admin-password-123" };

export async function startApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipebox-test-"));
  const app = createApp({ dataDir, seedAdmin: false });
  await ensureAdmin(app.locals.db, ADMIN);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    app,
    db: app.locals.db,
    server,
    dataDir,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// Minimal cookie jar: keeps the latest rb_session value, sends it on every request.
export function makeClient() {
  let sessionCookie = "";
  return {
    get loggedIn() {
      return sessionCookie.includes("=") && sessionCookie.length > 20;
    },
    async fetch(pathname, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (sessionCookie) headers.cookie = sessionCookie;
      const res = await fetch(`${this.base || ""}${pathname}`, {
        ...options,
        headers,
        redirect: "manual",
      });
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of setCookies) {
        const pair = c.split(";")[0];
        if (pair.startsWith("rb_session=")) sessionCookie = pair;
      }
      return res;
    },
  };
}

export function attachClient(ctx) {
  const client = makeClient();
  client.base = ctx.base;
  return client;
}

export async function registerAndLogin(client, base, email, password = "password-123") {
  let res = await client.fetch("/register", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }).toString(),
  });
  if (res.status !== 302) throw new Error(`register failed: ${res.status}`);
  await res.arrayBuffer();
  return res;
}

export function pngBytes() {
  // 1x1 valid PNG (signature + IHDR + IDAT + IEND).
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
}

export function jpgBytes() {
  // Minimal real JPEG (FF D8 FF signature).
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
    "base64"
  );
}

export function oversizePngBytes() {
  const png = pngBytes();
  return Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024, 0)]);
}
