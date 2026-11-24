#!/usr/bin/env node
/**
 * one-shot CLI (v0.2.0) — zero external dependencies (Node 20+ built-ins only).
 *
 * Commands:
 *   npx one-shot install [--target <dir>] [--home <dir>] [--verify]
 *   npx one-shot verify  [verify.mjs options...]
 *   npx one-shot init    [--dir <path>] [--force]
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKILL_SRC = path.join(REPO_ROOT, "one-shot");
const VERIFY_SCRIPT = path.join(SKILL_SRC, "scripts", "verify.mjs");
const CONTRACT_TEMPLATE = path.join(SKILL_SRC, "templates", "contract.json");
const VERSION = "0.2.0";

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

function sha256Prefix(filePath) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  return h.slice(0, 12);
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
    if (!/^version:\s*0\.2\.0\b/m.test(content)) {
      errors.push("VERSION: 'version: 0.2.0' missing in installed SKILL.md");
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    fileCount: srcFiles.length,
    sha: fs.existsSync(skillMd) ? sha256Prefix(skillMd) : null,
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

function usage() {
  return [
    `one-shot v${VERSION} — proof-carrying AI agent skill & executable verifier`,
    "",
    "Usage: one-shot <command> [options]",
    "",
    "Commands:",
    "  install [--target <dir>] [--home <dir>] [--verify]",
    "      Auto-detect Claude Code, Cursor, Codex, OpenCode, ZCode, and Antigravity,",
    "      install one-shot/, and verify byte-identity. Pass --verify to check only.",
    "  verify  [options]",
    "      Run the executable release-gate verifier (writes GATE-RECEIPT.json).",
    "      Pass --help after verify for all verifier flags.",
    "  init    [--dir <path>] [--force]",
    "      Scaffold one-shot-work/contract.json in a project directory.",
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

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--verify") { verifyOnly = true; continue; }
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
  return allOk ? 0 : 1;
}

function cmdInit(args) {
  let dir = ".";
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--force") { force = true; continue; }
    if (a === "-h" || a === "--help") { console.log(usage()); return 0; }
    if (a === "--dir") {
      if (args[i + 1] === undefined) { console.error("ERROR: missing value for --dir"); return 2; }
      dir = args[++i];
      continue;
    }
    console.error(`ERROR: unknown init option: ${a}`);
    return 2;
  }
  const dest = path.join(path.resolve(dir), "one-shot-work", "contract.json");
  if (fs.existsSync(dest) && !force) {
    console.error(`ERROR: ${dest} already exists (pass --force to overwrite)`);
    return 1;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(CONTRACT_TEMPLATE, dest);
  console.log(`Created ${dest}`);
  return 0;
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
  if (cmd === "init") process.exit(cmdInit(rest));
  console.error(`ERROR: unknown command '${cmd}'\n`);
  console.error(usage());
  process.exit(2);
}

const isMain = Boolean(
  process.argv[1] &&
  fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))
);
if (isMain) {
  main();
}
