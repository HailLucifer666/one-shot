#!/usr/bin/env node
/**
 * one-shot CLI (v0.3.0) — zero external dependencies (Node 20+ built-ins only).
 *
 * Commands:
 *   npx one-shot install    [--target <dir>] [--home <dir>] [--verify] [--with-hook]
 *   npx one-shot verify     [verify.mjs options...]
 *   npx one-shot hook-check [--dir <path>]
 *   npx one-shot init       [--dir <path>] [--brownfield] [--git-hook] [--force]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkReceipt, countTestDefinitions, sha256File, walkFiles } from "../one-shot/scripts/verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKILL_SRC = path.join(REPO_ROOT, "one-shot");
const VERIFY_SCRIPT = path.join(SKILL_SRC, "scripts", "verify.mjs");
const CONTRACT_TEMPLATE = path.join(SKILL_SRC, "templates", "contract.json");
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")).version;

const HARNESS_DIRS = [
  { name: "Claude Code", marker: ".claude", skillsRel: path.join(".claude", "skills") },
  { name: "Cursor", marker: ".cursor", skillsRel: path.join(".cursor", "skills") },
  { name: "Codex", marker: ".codex", skillsRel: path.join(".codex", "skills") },
  { name: "OpenCode", marker: path.join(".config", "opencode"), skillsRel: path.join(".config", "opencode", "skill") },
  { name: "ZCode", marker: ".zcode", skillsRel: path.join(".zcode", "skills") },
  { name: "Antigravity", marker: ".gemini", skillsRel: path.join(".gemini", "config", "skills") },
];

function walkRelativeFiles(rootDir) {
  const out = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(path.relative(rootDir, full).replace(/\\/g, "/"));
    }
  }
  visit(rootDir);
  return out.sort();
}

export function detectTargets(homeDir) {
  const detected = [];
  for (const h of HARNESS_DIRS) {
    if (fs.existsSync(path.join(homeDir, h.marker))) {
      detected.push({ name: h.name, dir: path.join(homeDir, h.skillsRel) });
    }
  }
  if (detected.length === 0) {
    detected.push({ name: "Claude Code (default)", dir: path.join(homeDir, ".claude", "skills") });
  }
  return detected;
}

export function verifyInstall(targetSkillsDir, sourceDir = SKILL_SRC) {
  const installedDir = path.join(targetSkillsDir, "one-shot");
  const errors = [];
  if (!fs.existsSync(installedDir) || !fs.statSync(installedDir).isDirectory()) {
    return { ok: false, errors: [`not installed: ${installedDir} does not exist`], fileCount: 0, sha: null };
  }
  const srcFiles = walkRelativeFiles(sourceDir);
  const tgtFiles = walkRelativeFiles(installedDir);
  const srcSet = new Set(srcFiles);

  for (const rel of srcFiles) {
    const srcPath = path.join(sourceDir, rel);
    const tgtPath = path.join(installedDir, rel);
    if (!fs.existsSync(tgtPath)) {
      errors.push(`MISSING: one-shot/${rel}`);
    } else if (Buffer.compare(fs.readFileSync(srcPath), fs.readFileSync(tgtPath)) !== 0) {
      errors.push(`DIFFERS: one-shot/${rel}`);
    }
  }
  for (const rel of tgtFiles) {
    if (!srcSet.has(rel)) {
      errors.push(`EXTRA: one-shot/${rel}`);
    }
  }
  const skillMd = path.join(installedDir, "SKILL.md");
  if (fs.existsSync(skillMd)) {
    const content = fs.readFileSync(skillMd, "utf-8");
    if (!/^name:\s*one-shot\b/m.test(content)) {
      errors.push("FINGERPRINT: 'name: one-shot' missing in installed SKILL.md");
    }
    if (!new RegExp(`^version:\\s*${VERSION.replace(/\./g, "\\.")}\\b`, "m").test(content)) {
      errors.push(`VERSION: 'version: ${VERSION}' missing in installed SKILL.md`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    fileCount: srcFiles.length,
    sha: fs.existsSync(skillMd) ? sha256File(skillMd).slice(0, 12) : null,
  };
}

function copyDir(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const rel of walkRelativeFiles(src)) {
    const from = path.join(src, rel);
    const to = path.join(dst, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

const STOP_HOOK_CMD = "npx one-shot hook-check";

function readClaudeSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return { ok: true, settings: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: `${settingsPath} must contain a JSON object` };
    }
    return { ok: true, settings: parsed };
  } catch (err) {
    return { ok: false, error: `invalid JSON in ${settingsPath}: ${err.message}` };
  }
}

function hasClaudeStopHook(settings) {
  return Array.isArray(settings?.hooks?.Stop) && settings.hooks.Stop.some((entry) =>
    Array.isArray(entry?.hooks) && entry.hooks.some((h) => h?.command === STOP_HOOK_CMD)
  );
}

function installClaudeStopHook(homeDir) {
  const claudeDir = path.join(homeDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, "settings.json");
  const loaded = readClaudeSettings(settingsPath);
  if (!loaded.ok) return { ok: false, settingsPath, error: loaded.error };
  const settings = loaded.settings;
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];
  const alreadyInstalled = hasClaudeStopHook(settings);
  if (!alreadyInstalled) {
    settings.hooks.Stop.push({
      hooks: [{ type: "command", command: STOP_HOOK_CMD }],
    });
    const tmpPath = `${settingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, settingsPath);
  }
  return { ok: true, settingsPath, alreadyInstalled };
}

function usage() {
  return [
    `one-shot v${VERSION} — proof-carrying AI agent skill & harness-enforced verifier`,
    "",
    "Usage: one-shot <command> [options]",
    "",
    "Commands:",
    "  install    [--target <dir>] [--home <dir>] [--verify] [--with-hook]",
    "      Auto-detect Claude Code, Cursor, Codex, OpenCode, ZCode, and Antigravity,",
    "      install one-shot/, and verify byte-identity. Pass --with-hook to register",
    "      the Claude Code Stop-Hook in ~/.claude/settings.json.",
    "  verify     [options]",
    "      Run the executable release-gate verifier (writes tamper-proof GATE-RECEIPT.json).",
    "      Pass --check-receipt for fast treeHash validation, or --help for all flags.",
    "  hook-check [--dir <path>]",
    "      Fast Stop-Hook / pre-commit enforcer: exits 0 if no contract.json exists or",
    "      receipt is fresh PASS; exits 2 if missing, BLOCKED, or stale after edits.",
    "  init       [--dir <path>] [--brownfield] [--git-hook] [--force]",
    "      Scaffold one-shot-work/contract.json (plus baseline.json with --brownfield",
    "      and .git/hooks/pre-commit with --git-hook).",
    "",
    "Flags:",
    "  -v, --version    Print version",
    "  -h, --help       Show this help",
  ].join("\n");
}

function cmdInstall(args) {
  const targets = [];
  let homeDir = os.homedir();
  let verifyOnly = false;
  let withHook = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--verify") { verifyOnly = true; continue; }
    if (a === "--with-hook") { withHook = true; continue; }
    if (a === "-h" || a === "--help") { console.log(usage()); return 0; }
    if (a === "--target") {
      if (args[i + 1] === undefined) { console.error("ERROR: missing value for --target"); return 2; }
      targets.push({ name: "explicit", dir: path.resolve(args[++i]) });
      continue;
    }
    if (a === "--home") {
      if (args[i + 1] === undefined) { console.error("ERROR: missing value for --home"); return 2; }
      homeDir = path.resolve(args[++i]);
      continue;
    }
    console.error(`ERROR: unknown install option: ${a}`);
    return 2;
  }

  const resolvedTargets = targets.length > 0 ? targets : detectTargets(homeDir);
  let allOk = true;
  for (const t of resolvedTargets) {
    if (!verifyOnly) {
      copyDir(SKILL_SRC, path.join(t.dir, "one-shot"));
    }
    const check = verifyInstall(t.dir, SKILL_SRC);
    if (check.ok) {
      const verb = verifyOnly ? "VERIFY: OK" : "INSTALLED & VERIFIED";
      console.log(`${verb} [${t.name}] -> ${path.join(t.dir, "one-shot")} (${check.fileCount} files, v${VERSION}, sha256:${check.sha})`);
    } else {
      allOk = false;
      console.error(`VERIFY: FAILED [${t.name}] -> ${path.join(t.dir, "one-shot")}`);
      for (const e of check.errors) console.error(`  - ${e}`);
    }
  }
  if (withHook) {
    if (verifyOnly) {
      const settingsPath = path.join(homeDir, ".claude", "settings.json");
      const loaded = readClaudeSettings(settingsPath);
      if (!loaded.ok) {
        console.error(`ERROR: ${loaded.error}`);
        return 2;
      }
      if (hasClaudeStopHook(loaded.settings)) {
        console.log(`STOP-HOOK: VERIFY OK in ${settingsPath}`);
      } else {
        allOk = false;
        console.error(`STOP-HOOK: MISSING in ${settingsPath}`);
      }
    } else {
      const res = installClaudeStopHook(homeDir);
      if (!res.ok) {
        console.error(`ERROR: ${res.error}`);
        return 2;
      }
      console.log(`STOP-HOOK: ${res.alreadyInstalled ? "already present" : "registered"} in ${res.settingsPath}`);
    }
  }
  return allOk ? 0 : 1;
}

function cmdInit(args) {
  let dir = ".";
  let force = false;
  let brownfield = false;
  let gitHook = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--force") { force = true; continue; }
    if (a === "--brownfield") { brownfield = true; continue; }
    if (a === "--git-hook") { gitHook = true; continue; }
    if (a === "-h" || a === "--help") { console.log(usage()); return 0; }
    if (a === "--dir") {
      if (args[i + 1] === undefined) { console.error("ERROR: missing value for --dir"); return 2; }
      dir = args[++i];
      continue;
    }
    console.error(`ERROR: unknown init option: ${a}`);
    return 2;
  }
  const root = path.resolve(dir);
  const workDir = path.join(root, "one-shot-work");
  const dest = path.join(workDir, "contract.json");
  if (fs.existsSync(dest) && !force) {
    console.error(`ERROR: ${dest} already exists (pass --force to overwrite)`);
    return 1;
  }
  fs.mkdirSync(workDir, { recursive: true });
  fs.copyFileSync(CONTRACT_TEMPLATE, dest);
  console.log(`Created ${dest}`);

  if (brownfield) {
    const files = walkFiles(root);
    const fileHashes = {};
    for (const f of files) {
      fileHashes[path.relative(root, f).replace(/\\/g, "/")] = sha256File(f);
    }
    const baseline = {
      timestamp: new Date().toISOString(),
      fileCount: files.length,
      testCount: countTestDefinitions(root, files),
      files: fileHashes,
    };
    const baselinePath = path.join(workDir, "baseline.json");
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n", "utf-8");
    console.log(`Created ${baselinePath} (${baseline.fileCount} files, ${baseline.testCount} tests)`);
  }

  if (gitHook) {
    const dotGit = path.join(root, ".git");
    if (!fs.existsSync(dotGit)) {
      console.error(`ERROR: no .git directory found under ${root}`);
      return 1;
    }
    let hooksDir = null;
    if (fs.statSync(dotGit).isDirectory()) {
      hooksDir = path.join(dotGit, "hooks");
    } else {
      const gp = spawnSync("git", ["-C", root, "rev-parse", "--git-path", "hooks"], { encoding: "utf-8" });
      if (gp.status === 0 && gp.stdout.trim()) {
        hooksDir = path.resolve(root, gp.stdout.trim());
      } else {
        console.error(`ERROR: unable to resolve git hooks directory for worktree/submodule at ${root}`);
        return 1;
      }
    }
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, "pre-commit");
    if (fs.existsSync(hookPath) && !force) {
      const existing = fs.readFileSync(hookPath, "utf-8");
      if (!existing.includes("# Installed by one-shot")) {
        console.error(`ERROR: existing custom pre-commit hook at ${hookPath} (pass --force to overwrite)`);
        return 1;
      }
    }
    const hookBody = "#!/bin/sh\n# Installed by one-shot v" + VERSION + "\nnpx one-shot hook-check --dir .\n";
    fs.writeFileSync(hookPath, hookBody, { encoding: "utf-8", mode: 0o755 });
    console.log(`Installed pre-commit hook at ${hookPath}`);
  }
  return 0;
}

function readStdinJson() {
  if (process.stdin.isTTY) return null;
  try {
    const raw = fs.readFileSync(0, "utf-8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function cmdHookCheck(args) {
  let dir = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") { console.log(usage()); return 0; }
    if (a === "--dir") {
      if (args[i + 1] === undefined) { console.error("ERROR: missing value for --dir"); return 2; }
      dir = args[++i];
      continue;
    }
    console.error(`ERROR: unknown hook-check option: ${a}`);
    return 2;
  }
  const payload = readStdinJson();
  if (payload?.stop_hook_active === true) {
    console.error("one-shot: stop_hook_active is true — allowing stop to avoid an infinite loop.");
    return 0;
  }
  const targetDir = dir ?? (typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : ".");
  const root = path.resolve(targetDir);
  const contractPath = path.join(root, "one-shot-work", "contract.json");
  if (!fs.existsSync(contractPath)) {
    return 0; // Not a one-shot contracted workspace — zero friction
  }
  const result = checkReceipt(root);
  if (result.ok) {
    return 0;
  }
  console.error(`one-shot BLOCKED (${result.code}): ${result.detail}`);
  console.error("Fix failing checks and run `npx one-shot verify --dir .` before finishing.");
  return 2;
}

function cmdVerify(args) {
  const res = spawnSync(process.execPath, [VERIFY_SCRIPT, ...args], { stdio: "inherit" });
  return res.status ?? 2;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(usage());
    process.exit(0);
  }
  if (argv[0] === "-v" || argv[0] === "--version") {
    console.log(VERSION);
    process.exit(0);
  }
  const [cmd, ...rest] = argv;
  if (cmd === "install") process.exit(cmdInstall(rest));
  if (cmd === "verify") process.exit(cmdVerify(rest));
  if (cmd === "hook-check") process.exit(cmdHookCheck(rest));
  if (cmd === "init") process.exit(cmdInit(rest));
  console.error(`ERROR: unknown command '${cmd}'\n`);
  console.error(usage());
  process.exit(2);
}

function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
if (isMainModule(import.meta.url)) {
  main();
}
