# PRE-REGISTERED — hard-mode Step 0 (H1 + H5 baseline, GLM 5.3 Flash, no skill)

Written 2026-11-01 BEFORE any model run, per HARD-RUN-PLAN.md ("write these down before you start,
then do not change them").

## The pack's decision rules (copied verbatim from HARD-RUN-PLAN.md)

- The skill wins a spec if mean first-run percent is at least 10 points higher, or median fix rounds is at least 1 lower, with no more regressions than baseline.
- Blind rating: the skill wins if it has more wins and a higher mean score across at least 3 raters.
- Launch the repo with these results if the skill wins at least 3 of 5 specs on at least one model and loses on no more than 1.
- Otherwise publish what you learned and fix the skill first. Do not hide a tie or a loss.
- Always show token cost next to quality. A win that costs 3 times the tokens must say so.

## Session decisions (pre-registered)

1. Step 0 verdict (partial by design; the "3 of 5" rule completes at Tier 2): proceed to Tier 1 iff
   baseline H1 percent (of 19 scorable) and baseline H5 criteria (of 7) are both strictly under
   90%; if either reaches 90%, that spec is too easy — stop, strengthen it, re-run Step 0 for that
   spec alone.
2. Step 0 = first-run score only, no fix rounds.
3. Tool fixes are validity fixes, each probed fail-then-pass; none moves the validity rule.
4. Tokens from the harness sentinel into run-complete.json (design=baseline, fingerprint false
   expected). Any one-shot-work/ in a baseline run = ambient contamination flag.
5. H1 interview: escalated questions answered ONLY from OWNER-SHEET.md verbatim, one round, "your
   call" for off-sheet; questions asked in output text are counted for coverage, never answered.
   Outcome recorded as: escalated-answered / asked-in-output / asked-nothing / channel-unavailable.
6. Criterion 19 (file://) fallback: attempt file:// in the browser; if the harness refuses, verify
   via locally served copy + node --check and record the deviation next to the score.
7. No rule on this page changes after results are seen.

## Tool state before the runs (fail-then-pass evidence, all commands recorded)

- `run_h5.mjs` was broken on Node 24 (C7 parsed `# tests N` from a spec-reporter output:
  "npm test exit 0, NaN/NaN passing" captured on the untouched starter BEFORE the fix).
  Fixed: forces `npm test -- --test-reporter=tap`, parses both summary formats, adds a
  parse-failure evidence note.
- `check_h1.py` was broken under `python` 3.9 (SyntaxError: f-string backslash, line 69 —
  captured verbatim). Fixed: precomputed h1 count; UTF-8 reads; check 12 derived structurally
  (any img src/srcset or CSS url() that is not a local relative path or data: URI fails) — the
  old check false-failed on `placeholder="..."` (captured: ember-oak check 12 FAIL `[] ['placehold']`).
- `check_h3.py` + `blind_rate.py`: same-class unencoded reads fixed.
- PASS-side controls built and green BEFORE runs: H1 reference (sha 9f7711db583a01e0) = 15/15
  under python 3.9 AND py 3.14 (outputs identical); H5 reference (store 7147e8e3e15b76da,
  server db0ef81f57b9f2da, page 743e01cd0ef890d1, tests e6f073991f9e7445) = fixed runner 7/7,
  exit 0; runner twice on reference differs only by a Node PID line in a deprecation warning.
- FAIL-side controls hold: starter = C1-C5 FAIL, C6 PASS, C7 FAIL (13 tests, needs >13) with real
  numbers; ember-oak = 8/15 (check 12 flipped PASS by the fix; check 11 emoji FAIL is real).
- H5 starter copy delivered to the run dir verified 13/13 BEFORE the agent touch.
- Skill parked out of the ZCode catalog before spawning (verify: no one-shot in
  C:\Users\acarg\.zcode\skills); v0.1 provenance anchor at _skill-staging\one-shot still hashes
  d17a33667c28c421.

## Scoring denominators for Step 0

- H1: criteria 1-19 score (20 = blind rating, deferred to Tier 1); interview coverage x/12 recorded.
- H5: runner C1-C7 (C5's manual half noted, not scored in Step 0).
