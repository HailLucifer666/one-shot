import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERIFY = path.join(__dirname, "verify.mjs");

function makeTmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-verify-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }
  return dir;
}

function runCli(args) {
  return spawnSync(process.execPath, [VERIFY, ...args], {
    encoding: "utf-8",
    timeout: 30_000,
  });
}

test("--help exits 0 and prints usage", () => {
  const res = runCli(["--help"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /one-shot verify v0\.3\.0/);
  assert.match(res.stdout, /--contract/);
});

test("passing project writes PASS GATE-RECEIPT.json and exits 0", () => {
  const dir = makeTmpProject({
    "index.html": "<!doctype html><html><body><h1>Acme</h1><!-- lorem ipsum --></body></html>\n",
    ".gitignore": ".env\n",
    ".env": "SECRET=local-only\n",
    "one-shot-work/contract.json": JSON.stringify({
      deliverables: ["index.html"],
      testCmd: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
      criteria: [
        { id: "c1", criterion: "index exists", check: `${JSON.stringify(process.execPath)} -e "process.exit(0)"` },
      ],
    }),
  });
  try {
    const res = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, "one-shot-work", "GATE-RECEIPT.json"), "utf-8"));
    assert.equal(receipt.status, "PASS");
    assert.equal(receipt.summary.fail, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing deliverable blocks gate with exit 1", () => {
  const dir = makeTmpProject({
    "one-shot-work/contract.json": JSON.stringify({
      deliverables: ["dist/app.js"],
    }),
  });
  try {
    const res = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, "one-shot-work", "GATE-RECEIPT.json"), "utf-8"));
    assert.equal(receipt.status, "BLOCKED");
    assert.ok(receipt.checks.some((c) => c.id === "deliverables" && c.status === "FAIL"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("failing testCmd blocks gate with exit 1", () => {
  const dir = makeTmpProject({
    "app.js": "console.log('hi');\n",
    "one-shot-work/contract.json": JSON.stringify({
      deliverables: ["app.js"],
      testCmd: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`,
    }),
  });
  try {
    const res = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, "one-shot-work", "GATE-RECEIPT.json"), "utf-8"));
    assert.equal(receipt.status, "BLOCKED");
    assert.ok(receipt.checks.some((c) => c.id === "tests" && c.status === "FAIL"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unignored .env (including .env.local-only gitignore) blocks gate", () => {
  const dir = makeTmpProject({
    ".gitignore": ".env.local\n",
    ".env": "DB=postgres://u:p@h/d\n",
  });
  try {
    const res = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, "one-shot-work", "GATE-RECEIPT.json"), "utf-8"));
    assert.equal(receipt.status, "BLOCKED");
    assert.ok(receipt.checks.some((c) => c.id === "env-gitignore" && c.status === "FAIL"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("secret literal after same-line https:// URL blocks gate, while JS comment stays clean", () => {
  const badDir = makeTmpProject({
    "server.mjs": 'const u = "https://localhost/api"; const k = "sk-abcdefghijklmnopqrstuvwx";\n',
  });
  const okDir = makeTmpProject({
    "server.mjs": '// example only: sk-abcdefghijklmnopqrstuvwx\nconst u = "https://localhost/api";\n',
  });
  try {
    const bad = runCli(["--dir", badDir, "--skip-browser"]);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /FAIL\s+secrets-scan/);

    const ok = runCli(["--dir", okDir, "--skip-browser"]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /PASS\s+secrets-scan/);
  } finally {
    fs.rmSync(badDir, { recursive: true, force: true });
    fs.rmSync(okDir, { recursive: true, force: true });
  }
});

test("banned placeholder in visible HTML blocks gate, while script/comment mention passes", () => {
  const badDir = makeTmpProject({
    "index.html": "<html><body><p>Lorem ipsum dolor sit amet</p></body></html>\n",
  });
  const okDir = makeTmpProject({
    "index.html": "<html><body><!-- lorem ipsum --><script>// lorem ipsum</script><p>Real copy</p></body></html>\n",
  });
  try {
    const bad = runCli(["--dir", badDir, "--skip-browser"]);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /FAIL\s+placeholders-scan/);

    const ok = runCli(["--dir", okDir, "--skip-browser"]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /PASS\s+placeholders-scan/);
  } finally {
    fs.rmSync(badDir, { recursive: true, force: true });
    fs.rmSync(okDir, { recursive: true, force: true });
  }
});

test("live server probe passes clean server and blocks auth bypass or stack-trace leak", () => {
  const goodServer = `
    import http from "node:http";
    const s = http.createServer((req, res) => {
      if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
      if (req.url === "/api/private") {
        if (req.method === "POST") { res.writeHead(400); res.end("bad json"); return; }
        res.writeHead(401); res.end("unauthorized"); return;
      }
      res.writeHead(404); res.end("not found");
    });
    s.listen(Number(process.env.PORT), "127.0.0.1");
  `;
  const leakyServer = `
    import http from "node:http";
    const s = http.createServer((req, res) => {
      if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
      if (req.url === "/api/private" && req.method === "GET") { res.writeHead(200); res.end("secret data"); return; }
      res.writeHead(500); res.end("SyntaxError: bad json\\n    at Object.parse (file.js:1:1)");
    });
    s.listen(Number(process.env.PORT), "127.0.0.1");
  `;
  const goodDir = makeTmpProject({ "server.mjs": goodServer });
  const leakyDir = makeTmpProject({ "server.mjs": leakyServer });
  try {
    const good = runCli([
      "--dir", goodDir, "--skip-browser",
      "--start-cmd", `${JSON.stringify(process.execPath)} server.mjs`,
      "--health-path", "/health",
      "--protected-path", "/api/private",
    ]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /PASS\s+server-health/);
    assert.match(good.stdout, /PASS\s+server-malformed-json/);
    assert.match(good.stdout, /PASS\s+server-auth-guard/);

    const leaky = runCli([
      "--dir", leakyDir, "--skip-browser",
      "--start-cmd", `${JSON.stringify(process.execPath)} server.mjs`,
      "--health-path", "/health",
      "--protected-path", "/api/private",
    ]);
    assert.equal(leaky.status, 1, leaky.stdout + leaky.stderr);
    assert.match(leaky.stdout, /FAIL\s+server-malformed-json/);
    assert.match(leaky.stdout, /FAIL\s+server-auth-guard/);
  } finally {
    fs.rmSync(goodDir, { recursive: true, force: true });
    fs.rmSync(leakyDir, { recursive: true, force: true });
  }
});

test("Slice 1: treeHash and --check-receipt detect stale edits, new files, and forged receipts", () => {
  const dir = makeTmpProject({
    "app.js": "console.log('v1');\n",
  });
  try {
    // Missing receipt -> exit 1 (MISSING_RECEIPT)
    const missing = runCli(["--dir", dir, "--check-receipt"]);
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stdout + missing.stderr, /MISSING_RECEIPT/);

    // Real PASS run writes treeHash
    const pass = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    const receiptPath = path.join(dir, "one-shot-work", "GATE-RECEIPT.json");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf-8"));
    assert.match(receipt.treeHash || "", /^[0-9a-f]{64}$/);

    // Fresh receipt -> --check-receipt exits 0
    const fresh = runCli(["--dir", dir, "--check-receipt"]);
    assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);

    // 1-byte edit after PASS -> --check-receipt exits 1 (STALE_OR_FORGED_RECEIPT)
    fs.writeFileSync(path.join(dir, "app.js"), "console.log('v2');\n");
    const stale = runCli(["--dir", dir, "--check-receipt"]);
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    assert.match(stale.stdout + stale.stderr, /STALE_OR_FORGED_RECEIPT/);

    // Forged receipt with bogus treeHash -> exits 1
    fs.writeFileSync(receiptPath, JSON.stringify({
      version: receipt.version,
      status: "PASS",
      treeHash: "0".repeat(64),
    }));
    const forged = runCli(["--dir", dir, "--check-receipt"]);
    assert.equal(forged.status, 1, forged.stdout + forged.stderr);
    assert.match(forged.stdout + forged.stderr, /STALE_OR_FORGED_RECEIPT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Slice 2: brownfield diff-scope blocks unwhitelisted edits and test-count-floor ignores commented tests", async () => {
  const { createHash } = await import("node:crypto");
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const origHtml = "<h1>Notes</h1>\n";
  const origServer = "export const ok = true;\n";
  const origTest = 'test("existing 1", () => {});\n';

  const dir = makeTmpProject({
    "public/index.html": origHtml,
    "server.js": origServer,
    "tests/app.test.js": origTest,
    "one-shot-work/baseline.json": JSON.stringify({
      files: {
        "public/index.html": sha(origHtml),
        "server.js": sha(origServer),
        "tests/app.test.js": sha(origTest),
      },
      testCount: 1,
    }),
    "one-shot-work/contract.json": JSON.stringify({
      allowedFiles: ["server.js", "tests/app.test.js"],
      minTestCount: 3,
    }),
  });
  try {
    // 1. Touch non-whitelisted file + add commented-out fake tests -> both FAIL
    fs.writeFileSync(path.join(dir, "public/index.html"), "<h1>Tampered</h1>\n");
    fs.writeFileSync(
      path.join(dir, "tests/app.test.js"),
      origTest + '// test("fake 2", () => {});\n// test("fake 3", () => {});\n'
    );
    const bad = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /FAIL\s+diff-scope/);
    assert.match(bad.stdout, /FAIL\s+test-count-floor/);

    // 2. Restore index.html, edit only server.js, add 2 real tests -> PASS
    fs.writeFileSync(path.join(dir, "public/index.html"), origHtml);
    fs.writeFileSync(path.join(dir, "server.js"), "export const ok = 'fixed';\n");
    fs.writeFileSync(
      path.join(dir, "tests/app.test.js"),
      origTest + 'test("real 2", () => {});\ntest("real 3", () => {});\n'
    );
    const ok = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /PASS\s+diff-scope/);
    assert.match(ok.stdout, /PASS\s+test-count-floor/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Slice 3: server-fuzz catches reflected XSS / SQL errors and server-idor catches cross-user read", () => {
  const vulnServer = `
    import http from "node:http";
    const items = new Map();
    let seq = 1;
    const s = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
        if (req.url === "/api/search" && req.method === "POST") {
          if (body.includes("<script>")) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<p>" + body + "</p>");
            return;
          }
          if (body.includes("OR '1'='1")) {
            res.writeHead(500); res.end("SQLITE_ERROR: near syntax"); return;
          }
          res.writeHead(400); res.end("bad"); return;
        }
        if (req.url === "/api/items" && req.method === "POST") {
          const id = String(seq++);
          items.set(id, { id, owner: req.headers["x-user"] });
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id }));
          return;
        }
        if (req.url.startsWith("/api/items/") && req.method === "GET") {
          const id = req.url.split("/").pop();
          if (items.has(id)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(items.get(id)));
            return;
          }
        }
        res.writeHead(404); res.end("not found");
      });
    });
    s.listen(Number(process.env.PORT), "127.0.0.1");
  `;
  const safeServer = `
    import http from "node:http";
    const items = new Map();
    let seq = 1;
    const s = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
        if (req.url === "/api/search" && req.method === "POST") {
          try { JSON.parse(body); } catch { res.writeHead(400); res.end("bad json"); return; }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ results: [] }));
          return;
        }
        if (req.url === "/api/items" && req.method === "POST") {
          const id = String(seq++);
          items.set(id, { id, owner: req.headers["x-user"] });
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id }));
          return;
        }
        if (req.url.startsWith("/api/items/") && req.method === "GET") {
          const id = req.url.split("/").pop();
          const item = items.get(id);
          if (!item) { res.writeHead(404); res.end("not found"); return; }
          if (item.owner !== req.headers["x-user"]) { res.writeHead(403); res.end("forbidden"); return; }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(item));
          return;
        }
        res.writeHead(404); res.end("not found");
      });
    });
    s.listen(Number(process.env.PORT), "127.0.0.1");
  `;
  const contract = JSON.stringify({
    startCmd: `${JSON.stringify(process.execPath)} server.mjs`,
    healthPath: "/health",
    fuzzPaths: ["/api/search"],
    idorProbe: {
      createPath: "/api/items",
      method: "POST",
      body: { title: "secret" },
      userAHeaders: { "x-user": "alice" },
      userBHeaders: { "x-user": "bob" },
      resourcePathTemplate: "/api/items/{id}",
    },
  });
  const vulnDir = makeTmpProject({ "server.mjs": vulnServer, "one-shot-work/contract.json": contract });
  const safeDir = makeTmpProject({ "server.mjs": safeServer, "one-shot-work/contract.json": contract });
  try {
    const vuln = runCli(["--dir", vulnDir, "--skip-browser"]);
    assert.equal(vuln.status, 1, vuln.stdout + vuln.stderr);
    assert.match(vuln.stdout, /FAIL\s+server-fuzz/);
    assert.match(vuln.stdout, /FAIL\s+server-idor/);

    const safe = runCli(["--dir", safeDir, "--skip-browser"]);
    assert.equal(safe.status, 0, safe.stdout + safe.stderr);
    assert.match(safe.stdout, /PASS\s+server-fuzz/);
    assert.match(safe.stdout, /PASS\s+server-idor/);
  } finally {
    fs.rmSync(vulnDir, { recursive: true, force: true });
    fs.rmSync(safeDir, { recursive: true, force: true });
  }
});

test("Slice 4: auditDomElements flags low WCAG contrast, dead controls, and broken/alt-less images", async () => {
  const mod = await import("./verify.mjs");
  assert.equal(typeof mod.auditDomElements, "function", "auditDomElements must be exported");

  const badChecks = mod.auditDomElements({
    textNodes: [
      { selector: "p.muted", fg: "rgb(153, 153, 153)", bg: "rgb(255, 255, 255)", fontSizePx: 16, fontWeight: 400 },
    ],
    controls: [
      { tag: "a", href: "#", text: "Learn more", width: 100, height: 32 },
    ],
    images: [
      { src: "hero.png", alt: null, complete: true, naturalWidth: 0 },
    ],
  });
  assert.ok(badChecks.some((c) => c.id === "browser-contrast" && c.status === "FAIL"));
  assert.ok(badChecks.some((c) => c.id === "browser-dead-controls" && c.status === "FAIL"));
  assert.ok(badChecks.some((c) => c.id === "browser-assets" && c.status === "FAIL"));

  // Adjacent false-positive guard: accessible high-contrast DOM passes all 3
  const goodChecks = mod.auditDomElements({
    textNodes: [
      { selector: "body", fg: "rgb(30, 22, 18)", bg: "rgb(250, 245, 238)", fontSizePx: 16, fontWeight: 400 },
      { selector: "h1", fg: "rgb(117, 117, 117)", bg: "rgb(255, 255, 255)", fontSizePx: 32, fontWeight: 700 },
    ],
    controls: [
      { tag: "a", href: "#demo", text: "Book demo", width: 120, height: 40 },
      { tag: "button", href: null, text: "Submit", width: 80, height: 36 },
    ],
    images: [
      { src: "hero.png", alt: "Coffee counter", complete: true, naturalWidth: 800 },
    ],
  });
  assert.ok(goodChecks.every((c) => c.status === "PASS"), JSON.stringify(goodChecks));
});

test("V1: checkReceipt rejects forged PASS with failing/empty checks and baseline.json tampering invalidates treeHash", async () => {
  const mod = await import("./verify.mjs");
  const dir = makeTmpProject({
    "app.js": "console.log(1);\n",
    "one-shot-work/baseline.json": JSON.stringify({ files: { "app.js": "abc" }, testCount: 5 }),
    "one-shot-work/contract.json": JSON.stringify({ deliverables: ["app.js"], criteria: [] }),
  });
  try {
    const { treeHash } = mod.computeTreeHash(dir);
    const receiptPath = path.join(dir, "one-shot-work", "GATE-RECEIPT.json");

    // Forged receipt with FAIL check inside checks[]
    fs.writeFileSync(receiptPath, JSON.stringify({
      status: "PASS",
      treeHash,
      summary: { pass: 1, fail: 1, skipped: 0 },
      checks: [{ id: "deliverables", status: "FAIL", detail: "missing" }],
    }));
    const badFail = mod.checkReceipt(dir);
    assert.equal(badFail.ok, false, "forged receipt containing FAIL check must be rejected");

    // Forged receipt with empty checks[]
    fs.writeFileSync(receiptPath, JSON.stringify({
      status: "PASS",
      treeHash,
      summary: { pass: 0, fail: 0, skipped: 0 },
      checks: [],
    }));
    const badEmpty = mod.checkReceipt(dir);
    assert.equal(badEmpty.ok, false, "forged receipt with empty checks must be rejected");

    // Real PASS run succeeds, then tampering baseline.json must invalidate treeHash
    const pass = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.equal(mod.checkReceipt(dir).ok, true);

    fs.writeFileSync(path.join(dir, "one-shot-work", "baseline.json"), JSON.stringify({ files: {}, testCount: 0 }));
    const afterTamper = mod.checkReceipt(dir);
    assert.equal(afterTamper.ok, false, "tampering baseline.json must invalidate treeHash");
    assert.equal(afterTamper.code, "STALE_OR_FORGED_RECEIPT");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("V2: secrets-scan catches sk-proj-/sk-ant- keys and Python # inside strings, while real # comments pass", () => {
  const modernKeyDir = makeTmpProject({
    "app.js": 'const k1 = "sk-proj-abc123def456ghi789jkl012mno345";\nconst k2 = "sk-ant-api03-abc123def456ghi789jkl012";\n',
  });
  const pyHashStringDir = makeTmpProject({
    "app.py": 'COLOR = "#ffffff"; KEY = "AKIAIOSFODNN7EXAMPLE"\n',
  });
  const pyRealCommentDir = makeTmpProject({
    "app.py": 'COLOR = "#ffffff"  # example only: AKIAIOSFODNN7EXAMPLE\n',
  });
  try {
    const r1 = runCli(["--dir", modernKeyDir, "--skip-browser"]);
    assert.equal(r1.status, 1, r1.stdout + r1.stderr);
    assert.match(r1.stdout, /FAIL\s+secrets-scan/);

    const r2 = runCli(["--dir", pyHashStringDir, "--skip-browser"]);
    assert.equal(r2.status, 1, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /FAIL\s+secrets-scan/);

    const r3 = runCli(["--dir", pyRealCommentDir, "--skip-browser"]);
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    assert.match(r3.stdout, /PASS\s+secrets-scan/);
  } finally {
    fs.rmSync(modernKeyDir, { recursive: true, force: true });
    fs.rmSync(pyHashStringDir, { recursive: true, force: true });
    fs.rmSync(pyRealCommentDir, { recursive: true, force: true });
  }
});

test("V4: server-fuzz catches headerless reflected XSS and server-idor fails when User A control returns 404 or User B DELETE succeeds", () => {
  const headerlessXssAndIdor = `
    import http from "node:http";
    const items = new Map();
    let seq = 1;
    const s = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
        if (req.url === "/api/search" && req.method === "POST") {
          res.writeHead(200); // no Content-Type header
          res.end("<p>" + body + "</p>");
          return;
        }
        if (req.url === "/api/items" && req.method === "POST") {
          const id = String(seq++);
          items.set(id, { id, owner: req.headers["x-user"] });
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id }));
          return;
        }
        if (req.url.startsWith("/api/items/") && req.method === "GET") {
          const id = req.url.split("/").pop();
          const item = items.get(id);
          if (!item) { res.writeHead(404); res.end("not found"); return; }
          if (item.owner !== req.headers["x-user"]) { res.writeHead(403); res.end("forbidden"); return; }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(item));
          return;
        }
        if (req.url.startsWith("/api/items/") && req.method === "DELETE") {
          // Vulnerable: allows User B to delete User A's item!
          res.writeHead(200); res.end("deleted"); return;
        }
        res.writeHead(404); res.end("not found");
      });
    });
    s.listen(Number(process.env.PORT), "127.0.0.1");
  `;
  const dir1 = makeTmpProject({
    "server.mjs": headerlessXssAndIdor,
    "one-shot-work/contract.json": JSON.stringify({
      startCmd: `${JSON.stringify(process.execPath)} server.mjs`,
      healthPath: "/health",
      fuzzPaths: ["/api/search"],
      idorProbe: {
        createPath: "/api/items",
        resourcePathTemplate: "/api/items/{id}",
        userAHeaders: { "x-user": "alice" },
        userBHeaders: { "x-user": "bob" },
      },
    }),
  });
  const dir2 = makeTmpProject({
    "server.mjs": headerlessXssAndIdor,
    "one-shot-work/contract.json": JSON.stringify({
      startCmd: `${JSON.stringify(process.execPath)} server.mjs`,
      healthPath: "/health",
      idorProbe: {
        createPath: "/api/items",
        resourcePathTemplate: "/api/wrong-route/{id}",
        userAHeaders: { "x-user": "alice" },
        userBHeaders: { "x-user": "bob" },
      },
    }),
  });
  try {
    const r1 = runCli(["--dir", dir1, "--skip-browser"]);
    assert.equal(r1.status, 1, r1.stdout + r1.stderr);
    assert.match(r1.stdout, /FAIL\s+server-fuzz/);
    assert.match(r1.stdout, /FAIL\s+server-idor/);

    const r2 = runCli(["--dir", dir2, "--skip-browser"]);
    assert.equal(r2.status, 1, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /FAIL\s+server-idor/);
  } finally {
    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test("V5: countTestDefinitions excludes skip/todo/strings and minTestDelta fails without baseline.json", async () => {
  const mod = await import("./verify.mjs");
  const dir = makeTmpProject({
    "tests/app.test.js": [
      'test.skip("skipped", () => {});',
      'it.todo("todo");',
      'const fake = "test(\\"in-str\\", () => {}); it(\\"in-str2\\", () => {});";',
      'test("real1", () => {});',
    ].join("\n") + "\n",
    "one-shot-work/contract.json": JSON.stringify({ minTestDelta: 1 }),
  });
  try {
    assert.equal(mod.countTestDefinitions(dir), 1, "only active non-string test must be counted");
    const r = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL\s+test-count-floor/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("V6 & V16: deliverables rejects traversal/directories, diff-scope normalizes ./, and malformed criteria fail loudly", async () => {
  const { createHash } = await import("node:crypto");
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const badDeliv = makeTmpProject({
    "one-shot-work/contract.json": JSON.stringify({
      deliverables: [".", "../"],
      criteria: [{ id: "c1", criterion: "typo", cmd: "echo oops" }],
    }),
  });
  const normScope = makeTmpProject({
    "server.js": "export const x = 2;\n",
    "one-shot-work/baseline.json": JSON.stringify({ files: { "server.js": sha("export const x = 1;\n") }, testCount: 0 }),
    "one-shot-work/contract.json": JSON.stringify({ allowedFiles: ["./server.js"] }),
  });
  try {
    const r1 = runCli(["--dir", badDeliv, "--skip-browser"]);
    assert.equal(r1.status, 1, r1.stdout + r1.stderr);
    assert.match(r1.stdout, /FAIL\s+deliverables/);
    assert.match(r1.stdout, /FAIL\s+criterion-c1/);

    const r2 = runCli(["--dir", normScope, "--skip-browser"]);
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /PASS\s+diff-scope/);
  } finally {
    fs.rmSync(badDeliv, { recursive: true, force: true });
    fs.rmSync(normScope, { recursive: true, force: true });
  }
});

test("V7: contrastRatio alpha-composites rgba() and auditDomElements flags unloaded images", async () => {
  const mod = await import("./verify.mjs");
  const ratio = mod.contrastRatio("rgba(0, 0, 0, 0.1)", "rgb(255, 255, 255)");
  assert.ok(ratio !== null && ratio < 2.0, `expected translucent text ratio < 2.0, got ${ratio}`);
  const checks = mod.auditDomElements({
    textNodes: [{ selector: "p.ghost", fg: "rgba(0, 0, 0, 0.1)", bg: "rgb(255, 255, 255)", fontSizePx: 16, fontWeight: 400 }],
    images: [{ src: "slow.png", alt: "ok", complete: false, naturalWidth: 0 }],
  });
  assert.ok(checks.some((c) => c.id === "browser-contrast" && c.status === "FAIL"));
  assert.ok(checks.some((c) => c.id === "browser-assets" && c.status === "FAIL"));
});

test("V8: env-gitignore accepts **/.env and catches nested unignored backend/.env", () => {
  const okGlob = makeTmpProject({ ".gitignore": "**/.env\n", ".env": "S=1\n" });
  const badNested = makeTmpProject({ ".gitignore": "", "backend/.env": "S=1\n" });
  try {
    const r1 = runCli(["--dir", okGlob, "--skip-browser"]);
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.match(r1.stdout, /PASS\s+env-gitignore/);

    const r2 = runCli(["--dir", badNested, "--skip-browser"]);
    assert.equal(r2.status, 1, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /FAIL\s+env-gitignore/);
  } finally {
    fs.rmSync(okGlob, { recursive: true, force: true });
    fs.rmSync(badNested, { recursive: true, force: true });
  }
});

test("REV: ..foo deliverable is allowed inside root and /re/.test(x) is not counted as a test definition", async () => {
  const mod = await import("./verify.mjs");
  const dir = makeTmpProject({
    "..foo": "valid filename starting with two dots\n",
    "tests/regex.test.js": 'const ok = /abc/.test("abc");\ntest("real", () => { if (!ok) throw new Error(); });\n',
    "one-shot-work/contract.json": JSON.stringify({ deliverables: ["..foo"], criteria: [] }),
  });
  try {
    assert.equal(mod.countTestDefinitions(dir), 1, "/re/.test(x) must not be counted as a test");
    const r = runCli(["--dir", dir, "--skip-browser"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS\s+deliverables/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
