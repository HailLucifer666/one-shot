---
name: one-shot
version: 0.3.0
description: Autonomous spec-to-ship builder with a tamper-proof executable proof gate. Use whenever the user supplies a PRD, MVP, SOW, spec, bug report, or detailed idea and wants a complete, working, machine-verified deliverable in one run with no back-and-forth fixing.
---

# one-shot (v0.3.0)

Deliver a finished, working, machine-verified project on the first pass. Spend tokens on executable checks, not boilerplate prose.

## 1. Contract First (1 file, not 6)
1. First action: create `one-shot-work/contract.json` from `templates/contract.json`. Do not create separate SPEC/STACK/PLAN/PROGRESS/ASSUMPTIONS/GATE markdown files.
2. Read all provided files. Ask at most ONE batched round of missing required questions from `intake.md` (with safe defaults); if autonomous, log defaults in `one-shot-work/contract.json` `assumptions` and surface them at the top of the final report.
3. Bind every acceptance criterion in `one-shot-work/contract.json` to an executable `check` command, plus `deliverables`, `buildCmd`, `testCmd`, and (for servers) `startCmd` + `healthPath` + `protectedPath`.
4. If requirements conflict, record both requirements and the chosen resolution in `assumptions` — never silently drop one.

## 2. Domain Packs (load only what applies)
- API / backend / auth: `modules/app.md`
- Website / landing page / UI: `modules/web.md`
- Existing codebase / bugfix: `modules/brownfield.md`
- Choosing dependencies: `modules/stack.md`

## 3. Build Loop (Reactive Rigor)
1. Write failing acceptance tests first (watched-red), then write the smallest code that passes.
2. Run all tests + build after each logical slice. Keep all earlier tests green.
3. **Failure-driven escalation:** Stay fast while tests pass. If the **same criterion fails twice consecutively**, escalate: shrink to micro-slices (<=150 changed lines) and write the root-cause diagnosis to `one-shot-work/DIAGNOSIS.md` before the 3rd attempt.
4. Retry cap: 3 failed attempts on one criterion -> stop, record the blocker in `one-shot-work/DIAGNOSIS.md`, and report `BLOCKED`.

## 4. Executable Release Gate (No Honor System)
Before reporting done, follow `gate.md` and run the bundled verifier:
`node <skill-dir>/scripts/verify.mjs --dir .`
- It executes tests, build, contract criteria, diff-scope/test-floor guards, live server probes (`401`/malformed JSON/fuzz/IDOR), secret/unignored-`.env` scan, visible HTML placeholder scan, and Playwright DOM audit (overflow, WCAG contrast, dead controls, assets), writing a `treeHash`-signed `one-shot-work/GATE-RECEIPT.json`.
- Exit `0` (`PASS`) on the unmodified final tree is required to report done (enforced via `--check-receipt` / `npx one-shot hook-check`). Any post-gate edit invalidates `treeHash` and requires re-running `scripts/verify.mjs`.

## 5. Rules & Final Report
- Smallest correct change; no unrequested features; delete dead code.
- Final report (<=12 lines): list real deliverable paths on disk, exact run/test commands, `one-shot-work/GATE-RECEIPT.json` summary (`pass/fail/skipped`), assumptions, and known limitations. Never claim verified beyond what actually ran.
