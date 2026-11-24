#!/usr/bin/env node
/**
 * one-shot v0.2.0 executable release-gate verifier.
 * Zero external dependencies — Node 20+ built-ins only.
 *
 * Produces a machine-verified GATE-RECEIPT.json and exits:
 *   0 = PASS (all executed checks passed)
 *   1 = BLOCKED (one or more checks failed)
 *   2 = Operational / CLI usage error
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VERSION = "0.2.0";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".venv", "venv",
  "__pycache__", "one-shot-work", ".cache", "coverage",
]);

const CODE_AND_CONFIG_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".py", ".html", ".htm",
  ".vue", ".svelte", ".css", ".json", ".yaml", ".yml", ".toml", ".ini",
  ".cfg", ".sql", ".sh",
]);

const SECRET_RE = new RegExp(
  [
    "-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "\\bAKIA[0-9A-Z]{16}\\b",
    "\\bsk-[A-Za-z0-9]{20,}\\b",
    "\\bghp_[A-Za-z0-9]{36}\\b",
    "\\bgithub_pat_[A-Za-z0-9_]{30,}\\b",
    "\\bAIza[0-9A-Za-z_\\-]{35}\\b",
    "\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b",
  ].join("|")
);

const BANNED_HTML_PHRASES = [
  "lorem ipsum",
  "todo: implement",
  "fixme: stub",
  "[placeholder]",
];

const STACK_TRACE_RE = /(?:Traceback \(most recent call last\):|\n\s+at\s+\S+\s+\([^)]+:\d+:\d+\)|SyntaxError:[^\n]+\n\s+at\s)/;

const JS_TOKEN_RE = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g;
const CSS_TOKEN_RE = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|(\/\*[\s\S]*?\*\/)/g;
const SQL_TOKEN_RE = /'(?:''|\\.|[^'])*'|"(?:""|\\.|[^"])*"|(\/\*[\s\S]*?\*\/|--[^\n]*)/g;
const HASH_COMMENT_EXTS = new Set([".py", ".yaml", ".yml", ".ini", ".cfg", ".toml", ".sh", ".env"]);

export function stripComments(text, ext) {
  if (ext === ".html" || ext === ".htm" || ext === ".vue" || ext === ".svelte") {
    let out = text.replace(/<!--[\s\S]*?-->/g, " ");
    out = out.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, a, b, c) =>
      a + b.replace(JS_TOKEN_RE, (m, comment) => (comment ? " " : m)) + c
    );
    out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, a, b, c) =>
      a + b.replace(CSS_TOKEN_RE, (m, comment) => (comment ? " " : m)) + c
    );
    return out;
  }
  if (ext === ".css") {
    return text.replace(CSS_TOKEN_RE, (m, comment) => (comment ? " " : m));
  }
  if (ext === ".sql") {
    return text.replace(SQL_TOKEN_RE, (m, comment) => (comment ? " " : m));
  }
  if (HASH_COMMENT_EXTS.has(ext)) {
    return text.replace(/#[^\n]*/g, " ");
  }
  return text.replace(JS_TOKEN_RE, (m, comment) => (comment ? " " : m));
}

export function gitignoreIgnoresEnv(text) {
  let ignored = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^\/?\.env\*?$/.test(line)) ignored = true;
    else if (/^!\/?\.env\*?$/.test(line)) ignored = false;
  }
  return ignored;
}

export function visibleHtmlText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function walkFiles(root) {
  const results = [];
  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        results.push(path.join(dir, entry.name));
      }
    }
  }
  visit(root);
  return results.sort();
}

