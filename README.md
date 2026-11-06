# one-shot

Spec in, verified project out. A skill that makes an AI coding agent plan like a senior team, build in small tested slices, review its own work, and pass a release gate before it says done. Built to help cheap and local models, and to cut the second and third prompt rounds on strong ones.

## Install

```sh
# Claude Code (installs to ~/.claude/skills)
git clone https://github.com/HailLucifer666/one-shot.git one-shot && cd one-shot && ./install.sh

# OpenCode (global skills dir)
git clone https://github.com/HailLucifer666/one-shot.git one-shot && cd one-shot && ./install.sh ~/.config/opencode/skill

# ZCode
git clone https://github.com/HailLucifer666/one-shot.git one-shot && cd one-shot && ./install.sh ~/.zcode/skills

# Harnesses without a skills loader (Codex CLI, Gemini CLI, ...): copy the
# one-shot/ folder anywhere and point the agent at it - add to AGENTS.md:
#   When building a project, read and follow one-shot/SKILL.md.
```

## Use

Put your PRD, MVP, SOW, stack and references in your project folder, then run:

```
/one-shot build this
```

No spec yet? Describe the idea. The skill writes the PRD and picks a stack for you.

## How it works

1. Intake: checks the spec against a minimum checklist; asks at most one batched question.
2. Spec: writes SPEC.md and STACK.md if missing, with versions verified, not remembered.
3. Plan: vertical slices with acceptance tests, saved to files so context resets lose nothing.
4. Build: one slice at a time, tests after each, all earlier tests must stay green.
5. Self-review: engineer, QA, security and designer passes, in writing.
6. Release gate: security, quality and delivery checklist, then an honest final report.

Rigor adapts to the model: LEAN for strong models, STANDARD by default, STRICT for small or local ones.

## Results

