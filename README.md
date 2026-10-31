# one-shot

Spec in, verified project out. A skill that makes an AI coding agent plan like a senior team, build in small tested slices, review its own work, and pass a release gate before it says done. Built to help cheap and local models, and to cut the second and third prompt rounds on strong ones.

## Install

```sh
# Claude Code (installs to ~/.claude/skills)
git clone <your-repo-url> one-shot && cd one-shot && ./install.sh

# OpenCode (global skills dir)
git clone <your-repo-url> one-shot && cd one-shot && ./install.sh ~/.config/opencode/skill

# ZCode
git clone <your-repo-url> one-shot && cd one-shot && ./install.sh ~/.zcode/skills

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

Fill this table from real runs of the benchmark in `benchmark/` (see `benchmark/SCORING.md`). Do not publish numbers you did not measure.

- "First-run pass rate" is defined only in `benchmark/SCORING.md`; this table does not restate it.
- Token counts in skill mode include the skill-instruction overhead, so cross-mode token comparison overstates the skill's cost.
- Specs 04 (slide deck) and 05 (browser game) run through the core pipeline only — no dedicated module exists in v0.1 — and are scored against the same core criteria.
- The skill is model-agnostic (plain markdown instructions; rigor levels scale to the model); the measured evidence in this table covers only the two free models listed.
- If fewer than all 5 specs are measured at publish time, this table states "measured on N of 5 specs" and missing cells stay empty until measured. Sample size (n) per cell is shown.

| Model | Mode | Runs | First-run pass rate | Mean criteria (of 10) | Median follow-ups | Mean tokens |
| --- | --- | --- | --- | --- | --- | --- |
| | baseline | | | | | |
| | skill | | | | | |

## Limitations

- A skill is instructions, not intelligence. It improves process; it cannot guarantee a result or make a weak model strong.
- The release gate reduces risk. It does not prove software is secure or bug-free.
- Version 0.1 has modules for web and app work only. Slides, documents, games and media use the core pipeline with no extra module.
- Stack defaults reflect 2026 sources and go stale; the skill tells the model to verify versions.

## Repo layout

- `one-shot/`: the skill (SKILL.md, gate.md, modules/, templates/)
- `benchmark/`: five specs, scoring guide, run scaffolder
- `docs/`: PRD, MVP, SOW, stack notes, build prompt
- `scripts/validate_skill.py`: checks frontmatter, size and references

## License

MIT
