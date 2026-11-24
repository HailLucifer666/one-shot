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
  assert.match(res.stdout, /one-shot verify v0\.2\.0/);
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
