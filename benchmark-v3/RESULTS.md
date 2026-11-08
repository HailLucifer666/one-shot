# RESULTS — benchmark-v3 scoring audit (batch 1)

- **Date:** 2026-11-08 · **Auditor:** ZCode scoring session (agent), per `PROTOCOL.md`
- **Inputs:** run folders under `E:\Skill-OneShot\TEst LLM's\` (5 model pairs = 10 runs; specs 06–10)
- **Scorer:** `benchmark/checks.py` at branch `feat/v3-spec-pack` commit `5a43a95`, invoked `python -I benchmark/checks.py --spec <NN> --dir "<run>"` (spec 09: `--dir` = the run's `notes-app/` subfolder)
- **Vendored records untouched:** `benchmark/runs/`, `benchmark/runs-v014/` — verified untouched (summary sha256 `9769a2996260bdcb37ecea928133fb44b4b1160764d1e11ec0282ad62af77a7b` unchanged; run folders only ever read)

## Audit conventions (auditor rulings — user sign-off requested)

1. **Tells adjudication.** No run saved a harness transcript, so tell 2 ("one-shot loaded…") and tell 3 ("Known limitations" in the final report) could not be read from transcripts. Adjudicated instead from the `one-shot-work/` files the skill itself writes: the `PROGRESS.md` first line (`Skill: one-shot | Rigor: … | Gate: …`) is the tell-2 line persisted to disk, and `GATE.md` carries gate status. All five skill arms carry it (Kilo's says `Gate: not run` — see its state).
2. **MANUAL exclusion rule applied strictly.** No `RUN-NOTE.md` and no user-captured screenshots/recordings exist in any run folder. Per the evidence rules, every behavioral/MANUAL criterion is **excluded from that run's denominator with a footnote — never counted as a pass**. The single exception is spec 09, whose protocol clause "save the test/tool run output as a text file in the run folder" makes the saved `run/` logs admissible evidence; each spec-09 pass below cites the exact file. These logs were produced by the model, not the user; authenticity is user-attested (standard for self-reported evidence).
3. **Kilo skill arm (spec 07) is flagged INVALID-incomplete.** `PROGRESS.md` says `Rigor: LITE … Gate: not run`; `one-shot-work/` holds only `SPEC.md` + `PROGRESS.md`. LITE legitimately skips PLAN/STACK, but the skill's own rule still requires a self-review + run-path check at LITE — the gate was never run. Counted as **informational only, excluded from skill-arm scoring**; rerun recommended.
4. **Mercury skill arm (spec 09) is flagged INVALID-not-independent.** Its `server.js` and `tests/notes.test.js` are **byte-identical** (sha256-verified) to the baseline run's finished versions, while its own `run/baseline-hashes.txt` proves it *started from a pristine starter*. Two independent sessions do not converge on byte-identical multi-line fixes plus byte-identical new test code (including comment prose). The solution bytes reached the skill session from the earlier run one way or another. Scores shown as informational only; **pair excluded from arm comparison**; rerun in a fresh folder with no prior outputs reachable. Full evidence in the per-run section.
5. **Folder naming (Amendment A-01).** Baseline folders carry the model name; skill arms carry "with one-shot" — except `Crouton Alpha One-shot` (missing "with"; arm still unambiguous from its tells). A-01 is otherwise followed.

## Summary table

Score = criteria passed / criteria in denominator (static criteria + admissible saved evidence). Excluded = MANUAL criteria with no admissible evidence (footnote below).

| Model | Spec | Arm | Run state | Pass / denom | Excluded (no evidence) | Pair delta |
|---|---|---|---|---|---|---|
| Crouton Alpha | 06 calculator | baseline | VALID | 2 / 2 | 8 | — |
| Crouton Alpha | 06 calculator | skill (STRICT, gate PASS) | VALID | 2 / 2 | 8 | ±0 (static only) |
| Deepseek v4.1 Flash | 10 data transform | baseline | VALID | 8 / 8 | 2 | — |
| Deepseek v4.1 Flash | 10 data transform | skill (STRICT, gate PASS) | VALID | 8 / 8 | 2 | ±0 — **ceiling both arms; NOT-DISCRIMINATING** |
| Gemini 3.8 | 08 expense splitter | baseline | **CONTAMINATED** — ran the full skill | not scored | — | **pair unusable** |
| Gemini 3.8 | 08 expense splitter | skill (STANDARD, gate PASS) | VALID | 1 / 1 | 9 | (no baseline) |
| Kilo Auto Beam 1.0 | 07 pomodoro | baseline | VALID | 1 / 1 | 9 | — |
| Kilo Auto Beam 1.0 | 07 pomodoro | skill (LITE, **gate not run**) | **INVALID-incomplete** | (1 / 1 informational) | 9 | **pair excluded** |
| Mercury 3 | 09 brownfield bugs | baseline | VALID — full evidence chain | **10 / 10** | 0 | — |
| Mercury 3 | 09 brownfield bugs | skill (STANDARD, gate PASS) | **INVALID-not-independent** | (10 / 10 informational) | 0 | **pair excluded** — and baseline at ceiling ⇒ NOT-DISCRIMINATING |

**Headline:** of 5 pairs, only **Crouton (06)** and **Deepseek (10)** are clean A/B pairs, and both score **equal across arms** — no discrimination observed in this batch. The two strongest single data points (Mercury baseline 10/10 on spec 09; Deepseek 8/8 on spec 10 both arms) show capable models **saturating** these static batteries without the skill. Three runs are uncountable (1 contaminated baseline, 2 invalid skill arms) — all three failures are process-fixable (see Findings).

---

## Per-run detail

### Crouton Alpha — spec 06 calculator — baseline — VALID

Scorer output (2 pass, 0 fail, 8 manual):

```
01 PASS   one index.html, no external references (denylist scan)
02 PASS   no eval / Function( / string-argument setTimeout or setInterval in code
03–10 MANUAL (operator precedence, 0.1+0.2, divide-by-zero, %, C/⌫/±, history tape, 360px, console-clean) — no RUN-NOTE/evidence → excluded
```

Single `index.html` (16,100 bytes), no `one-shot-work/` — baseline fingerprint clean.

### Crouton Alpha One-shot — spec 06 calculator — skill — VALID

Tells: `one-shot-work/` complete (SPEC, ASSUMPTIONS, GATE, PROGRESS); `PROGRESS.md`: `Skill: one-shot | Rigor: STRICT | Output type: single-file web app | Gate: PASS (see GATE.md)`.

Scorer output: identical shape to baseline — **2 pass, 0 fail, 8 manual (excluded)**. `index.html` 16,760 bytes; no denylist hits.

Pair note: the static battery for spec 06 has only 2 criteria; the other 8 need interaction evidence that was not saved. The pair is clean but non-discriminating on admissible evidence alone.

### Deepseek v4.1 Flash — spec 10 data transform — baseline — VALID

Scorer output (8 pass, 0 fail, 2 manual):

```
01 PASS   single transform.py, all imports stdlib (denylist scan)
02 MANUAL run python transform.py … (exit 0 / exit 2 outputs) — not saved in run folder → excluded
03 PASS   USD 2300.49, EUR 3734.56, INR 65500.75 match the golden
04 PASS   rows 5 (E001), 13 (E010)
05 PASS   rows 9, 10, 11, 14, 15 all listed with reasons
06 PASS   min 2026-01-05, max 2026-01-20 (DD/MM and month-name forms parsed correctly)
07 PASS   totals match the golden — $1,200.50 / ₹45,000 / 1.234,56 € / 2.500,00 € all parsed
08 PASS   exactly the five specified keys
09 PASS   USD 3, EUR 2, INR 3 (sums verified through totals)
10 MANUAL readability judgment — no RUN-NOTE → excluded
```

**8/8 on the static battery including the golden compare, from the baseline arm.** The transform is fully correct without the skill.

### Deepseek v4.1 Flash With One-shot — spec 10 data transform — skill — VALID

Tells: `one-shot-work/` complete (SPEC, ASSUMPTIONS, GATE, PROGRESS + `test_transform.py` — the arm even shipped tests); `PROGRESS.md`: `Skill: one-shot | Rigor: STRICT | Output type: Python CLI tool | Gate: PASS`.

Scorer output: **identical to baseline — 8 pass, 0 fail, 2 excluded.**

Pair note: **ceiling/ceiling — spec 10 does not discriminate for this model.** Both arms produced golden-exact output. Per the design rule (baseline ≥90% ⇒ NOT-DISCRIMINATING), spec 10 is NOT-DISCRIMINATING for Deepseek v4.1 Flash.

### Gemini 3.8 — spec 08 expense splitter — baseline — **CONTAMINATED (not scored)**

The baseline folder contains a complete skill execution: full `one-shot-work/` (SPEC, STACK, PLAN, PROGRESS, GATE, ASSUMPTIONS) with `GATE.md` opening `Skill: one-shot | Rigor: STANDARD | Gate: PASS` and a one-shot-format SPEC for "SplitBird (Spec 08)". Per PROTOCOL: *baseline arm shows the skill fingerprint → flag, do not score, check park/restore.*

**Action for the user:** confirm whether `park-skill.sh` was run before this baseline. Most likely the skill-prefixed prompt was pasted into the baseline session. The build itself is real (14 tests, `node:sqlite`), but it cannot serve as a baseline.

### Gemini 3.8 With One-shot — spec 08 expense splitter — skill — VALID (pair unusable)

Tells complete (STANDARD, Gate: PASS). Scorer (1 pass, 0 fail, 9 manual):

```
01 PASS   README names test command 'npm test' and run command 'npm start'; 4 server source files, 1 test file
02–10 MANUAL (400-validation, per-currency balances, settle math 10/40, suite output, URL literal, live list, restart persistence, console-clean, 2-decimal) — excluded (no RUN-NOTE/evidence)
```

All files differ from the baseline folder's (verified by `diff -rq`), so the skill arm is a genuine separate run — but with the baseline contaminated, **no pair delta exists**.

### Kilo Auto Beam 1.0 — spec 07 pomodoro — baseline — VALID

Scorer (1 pass, 0 fail, 9 manual):

```
01 PASS   one index.html, no external references (denylist scan)
10 MANUAL wall-clock pattern found: 'function remaining(){if(state.paused)return state.pausedRemaining;…' — needs interaction evidence → excluded
02–09 MANUAL — excluded
```

### Kilo Auto Beam 1.0 with one-shot — spec 07 pomodoro — skill — **INVALID-incomplete (informational only)**

Tells: `one-shot-work/` holds only SPEC + PROGRESS; `PROGRESS.md`: `Skill: one-shot | Rigor: LITE | Output type: single-file web | Gate: not run`. The skill genuinely ran (header line present) but never completed its LITE-required self-review/run-path check. Per protocol the run cannot be counted in the skill arm. Informational scorer result: **1 pass, 0 fail, 9 excluded** — notably its `remaining()` is also wall-clock-based (`if(state.paused||!state.running)return state.pausedRemaining`), same shape as the baseline's.

**Action for the user:** rerun this cell at STANDARD rigor (or at least let LITE finish its gate), fresh session.

### Mercury 3 — spec 09 brownfield bugs — baseline — VALID — **10/10**

Scorer static: `02 PASS` (7/7 manifest files byte-identical, whitelist honored), `07 PASS` (package.json sha256 match). The remaining eight MANUAL criteria are judged from the run's saved evidence per the spec-09 clause:

| Criterion | Evidence | Verdict |
|---|---|---|
| 01 originals still passing | `run/baseline-test.log` — 12 tests, 12 pass | PASS |
| 03 Bug A (dates) | `run/repro-a.log` (pre-fix: 03:30Z note grouped under 2026-11-06); `server.js` diff — `dayKey()` rewritten to local calendar date; regression A in suite; `run/revert-check-a.log` watched-red (actual 2026-11-06 vs expected 2026-11-07) | PASS |
| 04 Bug B (search) | `run/repro-b.log` (q=todo → 0 results pre-fix); `server.js` diff — `toLowerCase()` needle; `run/revert-check-b.log` watched-red | PASS |
| 05 Bug C (delete) | `run/repro-c.log` (DELETE id 1 removed id 2 pre-fix); `server.js` diff — `findIndex` on id with −1 → 404; `run/revert-check-c.log` watched-red | PASS |
| 06 15 tests + revert-verified | `run/final-test.log` — 15 tests, 15 pass; revert checks a/b/c all show failing assertions | PASS |
| 08 NOTES.md four-part docs | `NOTES.md` — Bug A/B/C sections each carry File / Observed wrong behavior / Root cause / Fix (grep-verified 4/4 in B and C spans; Bug A read in full — root cause names the exact double-shift mechanism) | PASS |
| 09 no unhandled errors | `run/smoke.log` — "PASS no unhandled errors in server stderr" | PASS |
| 10 full suite green one run | `run/final-test.log` — 15/15 | PASS |

All three seeded bugs reproduced before fixing, fixed minimally (only whitelisted files changed, confirmed by the scorer's byte-identity check), regression-tested, and revert-verified watched-red. **This is a model-executed kee-standard fix chain with no skill.**

### Mercury 3 With One-shot — spec 09 brownfield bugs — skill — **INVALID-not-independent (informational only)**

Tells complete (STANDARD, Gate: PASS 2026-11-08) and its own evidence chain is real (revert logs watched-red, 15/15 suite, smoke clean). **But the deliverables are not independent work:**

- `notes-app/server.js` sha256 `6726a1d69d93a4910dd121c9cd9181c4915893a6523471047a03bf0407aa89ae` — **identical to the baseline run's**, including the fix comment prose (`// Formatted from the local calendar date of the stored instant…`).
- `notes-app/tests/notes.test.js` sha256 `d0a402b12ed97dfd4f5f69cdfac6424a87abfcf5042dca3936819b5f3b77633b` — **identical to the baseline run's**, including the three new tests' wording.
- Its `run/baseline-hashes.txt` proves the session **started from a pristine starter** (`server.js = 6d82b7e7…`, starter bytes) — so the identical finished bytes were not already in the workspace at start; they arrived during the run, ~9 minutes after the baseline run finished (mtimes 17:25–17:26 vs 17:34–17:35, 2026-11-08).
- Its `run/repro-a.js` is the baseline's script with the explanatory comments stripped — not an independent rewrite.

Conclusion: the skill session had the earlier run's solution available and used it. The bug-hunt was performed once, by the baseline run. **The pair cannot measure the skill's effect; excluded from skill-arm scoring.** (Informational static score: 2 pass / 0 fail / 8 judged-pass from its evidence chain — not counted.)

**Action for the user:** rerun the skill arm in a fresh folder that contains only the starter copy — the baseline output must not exist anywhere the session can read.

---

## Findings

1. **No discrimination observed in batch 1.** Both clean pairs (06, 10) score equal across arms, and the strongest baselines hit the battery ceilings (spec 10: 8/8 both arms; spec 09: 10/10 baseline). With capable models, specs 09 and 10 do not separate the arms; spec 06/07's static batteries are too small (1–2 criteria) to separate anything without behavioral evidence.
2. **The binding constraint is evidence, not scoring.** No RUN-NOTE.md, no screenshots, no saved transcripts anywhere — 51 of the 60 criterion-ratings in this batch were unexcludable-only-by-rule (excluded MANUAL). The next batch's value depends almost entirely on saving RUN-NOTE.md and interaction evidence per run.
3. **Three process failures, all preventable:** (a) Gemini baseline ran with the skill present — park-skill.sh was not used or the wrong prompt was pasted; (b) the Kilo skill arm stopped before its gate; (c) the Mercury skill arm reused the baseline's solution bytes. Each maps to an existing protocol rule (arm hygiene, fresh session, fresh folder); the rules just weren't executed.
4. **What the batch does show:** on a strong model, the skill arm loses nothing measurable where the baseline is already at ceiling (Crouton 2/2, Deepseek 8/8) — no harm signal; and the one place the skill ran cleanly on a non-saturated task (Gemini spec 08 skill arm) produced a complete, gate-passed build, but has no baseline to compare against.

## Recommended next batch (cheapest discriminating moves)

1. Fix process: `park-skill.sh` → baseline → `restore-skill.sh` → skill arm, **fresh folder per run**, RUN-NOTE.md + saved interaction evidence mandatory.
2. Prefer specs whose batteries are mostly static (10, 09) or add interaction evidence to 06/07/08 runs; against ceiling baselines, these specs cannot discriminate — consider harder variants before more runs.
3. Rerun the three uncountable runs (Gemini baseline, Kilo skill, Mercury skill) before drawing any per-model conclusions.

*Generated by the scoring audit; scores are recomputable with `python -I benchmark/checks.py` at `5a43a95`.*

## Addendum — Mercury pair provenance (recorded same day, after the main audit)

The project's session memory records that **both Mercury runs were executed by agents in an earlier session on 2026-11-08** — not by an external "Mercury 3" model: an agent ("mercury-3 arm") created `E:\Skill-OneShot\Mercury 3\`, copied the starter contents, and ran the Spec-09 baseline flow; the `/one-shot` arm then ran in `TEst LLM's\Mercury 3 With One-shot\` (the memory even notes "identical 3 bugs/fixes/tests" across the arms). The forensic trail matches exactly: the baseline arm's logs embed the original `E:\Skill-OneShot\Mercury 3\run\…` paths (folders later moved), while the skill arm's logs embed the current `TEst LLM's\…` paths, and the skill arm's `GATE.md` run line uses benchmark vocabulary ("one-shot arm") an external model would not naturally produce.

Consequences: (1) the byte-identical deliverables are explained — same agent lineage, second arm able to read the first's output; (2) the "Mercury 3 baseline 10/10" is **pilot data, not benchmark evidence** — it demonstrates the scoring pipeline works end-to-end (which it does, beautifully: every criterion was decidable from saved evidence), but it is not a model-arm result, and as an agent run it also cannot be a clean baseline (the skill was present in the executing agent's catalog); (3) the scoring decision is unchanged — the pair was already excluded. The other four pairs carry no such provenance problem.

**User to confirm:** whether the Mercury pair was the intended pilot (in which case it should live outside `TEst LLM's\`, e.g. renamed `PILOT-Mercury-3`, so the results tree contains only external-model runs), and whether `park-skill.sh` was run before the Gemini baseline.

