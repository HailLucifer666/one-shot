# Release Gate (Executable Proof)

Honor-system checkboxes do not ship. A run is done **only** when `scripts/verify.mjs` exits `0` and writes a fresh, `treeHash`-signed `one-shot-work/GATE-RECEIPT.json`.

## 1. Run the Verifier
```sh
node <skill-dir>/scripts/verify.mjs --dir .
```
It reads `one-shot-work/contract.json` (and accepts CLI overrides `--test-cmd`, `--build-cmd`, `--start-cmd`, `--health-path`, `--protected-path`, `--check-receipt`) and verifies:
- Every declared deliverable exists as a regular file inside the project root (no traversal, no escaping/dangling symlinks)
- Brownfield guards (when configured): `diff-scope` (`allowedFiles` / `protectedFiles` vs `one-shot-work/baseline.json`) and `test-count-floor` (`minTestCount` / `minTestDelta` excluding comments, strings, `.skip`, and `.todo`)
- Every criterion `check` command, `buildCmd`, and `testCmd` exits `0`
- Live server (when `startCmd` is set): boots on a random port, `healthPath` returns 2xx/3xx with no stack trace, malformed JSON POST does not 500 or leak stack traces, `protectedPath` rejects unauthenticated callers with `401`/`403`, `fuzzPaths` survive XSS-reflection/SQL-error/5xx fuzzing, and `idorProbe` verifies User-A control 2xx + User-B rejection (`GET`/`DELETE`)
- No unignored `.env` (root or nested), no hardcoded secret literals in code/config, no banned placeholders in visible HTML
- Optional Playwright browser audit when installed (console errors, failed 4xx/5xx requests, horizontal overflow at 360/768/1280px, WCAG AA contrast with alpha compositing, dead controls, missing `alt` / unloaded images — otherwise recorded honestly as `SKIPPED`)
- Receipt freshness via `treeHash` over project files + `contract.json` + `baseline.json` (enforced by `--check-receipt` and `npx one-shot hook-check`)

## 2. Verdict Handling
- **PASS (`exit 0`):** Every executed check passed. Cite `one-shot-work/GATE-RECEIPT.json` and the exact pass/fail/skipped counts in the final report. Any post-gate edit invalidates `treeHash` and requires re-running `scripts/verify.mjs`.
- **BLOCKED (`exit 1`):** Return to the build loop, fix the failing check(s) (max 3 attempts per item), and re-run `scripts/verify.mjs`. If still `BLOCKED`, record the blocker in `one-shot-work/DIAGNOSIS.md` and lead the final report with `NOT DONE (BLOCKED)` and the exact failing check IDs.

## 3. Scope Honesty
State in the final report that `GATE-RECEIPT.json` proves only the checks that executed — skipped checks (such as browser checks when Playwright is absent) are unverified, not passed.
