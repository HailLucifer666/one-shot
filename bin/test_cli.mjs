import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  assert.match(h.stdout, /one-shot v0\.2\.0/);
  assert.match(h.stdout, /install/);
  assert.match(h.stdout, /verify/);

  const v = runCli(["--version"]);
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stdout.trim(), "0.2.0");
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
