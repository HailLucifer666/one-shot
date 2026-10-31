# Scoring hard mode

## Per run, record
1. **First-run criteria passed**, as a number and a percent. H1: auto 15 plus manual 16 to 20 (20 comes from blind rating, so score 1 to 19 by hand for now). H2, H4: count yes answers. H3: rubric. H5: runner (7 criteria).
2. **Fix rounds** to reach 100 percent, capped at 5.
3. **Regressions**: things that passed before a fix round and failed after it.
4. **Tokens** used, from your tool's usage display or the harness record.
5. **Interview coverage** (H1 only): how many of the 12 owner-sheet topics the model asked about before building.
6. **Skill version** (skill arm): the SKILL.md sha or tag.

## Fix-round protocol (identical for both arms)
- After scoring the first run, send ONE message listing only the failing criteria, copied word for word from CRITERIA.md, RUBRIC.md, PAYLOADS.md or the runner output.
- Do not add hints, opinions or design direction. Do not answer new questions beyond the owner sheet.
- Re-score. Repeat until 100 percent or 5 rounds.
- Log each round in the fix log with a category: missing, broken, generic-looking, ignored-instruction, over-built, regression.

## Blind design rating
- Screenshot the main screen of H1, H2 and H5 at 1280 px wide for every run, saved as `shots/<spec>/baseline.png` and `shots/<spec>/skill.png` (one pair at a time, matching run numbers).
- `python tools/blind_rate.py prep --shots shots --out blind`, then give `blind/` to three or more people who did not build it. Score guide: 1 generic template, 3 fine but forgettable, 5 looks designed for this business.
- `python tools/blind_rate.py summary --key blind_key.json --ratings "blind/rating_*.csv"`.

## Results table (fill from real data)
| Model | Spec | Arm | Runs | Mean first-run % | Median fix rounds | Regressions | Mean tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Honesty rules
- Publish all runs, bad ones included, and the sample size. Four runs per cell is small; say so.
- Do not change the skill between runs of one set. If you patch it, start a new set with the new sha.
- Do not tune the skill on a spec and then cite that same spec as proof without saying so.
- Report the token ratio next to every quality claim.