function runShell(cmd, cwd, timeoutMs = 120_000) {
  const res = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    exitCode: res.status ?? (res.error ? 1 : 0),
    stdout: (res.stdout || "").slice(-2000),
    stderr: (res.stderr || "").slice(-2000),
    error: res.error ? res.error.message : null,
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function httpRequest(port, method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: urlPath, method, headers, timeout: 5000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function waitForServer(port, healthPath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await httpRequest(port, "GET", healthPath);
      return res;
    } catch (err) {
      lastErr = err.message;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`server did not become ready on 127.0.0.1:${port}${healthPath} within ${timeoutMs}ms (${lastErr})`);
}

function killProcessTree(child) {
  if (!child || child.killed || !child.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try { child.kill(); } catch { /* ignore */ }
  }
}

async function probeServer(opts, checks) {
  const port = await getFreePort();
  const healthPath = opts.healthPath || "/";
  const child = spawn(opts.startCmd, {
    cwd: opts.dir,
    shell: true,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrTail = "";
  child.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString("utf-8")).slice(-1000); });
  try {
    const health = await waitForServer(port, healthPath);
    const okHealth = health.status >= 200 && health.status < 400 && !STACK_TRACE_RE.test(health.body);
    checks.push({
      id: "server-health",
      status: okHealth ? "PASS" : "FAIL",
      detail: `GET ${healthPath} -> HTTP ${health.status}` +
        (STACK_TRACE_RE.test(health.body) ? " (stack trace leaked in body)" : ""),
    });

    // Malformed JSON probe: must not 500 or leak stack traces
    const jsonPath = opts.malformedJsonPath || opts.protectedPath || healthPath;
    const bad = await httpRequest(port, "POST", jsonPath, "{not-valid-json", {
      "Content-Type": "application/json",
    });
    const okMalformed = bad.status !== 500 && !STACK_TRACE_RE.test(bad.body);
    checks.push({
      id: "server-malformed-json",
      status: okMalformed ? "PASS" : "FAIL",
      detail: `POST ${jsonPath} (malformed JSON) -> HTTP ${bad.status}` +
        (STACK_TRACE_RE.test(bad.body) ? " (stack trace leaked)" : ""),
    });

    // Protected route probe: unauthenticated access must return 401 or 403
    if (opts.protectedPath) {
      const unauth = await httpRequest(port, "GET", opts.protectedPath);
      const okAuth = unauth.status === 401 || unauth.status === 403;
      checks.push({
        id: "server-auth-guard",
        status: okAuth ? "PASS" : "FAIL",
        detail: `unauthenticated GET ${opts.protectedPath} -> HTTP ${unauth.status} (expected 401 or 403)`,
      });
    }
  } catch (err) {
    checks.push({
      id: "server-boot",
      status: "FAIL",
      detail: `${err.message}${stderrTail ? ` | stderr: ${stderrTail.trim()}` : ""}`,
    });
  } finally {
    killProcessTree(child);
  }
}

