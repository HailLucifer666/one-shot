# one-shot hard-mode pack

Your first benchmark tied at 10/10 because the specs were easy and fully written out. This pack is built so that a plain model run fails some things. It tests what the skill is for: vague briefs, long builds, conflicting requirements, security traps, and changing existing code without breaking it.

## What is inside
| Spec | Tests | Checking |
| --- | --- | --- |
| H1 vague coffee shop | the interview and brief-honoring | 15 automatic checks, 5 manual, blind design rating |
| H2 salon booking | long build, many rules, concurrency, time zones | 27 scenario criteria (manual, exact steps inside) |
| H3 conflicting requirements | spotting conflicts instead of ignoring them | rubric plus a small script |
| H4 security traps | OWASP-style flaws and prompt injection | 18 payload checks (manual, exact payloads inside) |
| H5 brownfield change | fix-one-break-another, regressions | fully automatic runner |

Tools in `tools/`: `check_h1.py`, `check_h3.py`, `run_h5.mjs`, `blind_rate.py`, `fixlog-template.md`. I ran them here against sample outputs (H5 against an unmodified starter and a reference solution I wrote; the reference is not in the pack). I have not run any model through them.

## Quick start
1. Read `HARD-RUN-PLAN.md`. Write down your decision rules before you run anything.
2. Do the validity check first (2 baseline runs). If the plain model passes everything, the specs are still too easy.
3. For each run: fresh folder, fresh session, one prompt, score, then follow the fix-round protocol in `HARD-SCORING.md`.
4. Fill one `tools/fixlog-template.md` per run.
5. Take screenshots for blind rating, then use `tools/blind_rate.py`.
6. Publish every run, including the bad ones.

`SKILL-PATCH-v0.1.4.md` (next to this pack) has the skill changes I recommend. Apply them in a separate pass, not in the middle of a run set.
