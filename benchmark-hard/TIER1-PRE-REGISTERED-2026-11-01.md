# TIER 1 PRE-REGISTRATION — 2026-11-01 (written before any Tier 1 run)

Pack decision rules (HARD-RUN-PLAN.md, verbatim, unchanged):
- The skill wins a spec if mean first-run percent is at least 10 points higher, or median fix rounds is at least 1 lower, with no more regressions than baseline.
- Blind rating: the skill wins if it has more wins and a higher mean score across at least 3 raters.
- Launch the repo with these results if the skill wins at least 3 of 5 specs on at least one model and loses on no more than 1.
- Otherwise publish what you learned and fix the skill first. Do not hide a tie or a loss.
- Always show token cost next to quality. A win that costs 3 times the tokens must say so.

Session rules for Tier 1:
1. Tree: `E:\Skill-OneShot\_runs-hardmode\glm-5.3-flash\tier1\{baseline,skill}\{H1-vague-coffee-shop,H5-brownfield}\run{1,2}`. Step 0 runs are validity evidence only and are NOT Tier 1 data.
2. Specs: H1 unchanged. H5 = strengthened v2 (C2 unknown-param 400 + C8 persistence) for BOTH arms — same spec, same runner, fair comparison.
3. Skill arm: one-shot v0.1.4, SKILL.md sha256 prefix `e183a8cd00db0302`, installed and hash-verified before any skill-arm run. Prompt = `/one-shot ` + spec verbatim. Baseline arm: skill parked (absent from catalog), prompt = spec verbatim.
4. Fix rounds per HARD-SCORING.md: after first-run scoring, ONE message listing only the failing criteria copied word for word from CRITERIA.md / runner output; no hints, no opinions, no new answers beyond the owner sheet; re-score; repeat to 100% or 5 rounds; every round logged with a category.
5. Tokens from harness sentinels. Fingerprint: skill arm expects one-shot-work/ present; baseline expects absent (contamination flag otherwise).
6. H1 first-run denominator: 19 (criteria 1–19; 20 is blind rating). H5 denominator: 8 (C1–C8; C5's manual half included when verified).
7. Screenshots at 1280 px into shots/<spec>/{baseline,skill}.png for blind-rating prep; the rating itself needs 3+ HUMAN raters and is staged, not self-performed.
8. No rule here changes after results. The verdict uses the pack's decision rules as written.
