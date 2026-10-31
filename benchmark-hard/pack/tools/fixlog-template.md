# Fix log (one per run)

Run: <model> / <arm: baseline or skill> / <spec> / run<N>
Skill version (sha or tag, skill arm only):

## First-run result
Criteria passed: __ of __
Tokens used: __

## Questions the model asked before building (H1 and any spec where it asks)
1.
(Topics from the owner sheet it covered: __ of 12)

## Fix rounds
Rule: each round, send ONE message that only lists the failing criteria, copied word for word from CRITERIA.md or the runner output. No extra hints. Stop at 100 percent or after 5 rounds.

| Round | Failing criteria sent | Passed after the round | Category (missing, broken, generic-looking, ignored-instruction, over-built, regression) |
| --- | --- | --- | --- |
| 1 | | | |

Regressions (something that passed before and fails now): __
Total fix rounds to 100 percent (or "5+ and still failing"): __
Lines added after the first run (optional): __
