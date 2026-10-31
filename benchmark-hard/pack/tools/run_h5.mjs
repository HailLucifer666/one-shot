#!/usr/bin/env node
// Usage: node tools/run_h5.mjs <candidate-folder>
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cand = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(path.join(cand, "server.js"))) {
  console.error("Usage: node tools/run_h5.mjs <candidate-folder containing server.js>");
  process.exit(2);
}
const sha = (f) => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : null);
const results = {};
const mark = (c, ok, note = "") => { (results[c] ??= []).push({ ok, note }); };

// C6: original tests untouched
for (const f of ["store.test.js", "api.test.js"]) {
  const a = sha(path.join(root, "specs/H5-brownfield/starter/test", f));
  const b = sha(path.join(cand, "test", f));
  mark("C6", a === b, a === b ? "" : `test/${f} was modified or deleted`);
}

// C7: candidate's own tests pass and number more than the original 13
// 2026-11-01: plain `npm test` emits the spec reporter on Node >= 20 (`ℹ tests 13`), whose
// summary this parser never matched — C7 read NaN/NaN and failed every candidate, including
// a correct one. The run now forces the TAP reporter (`npm test -- --test-reporter=tap`,
// same tests, same exit semantics) and the parser accepts either summary format.
const npmTest = spawnSync("npm", ["test", "--", "--test-reporter=tap"], { cwd: cand, encoding: "utf8", shell: process.platform === "win32" });
const out = (npmTest.stdout || "") + (npmTest.stderr || "");
const num = (k) => {
  const tap = out.match(new RegExp(`^# ${k} (\\d+)`, "m"));
  const spec = out.match(new RegExp(`\\b${k} (\\d+)\\s*$`, "m"));
  return Number((tap || spec || [])[1] ?? NaN);
};
const total = num("tests"), pass = num("pass"), fail = num("fail");
mark("C7", npmTest.status === 0 && fail === 0, `npm test exit ${npmTest.status}, ${pass}/${total} passing`);
if (Number.isNaN(total)) mark("C7", false, `test summary not parseable; npm test output tail: ${(npmTest.stdout || npmTest.stderr || "").slice(-200)}`);
mark("C7", total > 13, `${total} tests found (needs more than the original 13)`);

// C5 (automatic part): page mentions the new UI pieces
const page = path.join(cand, "public", "index.html");
const html = fs.existsSync(page) ? fs.readFileSync(page, "utf8").toLowerCase() : "";
mark("C5", html.includes("<select"), "status dropdown (<select>) in page");
mark("C5", html.includes("due"), "page references due dates");
mark("C5", html.includes("overdue"), "page references overdue");

// Hidden API tests against the candidate's server
const port = await new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn("node", ["server.js"], { cwd: cand, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
let ready = false;
for (let i = 0; i < 50 && !ready; i++) {
  try { ready = (await fetch(`http://localhost:${port}/api/tasks`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
if (!ready) { server.kill(); console.error("Candidate server did not start. Check `npm start` and PORT handling."); process.exit(1); }
const hidden = spawnSync("node", ["--test", "--test-reporter=tap", path.join(root, "specs/H5-brownfield/hidden/h5.hidden.test.mjs")], {
  encoding: "utf8", env: { ...process.env, H5_BASE: `http://localhost:${port}` },
});
server.kill();
for (const line of (hidden.stdout || "").split("\n")) {
  const m = line.match(/^(not )?ok \d+ - (C\d): (.+?)(?: #.*)?$/);
  if (m) mark(m[2], !m[1], m[3]);
}

let allOk = true;
for (const c of ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]) {
  const rs = results[c] || [];
  const ok = rs.length > 0 && rs.every((r) => r.ok);
  allOk &&= ok;
  console.log(`${c}: ${ok ? "PASS" : "FAIL"}${c === "C5" ? " (automatic part; also check the page by eye)" : ""}`);
  for (const r of rs.filter((x) => !x.ok)) console.log(`     - ${r.note}`);
}
console.log(allOk ? "\nAll criteria pass." : "\nSome criteria fail.");
process.exit(allOk ? 0 : 1);
