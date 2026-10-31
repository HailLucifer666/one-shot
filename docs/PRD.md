# PRD: one-shot v0.1

## Problem
Developers using AI coding agents often need two or three prompt rounds to fix wrong architecture, missing features, broken integrations, regressions and bloated code. Smaller and local models fail more often.

## Users
Primary: solo developers and students on free or cheap models. Secondary: frontier-model users who want fewer iterations.

## Goals
- Raise first-run success on a fixed benchmark versus the same model with no skill.
- Cut the follow-up prompts needed to reach the acceptance criteria.
- Keep the core skill short enough for small models to follow.

## Non-goals for v0.1
- Guaranteeing 95 to 100 percent success or bug-free software.
- Slides, video, audio and game modules.
- A custom CLI, plugin marketplace or hosted service.

## Requirements
| ID | Requirement | Priority | Acceptance criterion |
| --- | --- | --- | --- |
| F1 | Slash invocation reads the spec package from the folder or the message | P0 | /one-shot starts with no extra setup |
| F2 | Intake gate checks a minimum checklist | P0 | Asks at most one batched question; logs assumptions |
| F3 | Spec writer produces SPEC.md and STACK.md when missing | P0 | Both files exist before any code |
| F4 | Planner writes PLAN.md and PROGRESS.md of vertical slices | P0 | Every slice has a goal and an acceptance test |
| F5 | Build loop: one slice at a time, tests after each | P0 | Earlier tests stay green after every slice |
| F6 | Rigor levels: Lean, Standard, Strict | P0 | Level is stated in one line at the start |
| F7 | Release gate with an honest final report | P0 | Every item ticked or listed as a known limitation |
| F8 | Anti-slop and terse-output rules | P0 | No unrequested features; status lines of 1 to 2 sentences |
| F9 | Web and app modules | P0 | Loaded only for those output types |
| F10 | Benchmark kit: 5 specs and a scoring sheet | P0 | Baseline and with-skill runs recorded |
| F11 | Stack module that makes the model verify current versions | P0 | Versions checked before pinning |
| F12 | Slides, docs, game and media modules | P1 | After launch |

## Success metrics
On each test model: first-run pass rate (defined only in benchmark/SCORING.md), median follow-up prompts, tokens per finished spec. Target: the skill beats the no-skill baseline on at least 3 of 5 specs on both models.

## Constraints
Solo builder, one weekend, free models, core SKILL.md under about 150 lines, plain markdown, no paid services.

## Risks
| Risk | Mitigation |
| --- | --- |
| Weak models ignore long instructions | Short core file, state in files, Strict mode |
| Benchmark noise | Run each spec twice, report per-spec results with the sample size (n) shown |
| Overclaiming | Publish real numbers, including failures |
| Models know outdated library versions | Verify versions at build time (F11) |
