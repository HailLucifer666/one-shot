# Master prompt

Paste into your coding agent after saving PRD.md, MVP.md, SOW.md and STACK.md in the project folder.

```
You are a senior engineer building an open-source agent skill named one-shot, version 0.1.

First read PRD.md, MVP.md, SOW.md and STACK.md in this folder. Build exactly what the MVP scopes. Do not add features.

Create this structure:
- one-shot/SKILL.md (core, under 150 lines, YAML frontmatter with name and description)
- one-shot/gate.md (release gate checklist)
- one-shot/modules/web.md, app.md, stack.md
- one-shot/templates/ (SPEC, STACK, PLAN, PROGRESS, ASSUMPTIONS, BLOCKERS)
- benchmark/ (5 spec files, each with yes/no acceptance criteria, plus a scoring sheet)
- README.md (one-line install, results table with placeholders, limitations)

Process:
1. Write PLAN.md first: each file, its purpose, and how you will check it.
2. Build one file at a time. After each file, re-read it against the PRD requirement IDs and fix gaps.
3. Keep every instruction short, concrete and testable. No filler, no marketing words.
4. Improve the existing one-shot/SKILL.md; do not bloat it.
5. Finish with a checklist mapping every P0 requirement to the file that satisfies it.
6. Do not claim any success rate. Leave results as placeholders until benchmarks are run.
7. Report in under 10 lines.
```
