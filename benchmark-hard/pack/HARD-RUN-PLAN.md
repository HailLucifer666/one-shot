# Run plan

## Setup
- Arms: `baseline` (skill parked or uninstalled) and `skill` (installed, version recorded).
- Models: GLM 5.3 Flash first. DeepSeek V4.1 Flash second, if your free limits allow.
- Prompt: H1 uses `PROMPT.md` exactly. H2, H3, H4: `Build this. Here is the spec:` and the contents of SPEC.md. H5: the SPEC.md plus a copy of `starter/` as the working folder. Skill arm: start the prompt with `/one-shot`. H4: also give `llm.mock.js` or `llm_mock.py`.
- Never show the model OWNER-SHEET.md, CRITERIA.md, RUBRIC.md or PAYLOADS.md.
- Fresh folder and fresh session for every run. If your tool limits you to two parallel agents, run two at a time.

## Step 0: validity check (about 2 runs)
Run the baseline once on H1 and once on H5. Score both.
Validity rule for the whole pack: across the baseline arm, mean criteria passed must be under 90 percent on at least 3 of the 5 specs. If the plain model nearly passes everything, the specs are still too easy: make them harder before comparing arms.

## Tier 1 (8 runs): H1 and H5
Both arms, 2 repeats each, GLM 5.3 Flash. Do the full fix-round protocol and the blind rating. Look at the numbers before going on.

## Tier 2 (12 runs): H2, H3, H4
Both arms, 2 repeats each, GLM 5.3 Flash.

## Tier 3: second model
Repeat the tiers on DeepSeek V4.1 Flash, or on a small local model if you have one.

## Decision rules (write these down before you start, then do not change them)
- The skill wins a spec if mean first-run percent is at least 10 points higher, or median fix rounds is at least 1 lower, with no more regressions than baseline.
- Blind rating: the skill wins if it has more wins and a higher mean score across at least 3 raters.
- Launch the repo with these results if the skill wins at least 3 of 5 specs on at least one model and loses on no more than 1.
- Otherwise publish what you learned and fix the skill first. Do not hide a tie or a loss.
- Always show token cost next to quality. A win that costs 3 times the tokens must say so.

## After the runs
1. Put every RESULT, fix log and screenshot pair into the repo under `benchmark-hard/runs/`.
2. Fill the results table and README with the real numbers.
3. Make the launch visual: five before and after screenshots, plus the clearest measured win. Write the post only after the numbers exist.