function parseArgs(argv) {
  const opts = {
    dir: ".",
    contract: null,
    out: null,
    testCmd: null,
    buildCmd: null,
    startCmd: null,
    healthPath: null,
    protectedPath: null,
    malformedJsonPath: null,
    skipBrowser: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") { opts.help = true; continue; }
    if (arg === "--skip-browser") { opts.skipBrowser = true; continue; }
    const next = argv[i + 1];
    if (next === undefined) throw new Error(`missing value for ${arg}`);
    if (arg === "--dir") { opts.dir = next; i++; }
    else if (arg === "--contract") { opts.contract = next; i++; }
    else if (arg === "--out") { opts.out = next; i++; }
    else if (arg === "--test-cmd") { opts.testCmd = next; i++; }
    else if (arg === "--build-cmd") { opts.buildCmd = next; i++; }
    else if (arg === "--start-cmd") { opts.startCmd = next; i++; }
    else if (arg === "--health-path") { opts.healthPath = next; i++; }
    else if (arg === "--protected-path") { opts.protectedPath = next; i++; }
    else if (arg === "--malformed-json-path") { opts.malformedJsonPath = next; i++; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

function usage() {
  return [
    `one-shot verify v${VERSION} — executable release-gate verifier`,
    "",
    "Usage: node verify.mjs [options]",
    "  --dir <path>                Project directory (default: .)",
    "  --contract <path>           Contract JSON path (default: <dir>/one-shot-work/contract.json)",
    "  --out <path>                Receipt output path (default: <dir>/one-shot-work/GATE-RECEIPT.json)",
    "  --test-cmd <cmd>            Test command to execute",
    "  --build-cmd <cmd>           Build command to execute",
    "  --start-cmd <cmd>           Server start command (receives random PORT env)",
    "  --health-path <path>        Health endpoint path for server probe (default: /)",
    "  --protected-path <path>     Protected endpoint that must reject unauth with 401/403",
    "  --malformed-json-path <p>   Endpoint to probe with malformed JSON (default: protected or health)",
    "  --skip-browser              Skip optional Playwright browser check",
    "  -h, --help                  Show this help and exit 0",
  ].join("\n");
}

export async function runVerify(rawOpts) {
  const root = path.resolve(rawOpts.dir || ".");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`project directory not found: ${root}`);
  }

  const contractPath = rawOpts.contract
    ? path.resolve(rawOpts.contract)
    : path.join(root, "one-shot-work", "contract.json");
  let contract = null;
  const checks = [];

  if (fs.existsSync(contractPath)) {
    try {
      contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
      checks.push({ id: "contract-parse", status: "PASS", detail: `loaded ${path.relative(root, contractPath)}` });
    } catch (err) {
      checks.push({ id: "contract-parse", status: "FAIL", detail: `invalid JSON in ${contractPath}: ${err.message}` });
    }
  }

  const opts = {
    dir: root,
    testCmd: rawOpts.testCmd ?? contract?.testCmd ?? null,
    buildCmd: rawOpts.buildCmd ?? contract?.buildCmd ?? null,
    startCmd: rawOpts.startCmd ?? contract?.startCmd ?? null,
    healthPath: rawOpts.healthPath ?? contract?.healthPath ?? "/",
    protectedPath: rawOpts.protectedPath ?? contract?.protectedPath ?? null,
    malformedJsonPath: rawOpts.malformedJsonPath ?? contract?.malformedJsonPath ?? null,
    skipBrowser: Boolean(rawOpts.skipBrowser),
  };

  // 1. Deliverables exist on disk
  if (Array.isArray(contract?.deliverables) && contract.deliverables.length > 0) {
    const missing = contract.deliverables.filter((rel) => !fs.existsSync(path.join(root, rel)));
    checks.push({
      id: "deliverables",
      status: missing.length === 0 ? "PASS" : "FAIL",
      detail: missing.length === 0
        ? `${contract.deliverables.length}/${contract.deliverables.length} deliverable(s) present on disk`
        : `missing deliverable(s): ${missing.join(", ")}`,
    });
  }

  // 2. Contract acceptance criteria commands
  if (Array.isArray(contract?.criteria)) {
    for (const item of contract.criteria) {
      if (!item || !item.check) continue;
      const r = runShell(item.check, root);
      checks.push({
        id: `criterion-${item.id || "unnamed"}`,
        status: r.exitCode === 0 ? "PASS" : "FAIL",
        detail: r.exitCode === 0
          ? `${item.criterion || item.check} (exit 0)`
          : `${item.criterion || item.check} failed (exit ${r.exitCode}): ${(r.stderr || r.stdout || r.error || "").trim().slice(0, 200)}`,
      });
    }
  }

  // 3. Project build & test commands
  if (opts.buildCmd) {
    const r = runShell(opts.buildCmd, root);
    checks.push({
      id: "build",
      status: r.exitCode === 0 ? "PASS" : "FAIL",
      detail: r.exitCode === 0
        ? `build command exited 0`
        : `build failed (exit ${r.exitCode}): ${(r.stderr || r.stdout || r.error || "").trim().slice(0, 200)}`,
    });
  }
  if (opts.testCmd) {
    const r = runShell(opts.testCmd, root);
    checks.push({
      id: "tests",
      status: r.exitCode === 0 ? "PASS" : "FAIL",
      detail: r.exitCode === 0
        ? `test command exited 0`
        : `tests failed (exit ${r.exitCode}): ${(r.stderr || r.stdout || r.error || "").trim().slice(0, 200)}`,
    });
  }

  // 4. Live server probe
  if (opts.startCmd) {
    await probeServer(opts, checks);
  }

  // 5. Static security & hygiene checks (.env, secrets, visible HTML placeholders)
  const envPath = path.join(root, ".env");
  const gitignorePath = path.join(root, ".gitignore");
  const gitignoreText = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : "";
  if (fs.existsSync(envPath) && !gitignoreIgnoresEnv(gitignoreText)) {
    checks.push({
      id: "env-gitignore",
      status: "FAIL",
      detail: ".env exists at project root but .gitignore does not ignore .env",
    });
  } else {
    checks.push({
      id: "env-gitignore",
      status: "PASS",
      detail: fs.existsSync(envPath) ? ".env is ignored by .gitignore" : "no unignored .env at project root",
    });
  }

  const allFiles = walkFiles(root);
  const secretHits = [];
  const placeholderHits = [];
  for (const file of allFiles) {
    const ext = path.extname(file).toLowerCase();
    const rel = path.relative(root, file).replace(/\\/g, "/");
    if (CODE_AND_CONFIG_EXTS.has(ext)) {
      const raw = fs.readFileSync(file, "utf-8");
      const stripped = stripComments(raw, ext);
      const m = SECRET_RE.exec(stripped);
      if (m) secretHits.push(`${rel}: ${m[0].slice(0, 12)}...`);
      if (ext === ".html" || ext === ".htm") {
        const vis = visibleHtmlText(raw);
        for (const phrase of BANNED_HTML_PHRASES) {
          if (vis.includes(phrase)) placeholderHits.push(`${rel}: "${phrase}"`);
        }
      }
    }
  }

  checks.push({
    id: "secrets-scan",
    status: secretHits.length === 0 ? "PASS" : "FAIL",
    detail: secretHits.length === 0
      ? `no secret literals found across ${allFiles.length} file(s)`
      : `secret literal(s) found: ${secretHits.slice(0, 3).join("; ")}`,
  });

  checks.push({
    id: "placeholders-scan",
    status: placeholderHits.length === 0 ? "PASS" : "FAIL",
    detail: placeholderHits.length === 0
      ? "no banned placeholder copy in visible HTML"
      : `banned placeholder(s) in visible HTML: ${placeholderHits.slice(0, 3).join("; ")}`,
  });

  // 6. Optional browser check
  if (!opts.skipBrowser) {
    let pw = null;
    try { pw = await import("playwright"); } catch { pw = null; }
    if (!pw) {
      checks.push({
        id: "browser-check",
        status: "SKIPPED",
        detail: "playwright not installed in this environment",
      });
    } else {
      checks.push({
        id: "browser-check",
        status: "SKIPPED",
        detail: "playwright detected; pass --start-cmd or run dedicated UI spec for live viewport checks",
      });
    }
  }

  const summary = {
    pass: checks.filter((c) => c.status === "PASS").length,
    fail: checks.filter((c) => c.status === "FAIL").length,
    skipped: checks.filter((c) => c.status === "SKIPPED").length,
  };
  const receipt = {
    version: VERSION,
    status: summary.fail === 0 ? "PASS" : "BLOCKED",
    timestamp: new Date().toISOString(),
    projectDir: root,
    summary,
    checks,
  };

  const outPath = rawOpts.out
    ? path.resolve(rawOpts.out)
    : path.join(root, "one-shot-work", "GATE-RECEIPT.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n", "utf-8");

  return { receipt, outPath };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    console.error(usage());
    process.exit(2);
  }
  if (opts.help) {
    console.log(usage());
    process.exit(0);
  }
  try {
    const { receipt, outPath } = await runVerify(opts);
    for (const c of receipt.checks) {
      console.log(`${c.status.padEnd(7)} ${c.id}: ${c.detail}`);
    }
    console.log(`GATE: ${receipt.status} (${receipt.summary.pass} pass, ${receipt.summary.fail} fail, ${receipt.summary.skipped} skipped) -> ${outPath}`);
    process.exit(receipt.status === "PASS" ? 0 : 1);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(2);
  }
}

const isMain = Boolean(
  process.argv[1] &&
  fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))
);
if (isMain) {
  main();
}
