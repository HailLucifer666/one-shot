#!/usr/bin/env node
/**
 * one-shot v0.3.0 executable release-gate verifier.
 * Zero external dependencies — Node 20+ built-ins only.
 *
 * Produces a tamper-proof GATE-RECEIPT.json (with SHA-256 treeHash) and exits:
 *   0 = PASS (all executed checks passed, or --check-receipt verified fresh PASS)
 *   1 = BLOCKED (one or more checks failed, or receipt missing/stale/forged)
 *   2 = Operational / CLI usage error
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = "0.3.0";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".venv", "venv",
  "__pycache__", "one-shot-work", ".cache", "coverage",
]);

const CODE_AND_CONFIG_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".py", ".html", ".htm",
  ".vue", ".svelte", ".css", ".json", ".yaml", ".yml", ".toml", ".ini",
  ".cfg", ".sql", ".sh",
]);

const TEST_FILE_RE = /(?:^|\/)(?:test_|tests?\/)|(?:_test|\.test|\.spec)\./i;

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
const SQL_ERROR_RE = /(?:SQLITE_ERROR|syntax error at or near|PG::SyntaxError|mysql_fetch|ORA-\d{5}|OperationalError:)/i;

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

export function walkFiles(root) {
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

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function computeTreeHash(root) {
  const files = walkFiles(root);
  const contractFile = path.join(root, "one-shot-work", "contract.json");
  const all = fs.existsSync(contractFile) ? [...files, contractFile] : files;
  const hash = crypto.createHash("sha256");
  for (const full of all) {
    const rel = path.relative(root, full).replace(/\\/g, "/");
    hash.update(rel + "\0" + sha256File(full) + "\n");
  }
  return { treeHash: hash.digest("hex"), fileCount: files.length };
}

export function countTestDefinitions(root, allFiles = walkFiles(root)) {
  let total = 0;
  for (const file of allFiles) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const ext = path.extname(file).toLowerCase();
    if (!TEST_FILE_RE.test(rel)) continue;
    if (![".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".py"].includes(ext)) continue;
    const stripped = stripComments(fs.readFileSync(file, "utf-8"), ext);
    if (ext === ".py") {
      const m = stripped.match(/^\s*(?:async\s+)?def\s+test_\w+\s*\(/gm);
      if (m) total += m.length;
    } else {
      const m = stripped.match(/(?:^|[^\w$])(?:test|it)(?:\.(?:only|skip|todo))?\s*\(/gm);
      if (m) total += m.length;
    }
  }
  return total;
}

export function checkReceipt(root, outPath) {
  const receiptPath = outPath ? path.resolve(outPath) : path.join(root, "one-shot-work", "GATE-RECEIPT.json");
  if (!fs.existsSync(receiptPath)) {
    return { ok: false, code: "MISSING_RECEIPT", detail: `receipt not found at ${receiptPath}` };
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf-8"));
  } catch (err) {
    return { ok: false, code: "INVALID_RECEIPT", detail: `unreadable receipt: ${err.message}` };
  }
  if (receipt.status !== "PASS") {
    const failing = Array.isArray(receipt.checks)
      ? receipt.checks.filter((c) => c.status === "FAIL").map((c) => c.id).join(", ")
      : "unknown";
    return { ok: false, code: "GATE_BLOCKED", detail: `receipt status is ${receipt.status} (failing: ${failing})` };
  }
  const { treeHash } = computeTreeHash(root);
  if (!receipt.treeHash || receipt.treeHash !== treeHash) {
    return {
      ok: false,
      code: "STALE_OR_FORGED_RECEIPT",
      detail: `treeHash mismatch (receipt=${String(receipt.treeHash || "missing").slice(0, 12)}, live=${treeHash.slice(0, 12)}) — re-run verify.mjs`,
    };
  }
  return { ok: true, code: "OK", detail: `fresh PASS receipt verified (treeHash=${treeHash.slice(0, 12)})` };
}

function parseRgb(str) {
  const m = String(str || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function relativeLuminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(fgStr, bgStr) {
  const fg = parseRgb(fgStr);
  const bg = parseRgb(bgStr);
  if (!fg || !bg) return null;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function auditDomElements({ textNodes = [], controls = [], images = [] } = {}) {
  const contrastFails = [];
  for (const node of textNodes) {
    const ratio = contrastRatio(node.fg, node.bg);
    if (ratio === null) continue;
    const isLarge = node.fontSizePx >= 24 || (node.fontSizePx >= 18.66 && Number(node.fontWeight) >= 700);
    const minRatio = isLarge ? 3.0 : 4.5;
    if (ratio < minRatio) {
      contrastFails.push(`${node.selector || "text"} (${ratio.toFixed(2)}:1 < ${minRatio}:1)`);
    }
  }

  const deadControls = [];
  for (const ctrl of controls) {
    const href = ctrl.href === null || ctrl.href === undefined ? null : String(ctrl.href).trim();
    const isDeadHref = ctrl.tag === "a" && (href === "" || href === "#" || /^javascript:/i.test(href));
    const isZeroSized = typeof ctrl.width === "number" && typeof ctrl.height === "number" && (ctrl.width <= 0 || ctrl.height <= 0);
    if (isDeadHref) deadControls.push(`<a href="${href}"> "${(ctrl.text || "").slice(0, 24)}"`);
    else if (isZeroSized) deadControls.push(`<${ctrl.tag}> 0x0 "${(ctrl.text || "").slice(0, 24)}"`);
  }

  const assetFails = [];
  for (const img of images) {
    if (img.alt === null || img.alt === undefined) {
      assetFails.push(`missing alt on ${img.src || "<img>"}`);
    } else if (img.complete && img.naturalWidth === 0) {
      assetFails.push(`broken image ${img.src || "<img>"}`);
    }
  }

  return [
    {
      id: "browser-contrast",
      status: contrastFails.length === 0 ? "PASS" : "FAIL",
      detail: contrastFails.length === 0
        ? `all ${textNodes.length} checked text node(s) meet WCAG AA contrast`
        : `low contrast: ${contrastFails.slice(0, 3).join("; ")}`,
    },
    {
      id: "browser-dead-controls",
      status: deadControls.length === 0 ? "PASS" : "FAIL",
      detail: deadControls.length === 0
        ? `all ${controls.length} interactive control(s) wired and sized`
        : `dead control(s): ${deadControls.slice(0, 3).join("; ")}`,
    },
    {
      id: "browser-assets",
      status: assetFails.length === 0 ? "PASS" : "FAIL",
      detail: assetFails.length === 0
        ? `all ${images.length} image(s) loaded with alt text`
        : `asset issue(s): ${assetFails.slice(0, 3).join("; ")}`,
    },
  ];
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

async function runBrowserCheck(pw, targetUrl, checks) {
  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    const overflows = [];
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(targetUrl, { waitUntil: "load", timeout: 15_000 });
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      if (hasOverflow) overflows.push(`${width}px`);
    }

    const domSnapshot = await page.evaluate(() => {
      function effectiveBg(el) {
        let cur = el;
        while (cur && cur.nodeType === 1) {
          const bg = getComputedStyle(cur).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
          cur = cur.parentElement;
        }
        return "rgb(255, 255, 255)";
      }
      const textNodes = [];
      for (const el of Array.from(document.querySelectorAll("h1,h2,h3,p,a,button,label,li,span")).slice(0, 80)) {
        const txt = (el.textContent || "").trim();
        const r = el.getBoundingClientRect();
        if (!txt || r.width === 0 || r.height === 0) continue;
        const st = getComputedStyle(el);
        textNodes.push({
          selector: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/)[0] : ""),
          fg: st.color,
          bg: effectiveBg(el),
          fontSizePx: parseFloat(st.fontSize) || 16,
          fontWeight: parseInt(st.fontWeight, 10) || 400,
        });
      }
      const controls = Array.from(document.querySelectorAll("a,button")).slice(0, 80).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          href: el.getAttribute("href"),
          text: (el.textContent || "").trim(),
          width: r.width,
          height: r.height,
        };
      });
      const images = Array.from(document.querySelectorAll("img")).slice(0, 50).map((img) => ({
        src: img.getAttribute("src"),
        alt: img.getAttribute("alt"),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
      }));
      return { textNodes, controls, images };
    });

    checks.push({
      id: "browser-console",
      status: consoleErrors.length === 0 ? "PASS" : "FAIL",
      detail: consoleErrors.length === 0
        ? `0 console/page errors on ${targetUrl}`
        : `${consoleErrors.length} error(s): ${consoleErrors.slice(0, 2).join("; ").slice(0, 200)}`,
    });
    checks.push({
      id: "browser-overflow",
      status: overflows.length === 0 ? "PASS" : "FAIL",
      detail: overflows.length === 0
        ? "no horizontal overflow at 360/768/1280px"
        : `horizontal overflow detected at ${overflows.join(", ")}`,
    });
    checks.push(...auditDomElements(domSnapshot));
  } catch (err) {
    checks.push({
      id: "browser-check",
      status: "FAIL",
      detail: `browser check failed: ${err.message}`,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function probeServer(opts, checks, pw = null) {
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

    // Slice 3: Hostile payload fuzzing (XSS, SQLi, prototype pollution)
    if (Array.isArray(opts.fuzzPaths) && opts.fuzzPaths.length > 0) {
      const payloads = [
        { name: "xss", body: JSON.stringify({ title: '"><script>alert(1)</script>', q: '"><img src=x onerror=alert(1)>' }) },
        { name: "sqli", body: JSON.stringify({ title: "' OR '1'='1", q: "' UNION SELECT null--" }) },
        { name: "proto", body: '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}}}' },
      ];
      const fuzzFails = [];
      for (const p of opts.fuzzPaths) {
        for (const payload of payloads) {
          const res = await httpRequest(port, "POST", p, payload.body, { "Content-Type": "application/json" });
          const ctype = String(res.headers["content-type"] || "").toLowerCase();
          if (res.status >= 500) {
            fuzzFails.push(`${p} [${payload.name}] -> HTTP ${res.status}`);
          } else if (STACK_TRACE_RE.test(res.body) || SQL_ERROR_RE.test(res.body)) {
            fuzzFails.push(`${p} [${payload.name}] leaked internal error`);
          } else if (ctype.includes("text/html") && (res.body.includes("<script>alert(1)</script>") || res.body.includes("onerror=alert(1)"))) {
            fuzzFails.push(`${p} [${payload.name}] reflected unescaped HTML`);
          }
        }
      }
      checks.push({
        id: "server-fuzz",
        status: fuzzFails.length === 0 ? "PASS" : "FAIL",
        detail: fuzzFails.length === 0
          ? `${opts.fuzzPaths.length} endpoint(s) survived XSS/SQLi/proto-pollution fuzzing`
          : `fuzz failure(s): ${fuzzFails.slice(0, 3).join("; ")}`,
      });
    }

    // Slice 3: Declarative multi-user IDOR probe
    if (opts.idorProbe && opts.idorProbe.createPath && opts.idorProbe.resourcePathTemplate) {
      const ip = opts.idorProbe;
      const created = await httpRequest(
        port,
        ip.method || "POST",
        ip.createPath,
        JSON.stringify(ip.body || { title: "idor-probe" }),
        { "Content-Type": "application/json", ...(ip.userAHeaders || {}) }
      );
      let createdId = null;
      try {
        const parsed = JSON.parse(created.body);
        createdId = parsed?.id ?? parsed?.data?.id ?? parsed?.item?.id ?? null;
      } catch { /* handled below */ }
      if (created.status < 200 || created.status >= 300 || createdId === null) {
        checks.push({
          id: "server-idor",
          status: "FAIL",
          detail: `User A create at ${ip.createPath} failed (HTTP ${created.status}, id=${createdId})`,
        });
      } else {
        const targetPath = ip.resourcePathTemplate.replace("{id}", encodeURIComponent(String(createdId)));
        const cross = await httpRequest(port, "GET", targetPath, null, ip.userBHeaders || {});
        const blocked = cross.status === 401 || cross.status === 403 || cross.status === 404;
        checks.push({
          id: "server-idor",
          status: blocked ? "PASS" : "FAIL",
          detail: `User B GET ${targetPath} -> HTTP ${cross.status} (expected 401/403/404)`,
        });
      }
    }

    if (pw && !opts.skipBrowser) {
      await runBrowserCheck(pw, `http://127.0.0.1:${port}${healthPath}`, checks);
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
    checkReceipt: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") { opts.help = true; continue; }
    if (arg === "--skip-browser") { opts.skipBrowser = true; continue; }
    if (arg === "--check-receipt") { opts.checkReceipt = true; continue; }
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
    "  --check-receipt             Fast tamper/freshness check of existing GATE-RECEIPT.json against treeHash",
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
    fuzzPaths: contract?.fuzzPaths ?? null,
    idorProbe: contract?.idorProbe ?? null,
    skipBrowser: Boolean(rawOpts.skipBrowser),
  };

  const allFiles = walkFiles(root);

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

  // Slice 2: Brownfield diff-scope & test-count floor
  const baselinePath = path.join(root, "one-shot-work", "baseline.json");
  let baseline = null;
  if (fs.existsSync(baselinePath)) {
    try { baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8")); } catch { baseline = null; }
  }

  if (Array.isArray(contract?.allowedFiles) || Array.isArray(contract?.protectedFiles)) {
    if (!baseline || !baseline.files) {
      checks.push({
        id: "diff-scope",
        status: "FAIL",
        detail: "allowedFiles/protectedFiles configured but one-shot-work/baseline.json is missing",
      });
    } else {
      const allowed = Array.isArray(contract.allowedFiles)
        ? new Set(contract.allowedFiles.map((p) => p.replace(/\\/g, "/")))
        : null;
      const protectedSet = new Set((contract.protectedFiles || []).map((p) => p.replace(/\\/g, "/")));
      const currentMap = new Map(allFiles.map((f) => [path.relative(root, f).replace(/\\/g, "/"), sha256File(f)]));
      const violations = [];
      for (const [rel, origSha] of Object.entries(baseline.files)) {
        const curSha = currentMap.get(rel);
        const changed = curSha !== origSha;
        if (changed && protectedSet.has(rel)) violations.push(`protected file modified: ${rel}`);
        else if (changed && allowed && !allowed.has(rel)) violations.push(`unwhitelisted edit: ${rel}`);
      }
      if (allowed) {
        for (const rel of currentMap.keys()) {
          if (!(rel in baseline.files) && !allowed.has(rel)) {
            violations.push(`unwhitelisted new file: ${rel}`);
          }
        }
      }
      checks.push({
        id: "diff-scope",
        status: violations.length === 0 ? "PASS" : "FAIL",
        detail: violations.length === 0
          ? "all changes stay within allowedFiles / protectedFiles stay byte-identical"
          : violations.slice(0, 3).join("; "),
      });
    }
  }

  if (typeof contract?.minTestCount === "number" || typeof contract?.minTestDelta === "number") {
    const required = Math.max(
      typeof contract.minTestCount === "number" ? contract.minTestCount : 0,
      (typeof baseline?.testCount === "number" ? baseline.testCount : 0) +
        (typeof contract.minTestDelta === "number" ? contract.minTestDelta : 0)
    );
    const actual = countTestDefinitions(root, allFiles);
    checks.push({
      id: "test-count-floor",
      status: actual >= required ? "PASS" : "FAIL",
      detail: `${actual} non-commented test definition(s) found (required >= ${required})`,
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

  // Load optional Playwright once if browser check is enabled
  let pw = null;
  if (!opts.skipBrowser) {
    try { pw = await import("playwright"); } catch { pw = null; }
  }

  // 4. Live server probe (also runs fuzz/IDOR + Playwright against live URL if available)
  if (opts.startCmd) {
    await probeServer(opts, checks, pw);
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

  // 6. Optional browser check (for static HTML when no live server ran)
  if (!opts.skipBrowser) {
    if (!pw) {
      checks.push({
        id: "browser-check",
        status: "SKIPPED",
        detail: "playwright not installed in this environment",
      });
    } else if (!opts.startCmd) {
      const indexHtml = allFiles.find((f) => path.basename(f).toLowerCase() === "index.html");
      if (indexHtml) {
        await runBrowserCheck(pw, pathToFileURL(indexHtml).href, checks);
      } else {
        checks.push({
          id: "browser-check",
          status: "SKIPPED",
          detail: "no startCmd or index.html to open in browser",
        });
      }
    }
  }

  const { treeHash, fileCount } = computeTreeHash(root);
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
    treeHash,
    fileCount,
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
  if (opts.checkReceipt) {
    const root = path.resolve(opts.dir || ".");
    const r = checkReceipt(root, opts.out);
    if (r.ok) {
      console.log(`RECEIPT: ${r.code} — ${r.detail}`);
      process.exit(0);
    }
    console.error(`RECEIPT: ${r.code} — ${r.detail}`);
    process.exit(1);
  }
  try {
    const { receipt, outPath } = await runVerify(opts);
    for (const c of receipt.checks) {
      console.log(`${c.status.padEnd(7)} ${c.id}: ${c.detail}`);
    }
    console.log(`GATE: ${receipt.status} (${receipt.summary.pass} pass, ${receipt.summary.fail} fail, ${receipt.summary.skipped} skipped, treeHash=${receipt.treeHash.slice(0, 12)}) -> ${outPath}`);
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
