import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "one-shot.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf-8",
    timeout: 30_000,
  });
}

test("--help and --version exit 0", () => {
  const h = runCli(["--help"]);
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /one-shot v0\.3\.0/);
  assert.match(h.stdout, /install/);
  assert.match(h.stdout, /verify/);
  assert.match(h.stdout, /hook-check/);

  const v = runCli(["--version"]);
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stdout.trim(), "0.3.0");
});

test("unknown command exits 2", () => {
  const r = runCli(["bogus-command"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command/i);
});

test("install auto-detects installed harnesses, installs byte-identically, and --verify detects tampering/extras", () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-home-"));
  try {
    // Simulate Claude Code + Cursor + Antigravity present in fake home
    fs.mkdirSync(path.join(fakeHome, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, ".cursor"), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, ".gemini"), { recursive: true });

    const inst = runCli(["install", "--home", fakeHome]);
    assert.equal(inst.status, 0, inst.stdout + inst.stderr);
    assert.match(inst.stdout, /Claude Code/);
    assert.match(inst.stdout, /Cursor/);
    assert.match(inst.stdout, /Antigravity/);
    assert.ok(fs.existsSync(path.join(fakeHome, ".claude", "skills", "one-shot", "scripts", "verify.mjs")));

    // Clean --verify exits 0
    const okVerify = runCli(["install", "--home", fakeHome, "--verify"]);
    assert.equal(okVerify.status, 0, okVerify.stdout + okVerify.stderr);

    // 1-byte tamper in Cursor install -> --verify MUST exit 1
    const cursorSkill = path.join(fakeHome, ".cursor", "skills", "one-shot", "SKILL.md");
    fs.appendFileSync(cursorSkill, "\n");
    const tampered = runCli(["install", "--home", fakeHome, "--verify"]);
    assert.equal(tampered.status, 1, tampered.stdout + tampered.stderr);
    assert.match(tampered.stderr, /DIFFERS: one-shot\/SKILL\.md/);

    // Re-install fixes tamper -> --verify exits 0 again
    assert.equal(runCli(["install", "--home", fakeHome]).status, 0);

    // Stray extra file in Claude Code install -> --verify MUST exit 1
    fs.writeFileSync(path.join(fakeHome, ".claude", "skills", "one-shot", "stray.txt"), "x");
    const extra = runCli(["install", "--home", fakeHome, "--verify"]);
    assert.equal(extra.status, 1, extra.stdout + extra.stderr);
    assert.match(extra.stderr, /EXTRA: one-shot\/stray\.txt/);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("init scaffolds contract.json and refuses to overwrite without --force", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-init-"));
  try {
    const first = runCli(["init", "--dir", proj]);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const contractPath = path.join(proj, "one-shot-work", "contract.json");
    assert.ok(fs.existsSync(contractPath));
    const parsed = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
    assert.ok(Array.isArray(parsed.criteria));

    // Second init without --force MUST fail
    const second = runCli(["init", "--dir", proj]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already exists/);

    // With --force succeeds
    const forced = runCli(["init", "--dir", proj, "--force"]);
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test("verify subcommand delegates to verify.mjs and propagates PASS (0) / BLOCKED (1)", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-verify-cli-"));
  try {
    fs.writeFileSync(path.join(proj, "index.html"), "<html><body><h1>Clean</h1></body></html>\n");
    const ok = runCli(["verify", "--dir", proj, "--skip-browser"]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /GATE: PASS/);

    fs.writeFileSync(path.join(proj, "index.html"), "<html><body><p>lorem ipsum</p></body></html>\n");
    const bad = runCli(["verify", "--dir", proj, "--skip-browser"]);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /GATE: BLOCKED/);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test("Slice 5: hook-check is silent (exit 0) without contract, blocks (exit 2) on missing/stale receipt, passes (exit 0) on fresh PASS", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-hook-"));
  try {
    fs.writeFileSync(path.join(proj, "app.js"), "console.log(1);\n");
    // 1. No contract.json -> zero friction (exit 0)
    const noContract = runCli(["hook-check", "--dir", proj]);
    assert.equal(noContract.status, 0, noContract.stdout + noContract.stderr);

    // 2. Contract exists, no receipt yet -> blocks with exit 2
    assert.equal(runCli(["init", "--dir", proj]).status, 0);
    // Replace placeholder criterion with a real passing check
    const cPath = path.join(proj, "one-shot-work", "contract.json");
    fs.writeFileSync(cPath, JSON.stringify({ deliverables: ["app.js"], criteria: [] }));
    const missing = runCli(["hook-check", "--dir", proj]);
    assert.equal(missing.status, 2, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /MISSING_RECEIPT/);

    // 3. Run verify -> fresh PASS receipt -> hook-check exits 0
    assert.equal(runCli(["verify", "--dir", proj, "--skip-browser"]).status, 0);
    const fresh = runCli(["hook-check", "--dir", proj]);
    assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);

    // 4. Edit app.js after verify -> hook-check blocks with exit 2 (STALE_OR_FORGED_RECEIPT)
    fs.writeFileSync(path.join(proj, "app.js"), "console.log(2);\n");
    const stale = runCli(["hook-check", "--dir", proj]);
    assert.equal(stale.status, 2, stale.stdout + stale.stderr);
    assert.match(stale.stderr, /STALE_OR_FORGED_RECEIPT/);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test("Slice 5: install --with-hook idempotently merges Claude Code Stop hook without clobbering existing settings", () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-hook-home-"));
  try {
    const claudeDir = path.join(fakeHome, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark", hooks: { PreToolUse: [{ matcher: "Bash" }] } }, null, 2));

    // First install --with-hook
    const first = runCli(["install", "--home", fakeHome, "--with-hook"]);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const s1 = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.equal(s1.theme, "dark");
    assert.equal(s1.hooks.PreToolUse.length, 1);
    assert.ok(Array.isArray(s1.hooks.Stop) && s1.hooks.Stop.length === 1);

    // Second install --with-hook is idempotent (does not duplicate Stop hook)
    const second = runCli(["install", "--home", fakeHome, "--with-hook"]);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    const s2 = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.equal(s2.hooks.Stop.length, 1);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("Slice 2 & 5: init --brownfield snapshots baseline.json and --git-hook installs pre-commit hook", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-bf-"));
  try {
    fs.mkdirSync(path.join(proj, ".git", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(proj, "server.js"), "export const x = 1;\n");
    fs.mkdirSync(path.join(proj, "tests"), { recursive: true });
    fs.writeFileSync(path.join(proj, "tests", "app.test.js"), 'test("a", () => {});\n');

    const res = runCli(["init", "--dir", proj, "--brownfield", "--git-hook"]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const baseline = JSON.parse(fs.readFileSync(path.join(proj, "one-shot-work", "baseline.json"), "utf-8"));
    assert.equal(baseline.testCount, 1);
    assert.ok(baseline.files["server.js"]);
    const hookFile = path.join(proj, ".git", "hooks", "pre-commit");
    assert.ok(fs.existsSync(hookFile));
    assert.match(fs.readFileSync(hookFile, "utf-8"), /hook-check/);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test("V3: hook-check exits 0 when stdin reports stop_hook_active: true (prevents infinite Stop-Hook loop)", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-stop-active-"));
  try {
    fs.mkdirSync(path.join(proj, "one-shot-work"), { recursive: true });
    fs.writeFileSync(path.join(proj, "one-shot-work", "contract.json"), JSON.stringify({ deliverables: ["missing.js"] }));
    const res = spawnSync(process.execPath, [CLI, "hook-check", "--dir", proj], {
      input: JSON.stringify({ stop_hook_active: true }),
      encoding: "utf-8",
      timeout: 30_000,
    });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stderr, /stop_hook_active/i);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test("V9 & V15: init --git-hook preserves custom hook without --force and install --with-hook handles corrupt settings cleanly", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-githook-"));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-corrupt-home-"));
  try {
    fs.mkdirSync(path.join(proj, ".git", "hooks"), { recursive: true });
    const hookFile = path.join(proj, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hookFile, "#!/bin/sh\necho CUSTOM_HOOK\n", "utf-8");

    // Without --force: must NOT clobber custom hook
    const refused = runCli(["init", "--dir", proj, "--git-hook"]);
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(fs.readFileSync(hookFile, "utf-8"), /CUSTOM_HOOK/);

    // With --force: overwrites cleanly
    const forced = runCli(["init", "--dir", proj, "--git-hook", "--force"]);
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);
    assert.match(fs.readFileSync(hookFile, "utf-8"), /hook-check/);

    // Corrupt settings.json: returns clean error (exit 2), no raw SyntaxError stack
    fs.mkdirSync(path.join(fakeHome, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, ".claude", "settings.json"), "{ invalid json", "utf-8");
    const badSettings = runCli(["install", "--home", fakeHome, "--with-hook"]);
    assert.equal(badSettings.status, 2, badSettings.stdout + badSettings.stderr);
    assert.match(badSettings.stderr, /ERROR:.*settings\.json/i);
    assert.doesNotMatch(badSettings.stderr, /at JSON\.parse/);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("REV: hook-check does not hang when spawned with an open stdin pipe", async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "one-shot-open-pipe-"));
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, "hook-check", "--dir", proj], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("hook-check hung on open stdin pipe"));
      }, 4000);
      child.on("exit", (c) => {
        clearTimeout(killTimer);
        resolve(c);
      });
    });
    assert.equal(code, 0);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});