Measured Oct 31 - Nov 1, 2026. Harness: ZCode. Model: GLM 5.3 Flash. Design: ambient-labeled two-arm benchmark — both arms keep the full ambient skill catalog; `/one-shot` is added only to the skill arm. 5 specs x 2 repeats per arm, fresh session per run, verbatim prompts, one prompt only. Every number below traces to a sentinel-gated `RESULT.json` vendored under `benchmark/runs` (full run outputs retained in the project's `_runs-zcode` workspace archive; scoring method recorded in each record). Runs scoring below 10/10 get follow-up prompts actually sent and counted. The skill arm ran version 0.1 (sha256 prefix `d17a33667c28c421`); the 0.1.1, 0.1.2 and 0.1.3 fixes each came from external tests after this measurement and are unmeasured on this benchmark.

| Model | Mode | Runs | First-run pass rate | Mean criteria (of 10) | Median follow-ups | Mean tokens |
| --- | --- | --- | --- | --- | --- | --- |
| glm-5.3-flash (ZCode) | baseline | 10 | 10/10 (100%) | 10.0 | 0 | 1,989,716 |
| glm-5.3-flash (ZCode) | skill | 10 | 10/10 (100%) | 10.0 | 0 | 2,718,866 |

**The honest headline: on this benchmark, a full tie.** GLM 5.3 Flash with this ambient catalog maxes all 50 criteria in both arms — the benchmark did not separate the arms on pass rate. What the measurement DID show, with evidence:

- **Token economics differ by spec.** Mean tokens per run: baseline 1.99M vs skill 2.72M. Per spec: slide decks **2.7x cheaper with the skill** (0.69M vs 1.84M — its verify loop skipped rework), auth apps **2.6x dearer** (4.45M vs 1.69M — it built TypeScript, helmet, rate limiting and 48-56-test suites where baselines built 26-36-test JavaScript), dashboards 2.1x dearer.
- **Depth beyond the criteria.** Skill-arm apps consistently shipped more than the spec asked nowhere and more *verification* than baselines: self-authored checkers in every `one-shot-work/`, gate-style known-limitations sections in every report, four self-caught defects fixed mid-build in one game.
- **A scorer lesson, published as required.** Three checker false-FAILs were caught by measuring twice (.mjs test files, deck chrome in word counts, JS-rendered speaker notes); one apparent skill win dissolved under independent measurement into the tie recorded here. The scoring method and every correction are in the run records.
- Earlier OpenCode pilot runs (2 models x 5 specs) are retained as exploratory data only — in the project workspace archive, not in this repo; they are not part of this table.

### Re-measurement: v0.1.4 (2026-11-05, audit battery)

A full 20-run re-measurement (5 specs x 2 arms x 2 repeats, same protocol: fresh session per run, verbatim prompts, one prompt only, MANUAL criteria judged from recorded verification evidence) ran as part of the 2026-11-05 audit, after the scorer gained a 66-test calibration suite and false-FAIL fixes. Records in `benchmark/runs-v014/`, builds archived in the project workspace; full protocol deviations disclosed in [`AUDIT-2026-11-05.md`](AUDIT-2026-11-05.md).

| Model | Mode | Runs | First-run pass rate | Mean criteria (of 10) | Median follow-ups | Mean tokens |
| --- | --- | --- | --- | --- | --- | --- |
| glm-5.3-flash (ZCode) | baseline | 10 | 10/10 | 10.0 | 0 | 3,310,820 |
| glm-5.3-flash (ZCode) | skill | 10 | 10/10 | 10.0 | 0 | 5,072,516 |

**The honest headline: the tie replicates.** A strong model maxes these specs in both arms; the ceiling noted below still holds. Token premium overall 1.53x, concentrated in the auth spec (5.09x) and absent on the game spec (0.94x); the October deck-economics finding reversed at n=2 — read neither as a trend. The skill arm produced `one-shot-work/` state and a recorded release gate in 10/10 runs and self-caught real defects mid-build in 6/10; baselines self-corrected in 4/10. The skill arm ran v0.1.4 (sha256 prefix `e183a8cd00db0302`); v0.1.5 (version field, autonomous retry fallback, template-path references) is **unmeasured**. Ambient catalog differed from October (dev-studio playbooks present in both arms), so cross-battery comparison is confounded; within-battery comparison is like-for-like.

**Limitations of this measurement:** n=10 per arm, one model, one harness, one weekend. The benchmark's criteria were not hard enough to separate arms on a model that maxes them — distinguishing pass-rate differences needs harder specs or weaker models. Manual criteria were judged from each run's recorded browser-verification evidence with independent spot-checks of the riskiest claims (deck word caps, speaker notes, game persistence); the full method is disclosed in every RESULT.json. Never claim secure or bug-free: all 20 outputs are benchmark artifacts, not audited software.

## Hard-mode follow-up (GLM 5.3 Flash, 2026-11-01)

A harder five-spec pack (vague brief, conflicting requirements, security traps, brownfield change, salon booking) ran as a second benchmark. Honest result, per the pack's own pre-registered rules: **only 2 of 5 specs discriminate pass-rate on this model** (H1 44.7% and H4 77.8% baselines; H2/H3/H5 are ceilings) — below the "3 of 5" bar the pack set for launching a validated benchmark, so the fallback applies: publish what was learned. On the two specs that do measure, **the skill won both**: H1 on median fix rounds (1 vs 2, zero regressions, ~1.6× tokens) and H4 security-traps on first-run pass rate (17/18 vs 14/18, +16.6 points, n=1) — with the skill arm's cheapest build (3.8M tokens) scoring its best result. Every cell is labeled n=1 per arm (the pre-registered n=2 was not reached within budget; run2 is explicitly queued, not silently dropped). Full tables, per-criterion evidence types, battery provenance and the defects-found list: [`benchmark-hard/RESULTS.md`](benchmark-hard/RESULTS.md).

## Limitations

- A skill is instructions, not intelligence. It improves process; it cannot guarantee a result or make a weak model strong.
- The release gate reduces risk. It does not prove software is secure or bug-free.
- Version 0.1 has modules for web and app work only. Slides, documents, games and media use the core pipeline with no extra module — the benchmark's slide-deck and game specs were scored against that same core pipeline on both arms.
- The skill is model-agnostic (plain markdown; rigor levels scale to the model). The measured table covers one model on one harness; other models and harnesses are unmeasured until run.
- Stack defaults reflect 2026 sources and go stale; the skill tells the model to verify versions.

## Repo layout

- `one-shot/`: the skill (SKILL.md, gate.md, modules/, templates/)
- `benchmark/`: five specs, scoring guide, run scaffolder, calibration suite (`test_checks.py`)
- `benchmark-hard/`: the adversarial five-spec pack, its pre-registrations and results
- `docs/`: PRD, MVP, SOW, stack notes, build prompt
- `scripts/`: `validate_skill.py` (checks frontmatter, size and references) and its tests
- `AUDIT-2026-11-01.md`, `AUDIT-2026-11-05.md`: the two full audits — findings, probes, triage

## License

MIT
