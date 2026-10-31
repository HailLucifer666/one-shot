# Skill patch for v0.1.4 (apply to your local v0.1.3)

Keep SKILL.md at 150 lines or fewer. Every line below exists to stop a failure you have seen or a hard-mode spec tests. This patch is NOT measured: after applying it, record the new SKILL.md sha and run the hard-mode set with it.
Section names refer to the v0.1.x layout (Setup, Intake, Spec, Plan, Build loop, Self-review, Release gate, Modules, Rules, Final report). Adjust numbering to match yours.

## Spec (fixes B1: a supplied PRD never reaches SPEC.md)
Add:
- If the user supplied a PRD or spec, copy every requirement into SPEC.md as numbered, checkable acceptance criteria BEFORE planning. An empty SPEC.md blocks planning.
- If requirements conflict, or any is impossible, list each in ASSUMPTIONS.md with the resolution you chose, and put the list at the top of the final report. Never satisfy one requirement by silently dropping another.

## Build loop (fixes B5: "all tests pass" is vacuous at zero tests)
Add after the test step:
- Every output type needs at least one executable check: web or app: tests or a scripted smoke test that starts it and exercises the main flow; deck or document: a script that counts slides, words or sections against SPEC.md; game: a run that loads with no console errors. Zero tests is a failure, not a pass.

## Release gate (fixes B4: the gate could never fail)
Replace the gate paragraph with:
- The gate result is PASS or BLOCKED. BLOCKED means a must-have criterion is unmet or a check fails. On BLOCKED, return to the build loop for those items (maximum 3 attempts per item), then re-run the gate. If still BLOCKED, report NOT DONE with the list of failing items at the top. Never report done on BLOCKED. Only nice-to-have items may become known limitations.

## Setup and templates (fixes B2: a context reset kills the gate obligation)
Add to the PROGRESS.md template header and to Setup:
- First lines of PROGRESS.md: Skill: one-shot | Rigor: ___ | Output type: ___ | Gate: not run, PASS or BLOCKED. After any context reset, read this first and continue the pipeline.

## Final report (fixes B3 and B8: unverified claims, write-only assumptions)
Replace with:
- Every claim cites a file path or the output of a command you ran. List every assumption from ASSUMPTIONS.md. List the real files created.

## Spec / stack (fixes B6: "verified" typed without running anything)
Add:
- "Version verified" requires the command you ran and its output line pasted into STACK.md. No pasted output means not verified.

## Intake (fixes B7: escalation with no user present)
Add:
- If no user is reachable (autonomous run), record the question in BLOCKERS.md, take the safest default, continue, and put it at the top of the final report.

## Rules (token cost; your benchmark showed apps cost about 2.6 times more)
Add:
- Append to state files; do not rewrite them whole. Load a module only when the output type needs it. One self-review pass per slice for LEAN and STANDARD. Do not re-read files you just wrote.

## Setup (lite path, so it is worth using on small tasks)
Add:
- LITE: if the output is a single file or under about 200 lines, skip PLAN.md and STACK.md, ask at most 5 questions in one round, build in one slice, and still run a self-review and a run-path check.

## Intake and modules (interview and taste; copy `intake.md` from the v0.2 zip if your folder lacks it)
Add:
- Ask the question set for the output type from `intake.md`, one round, with defaults.
- If design or engineering skills such as frontend-design or UI UX Pro Max are installed, read the relevant ones before building UI and apply them. Name the ones used in the final report. The user's brief wins any conflict.

## After patching
1. Run `python scripts/validate_skill.py` and fix any error (runtime files such as one-shot-work/GATE.md stay outside backticks).
2. Record the new sha: `sha256sum one-shot/SKILL.md`.
3. Run the hard-mode set with it and keep the old v0.1 results separate.
