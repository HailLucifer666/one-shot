# Release Gate (Executable Proof)

Honor-system checkboxes do not ship. A run is done **only** when `scripts/verify.mjs` exits `0` and writes a green `one-shot-work/GATE-RECEIPT.json`.

## 1. Run the Verifier
```sh
node <skill-dir>/scripts/verify.mjs --dir .
```
It reads `one-shot-work/contract.json` (and accepts CLI overrides `--test-cmd`, `--build-cmd`, `--start-cmd`, `--health-path`, `--protected-path`) and verifies:
- Every declared deliverable exists on disk
- Every criterion `check` command, `buildCmd`, and `testCmd` exits `0`
- Live server (when `startCmd` is set): boots on a random port, `healthPath` returns 2xx/3xx with no stack trace, malformed JSON POST does not return 500 or leak a stack trace, and `protectedPath` rejects unauthenticated callers with `401`/`403`
- No unignored `.env`, no hardcoded secret literals in code/config, no banned placeholders in visible HTML
- Optional browser check when Playwright is installed (otherwise recorded honestly as `SKIPPED`)

## 2. Verdict Handling
- **PASS (`exit 0`):** Every executed check passed. Cite `one-shot-work/GATE-RECEIPT.json` and the exact pass/fail/skipped counts in the final report.
- **BLOCKED (`exit 1`):** Return to the build loop, fix the failing check(s) (max 3 attempts per item), and re-run `scripts/verify.mjs`. If still `BLOCKED`, lead the final report with `NOT DONE (BLOCKED)` and the exact failing check IDs.

## 3. Scope Honesty
State in the final report that `GATE-RECEIPT.json` proves only the checks that executed — skipped checks (such as browser checks when Playwright is absent) are unverified, not passed.
