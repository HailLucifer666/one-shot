# How to score the benchmark

Goal: compare the same model with and without the skill on the same single prompt.

## Setup
- Models: run at least two, one cheap or local and one stronger if you can.
- Modes: `baseline` (no skill) and `skill` (one-shot installed).
- Prompt for every run, verbatim: `Build this. Here is the spec: <paste spec file>.` For skill mode, prefix with `/one-shot`.
- Run each spec the same number of times per model and mode, in fresh sessions, and report the count (n) with the results.
- One prompt only. No follow-up fixes during the run.

## Record per run (RESULT.json)
- criteria_passed: number out of 10. Machine-checkable criteria come from `benchmark/checks.py` output; only the criteria it prints as MANUAL are judged by hand, and every hand-judged criterion is footnoted in `notes`.
- follow_up_prompts_needed: for runs with criteria_passed of 7 or more, count by actually sending follow-up prompts until 10 of 10. For runs under 7, write the string `">X"` where X is an integer lower-bound estimate (for example `">4"`); do not grind a broken build. The summary counts `>X` as X and marks a censored median with a trailing `+` (for example `3+`).
- tokens_used: from your tool's usage display, or null. In skill mode this includes the skill-instruction overhead, so cross-mode token comparison overstates the skill's cost. README states this wherever a token column appears.
- run-complete.json: the sentinel `summary()` gates on - it proves the run actually finished and was scored. Write it with `python benchmark/run_benchmark.py complete --model <m> --mode <mode> --spec NN --run N`, which refuses unscored runs. A scored run without a sentinel is excluded from the table and reported by name under "skipped"; nothing is dropped silently.
- notes: one line on the main failure.

## Checks
`python benchmark/checks.py --spec 01 --dir <built-project>` prints one line per criterion: PASS with evidence, FAIL with evidence, or MANUAL with the procedure. Static checks (h1 count, word counts, hashed-password grep, file existence, slide counts) are automated. HTTP flow checks (signup, 401s, pagination) print exact commands to run against the started app; record their output. FAIL is printed only on conclusive evidence; anything ambiguous is MANUAL. Only visual and fluidity criteria (console cleanliness, responsiveness, contrast, focus visibility, smoothness) stay hand-judged, each footnoted in notes.

## Checks - the v3 additive battery (2026-11-07)
Specs 06-10 plus the vague criteria are an ADDITIVE battery, governed by `benchmark-v3/PROTOCOL.md` and pre-registered (exploratory) in `benchmark-v3/PREREG-EXPLORATORY-2026-11-07.md`. They are scored with the same checks-first method as above (`python benchmark/checks.py --spec 06` … `--spec 10`): spec 09's scorer enforces the starter's sha256 manifest as a byte-identity tamper guard against `benchmark-v3/starters/09-notes-app`, and spec 10's scorer compares the run's `report.json` against the fixture's golden answers (`benchmark/specs/fixtures/10-expenses.csv`, mirrored byte-exactly from the spec's embedded CSV) — but only when the run's `expenses.csv` matches the fixture byte-for-byte up to line endings; a different CSV prints MANUAL, because the golden answers belong to that exact input. Behavioral criteria print MANUAL with the exact procedure and the expected values; FAIL is printed only on conclusive static evidence. This section adds to the 5-spec battery above and does not alter it - the published 20/20 records stay reproducible byte-for-byte.

## Metrics
- First-run pass rate: the share of runs scoring 10 of 10 with zero follow-up prompts. This is the one definition used everywhere; README and PRD cite this file, not their own wording.
- Mean criteria passed.
- Median follow-up prompts to reach 10 of 10 (see the counting rule above).
- Tokens per finished spec (with the skill-overhead footnote).

## Honesty rules
- Publish all runs, including bad ones.
- Report sample size (n) per cell. Cells are small; say so.
- Do not tune the skill on a spec and then report that same spec as evidence without saying it.
- If fewer than all 5 specs are measured at publish time, the results table states "measured on N of 5 specs" and missing cells stay empty until measured.
