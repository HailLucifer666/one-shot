---
name: one-shot
description: Autonomous spec-to-ship builder. Use whenever the user supplies a PRD, MVP, SOW, tech stack, spec or detailed idea and wants a complete, working, verified project (app, website, landing page, slides, game, document) delivered in one run with no back-and-forth fixing. Also use when the user says one-shot, build this end to end, just ship it, or complains about AI slop, endless iterations, or broken first drafts. Plans, builds in tested slices, self-reviews, and runs a security and quality release gate before reporting done.
---

# one-shot

Goal: deliver a finished, working, verified project on the first pass. Spend effort on planning and checking, not on extra code.

## 0. Setup
0. First action, before any other work: create `one-shot-work/` (step 2) and state in one line that one-shot is loaded with the chosen rigor level. Do not load unrelated catalog skills for this build - this skill owns the whole workflow. If the user's message starts with /one-shot, this is the skill to run; do not substitute a different one.
1. Pick a rigor level and state it in one line.
   - LEAN: strong frontier model. Larger slices, one self-review per slice.
   - STANDARD: mid-tier or unknown model (default). Test and review after every slice.
   - STRICT: small, free or local model. Tiny slices (under about 150 changed lines), re-read SPEC.md before every slice, tick every checklist item in writing.
2. Create `one-shot-work/` using the files in `templates/`: SPEC.md, STACK.md, PLAN.md, PROGRESS.md, ASSUMPTIONS.md. Create BLOCKERS.md only if needed.
3. State lives in these files, not in chat memory. Re-read PROGRESS.md at the start of every slice, and again after any context reset.

## 1. Intake
- Read every file and message provided.
- Required: goal, users, core features, constraints, success criteria, output type, deploy target.
- If a required item is missing and cannot be safely assumed, ask ONE batched message, then continue. Otherwise log the assumption in ASSUMPTIONS.md and continue.
- Never ask what the provided files already answer.

## 2. Spec
- No PRD: write SPEC.md (problem, users, in scope, out of scope, acceptance criteria). Every criterion must be checkable yes or no.
- No stack: choose per `modules/stack.md`, write STACK.md, one line of justification per choice.
- Check the latest stable version of every dependency before pinning. Never trust memory.

## 3. Plan
- Split the work into vertical slices. Each slice runs and can be tested alone.
- For each slice write: goal, files touched, acceptance test, risk. Save to PLAN.md; track status in PROGRESS.md.
- Slice limits: LEAN up to 8, STANDARD up to 15, STRICT as many as needed but each under about 150 changed lines.

## 4. Build loop (per slice)
1. Re-read the slice and the spec lines it touches.
2. Write the acceptance test first when practical.
3. Write the smallest code that passes. No extra features, files or abstractions.
4. Run tests, lint, type check and build.
5. Regression rule: all earlier tests must still pass. If one breaks, fix it before anything else.
6. Before marking a slice done, verify on disk that the files it claims exist are really there (list them). A slice whose files are absent is not done - tick nothing.
7. Self-review (section 5). Fix. Update PROGRESS.md.
- Retry cap: same failure three times means write it to BLOCKERS.md, try one genuinely different approach, then ask the user.

## 5. Self-review (after each slice and at the end)
Review as four people, in writing, as short findings:
- Senior engineer: correct, simple, no dead code.
- QA: empty, error, loading and edge states.
- Security: input handling, auth, secrets.
- Designer (for any UI): hierarchy, spacing, contrast, no template defaults. Measure contrast with computed ratios, do not eyeball - a brand color may need a deepened variant for AA body-text contrast (4.5:1) on white or on brand backgrounds.
Fix every finding, then re-run tests.

## 6. Release gate
Before saying done, load `gate.md` and tick every item. Fix failures or list them under Known limitations. Mark non-applicable items N/A with a reason. Record the result as a GATE.md file inside one-shot-work/ - every item ticked, failed, or N/A. A run without a recorded gate is not done.

## 7. Modules
Load only what the output needs.
- Website or landing page: `modules/web.md`
- App, API or backend: `modules/app.md`
- Full stack: both
- Choosing technology: `modules/stack.md`
- Slides, documents, games, media: no module yet. Apply sections 1 to 6 with one acceptance criterion per slide, section or level.

## 8. Rules
- Smallest correct change. Delete dead code. Reuse existing patterns. Justify each new dependency in one line.
- Terse output: status lines of one or two sentences. Do not restate the spec. No running commentary.
- Do not add features that were not requested. Suggest them at the end instead.
- Do not rewrite working code unless the slice requires it.
- Never claim the result is secure, bug-free or finished beyond what was verified.

## 9. Final report
Under 12 lines: what was built, how to run it, what was verified (tests, checks run), known limitations, suggested next steps. Say that the release gate reduces risk and does not prove the project is secure or bug-free.
First: list the deliverable files that actually exist on disk. If the deliverable is missing, the run has failed - say so plainly and fix it before reporting anything else. A report describing files that do not exist is a false completion.
Before reporting: execute the documented run path once yourself (open the page the way the user will, or start the server the way the README says). Node tests passing is not the same as the deliverable working at its documented entry point.
