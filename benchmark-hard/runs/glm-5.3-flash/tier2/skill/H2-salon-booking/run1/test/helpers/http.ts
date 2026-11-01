import { once } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import type { Express } from "express";
import { createApp } from "../../src/app.ts";

export type TestServer = {
  server: import("node:http").Server;
  port: number;
  dataDir: string;
  outboxDir: string;
  close: () => void;
};

/**
 * The fixed "now" for tests: Wednesday 2026-11-04, 06:00 salon time (12:00Z).
 * Every test file sets CUTWELL_NOW explicitly (it defaults to this instant) so
 * booking windows are deterministic.
 */
export const DEFAULT_NOW = "2026-11-04T12:00:00Z";

/**
 * Creates the app with isolated temp directories INSIDE the project (.tmp-test/,
 * git-ignored) and starts it on a random local port. Awaits "listening" before
 * returning. close() releases the HTTP server and the SQLite handle; the temp
 * directories are left in place because Windows cannot delete open database files.
 */
export async function startTestServer(clockIso: string = DEFAULT_NOW): Promise<TestServer> {
  const base = join(process.cwd(), ".tmp-test");
  mkdirSync(base, { recursive: true });
  const dataDir = mkdtempSync(join(base, "data-"));
  const outboxDir = mkdtempSync(join(base, "outbox-"));
  process.env.CUTWELL_NOW = clockIso;
  const app: Express = createApp({ dataDir, outboxDir });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    dataDir,
    outboxDir,
    close: () => {
      server.close();
      (app.get("db") as DatabaseSync | undefined)?.close();
    },
  };
}

export function url(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

/** Minimal cookie-jar client for SSR flows. */
export class Client {
  private jar = new Map<string, string>();
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  async request(
    path: string,
    opts: { method?: string; form?: Record<string, string>; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; location: string | null; text: string; contentType: string }> {
    const headers: Record<string, string> = { ...opts.headers };
    if (this.jar.size > 0) headers.cookie = [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: string | undefined;
    if (opts.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.form).toString();
    }
    const res = await fetch(url(this.port, path), {
      method: opts.method ?? (body !== undefined ? "POST" : "GET"),
      headers,
      body,
      redirect: "manual",
    });
    const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const setCookie of setCookies) {
      const pair = setCookie.split(";")[0];
      if (pair) {
        const eq = pair.indexOf("=");
        if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
    return {
      status: res.status,
      location: res.headers.get("location"),
      text: await res.text(),
      contentType: res.headers.get("content-type") ?? "",
    };
  }
}
