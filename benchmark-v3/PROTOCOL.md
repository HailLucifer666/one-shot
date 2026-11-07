# PROTOCOL.md — how to run the discriminating pack

**Status: EXPLORATORY** (see `PREREG-EXPLORATORY-2026-11-07.md`). These numbers are for learning and feedback, not for publication. A published claim requires a real pre-registration.

## Goal

For every spec × model, run one build WITHOUT the skill and one WITH, and collect enough evidence to score both. The pack exists because the strong-model battery tied 10/10 vs 10/10 — these specs are built to discriminate: vague briefs, exact logic, hidden-state traps, and seeded bugs.

## Folder convention

Every run lives in its own folder:

```
E:\Skill-OneShot\TEst LLM's\<model>\<arm>\<spec>\runN\
```

- `<model>`: e.g. `glm-5.3-flash`, `sonnet-4.5`, `gpt-5.1`, `ollama-qwen3-8b`, `kilocode-<model>`
- `<arm>`: `baseline` (without skill) or `skill` (with skill)
- `<spec>`: `01-landing-page`, `04-slide-deck`, `06-calculator`, … `09-brownfield-bugs`, `10-data-transform`, `vague`
- `runN`: `run1`, `run2`, …

In shell commands, quote the path (it contains a space and an apostrophe): `cd "E:/Skill-OneShot/TEst LLM's/..."`

Put the run's entire output there: the project files, screenshots, test output, the RUN-NOTE.md.

## Arm hygiene (do this BEFORE every run)

- **Baseline arm:** the skill must be OUT of the harness catalog. On ZCode and Claude Code, run `bash benchmark-v3/tools/park-skill.sh` first (it moves both installs to staging and verifies). Restore afterward with `restore-skill.sh`. If the skill is present during a baseline run, that run is CONTAMINATED.
- **Skill arm:** the skill must be installed (restore first if parked). A fresh session per run — never continue an old conversation.
- **Never edit the spec text between arms.** Both prompts come from PROMPTS.md, prefix-only difference.
- **Spec 09:** copy the **contents** of `benchmark-v3/starters/09-notes-app/` into a folder named `notes-app/` in the run folder BEFORE starting (the spec text refers to `notes-app/` in "this directory"); the agent works on that copy.
- **Spec 10:** nothing to pre-copy — the CSV is embedded in the spec and the agent saves it.

## The tells (record these for every skill-arm run)

A run may only be counted in the skill arm if these are present:

1. A `one-shot-work/` directory inside the project (SPEC.md, PLAN.md, PROGRESS.md, GATE.md).
2. An early line in the transcript like "one-shot loaded, rigor LEAN/STANDARD/STRICT".
3. The final report has a gate-style "Known limitations" section rather than bare "done!".

Missing tells = **INVALID-fingerprint** (the harness shadowed the skill — e.g. an ambient skill fired instead). Rerun the skill arm. Never count an invalid skill-arm run as a baseline.

## Run states

| State | Meaning | Action |
|---|---|---|
| VALID | Completed; tells correct for the arm | Score it |
| INVALID-fingerprint | Skill arm missing the tells | Rerun; do not score |
| INVALID-aborted | Token ceiling hit (~1.2M) mid-build | Note tokens-so-far in RUN-NOTE; do not score |
| CONTAMINATED | Baseline arm shows the skill fingerprint | Flag; do not score; check park/restore |

## Evidence rules (what makes a criterion scoreable)

- Behavioral criteria (reload persistence, hidden-tab timing, keyboard, error states, settle math) are judged from **your evidence**: screenshots or short screen recordings saved in the run folder, plus the RUN-NOTE answers. No evidence = the criterion is unverifiable — it is excluded from that run's denominator with a footnote, never counted as a pass.
- Static criteria (single file, no eval, tests exist, sha-guard) are checked from the files directly — no evidence needed from you.
- For spec 09 and 10, save the test/tool run output as a text file in the run folder.

## Follow-ups and fix rounds

- The headline metric is the **first run**: score what the first response produced, before any follow-up.
- If first-run score is 7+/10, you may send fix rounds: one message listing only the failing criteria copied verbatim, up to 5 rounds. Log each round in `fixlog.md` in the run folder (round, what was fixed, categories: missing / broken / generic-looking / ignored-instruction / over-built / regression). If you stop at the cap without reaching 10/10, record the follow-up count as `5 (capped)` in RUN-NOTE so a capped run is distinguishable from one that reached 10/10.
- If first-run score is below 7/10, record the follow-up count in RUN-NOTE as `>X` (e.g. `>3`) and stop — do not grind it out.

## RUN-NOTE.md (every run, copy this template)

See `RUN-NOTE-template.md` in this folder. It records model, harness, arm, run state, tokens, follow-ups, the vague-mode transcript questions (Q1–Q3), and the evidence files you attached.

## Blind rating (optional, for quality judgment)

For each completed pair you want rated on quality: put both builds in folders A and B (randomly assigned, names that don't reveal the arm), then fill one row per pair in `benchmark-v3/rating.csv`:

```
spec,"winner (A, B or tie)",score_A (1-5),score_B (1-5),rater
```

Reveal which build was which only after rating.

## Token budget

Each pair should total ~1–2M tokens (~0.5–1M per run). Abort a run crossing ~1.2M (INVALID-aborted). The first GLM pair per new spec verifies this budget — if a "small" spec blows past it consistently, it gets hardened or re-scoped at review, not pushed through.

## Validity rule

A spec discriminates only if the no-skill baseline scores strictly below 90% mean first-run. Your GLM baseline runs are the validity data: any spec whose GLM baselines reach ≥90% gets hardened or pruned at review before you spend other models' time on it.

## What happens to your runs

Tell me when a pair (or a batch) is done. I score every run: static criteria via the repo's scorer (extended for specs 06–10 in Wave 2 of this pack — do not start a v3 run before that lands), behavioral criteria from your evidence and RUN-NOTE, then record results in `benchmark-v3/RESULTS.md` (created with the first results) (model × arm × spec) with a per-model feedback log — where the skill helps, where it hurts, what it changes. From that we decide what gets hardened, what gets kept, and (much later) what a publishable pre-registered battery looks like.

## Post-publication candidates (too big for this pack's budget)

OTT-style full-stack streaming app; talent manager with live AI automations; agentic multimodal framework; Mythos-scale systems. These are Phase-8-scale builds needing tens of millions of tokens — they stay on the roadmap, out of this pack.
