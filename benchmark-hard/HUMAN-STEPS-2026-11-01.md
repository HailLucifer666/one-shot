# Steps that need a human — staged and ready (2026-11-01)

Everything below is prepared; each item is blocked on a person, not on work.

## 1. Blind rating (blocks the blind-rating win/loss number)

- Package: `E:\Skill-OneShot\_runs-hardmode\blind\` (created by `python tools/blind_rate.py prep --shots shots --out blind` once the skill-arm screenshots land — see below).
- Need: **3 or more raters**, each fills a copy of `blind/rating.csv` renamed `rating_<name>.csv` (columns: spec, winner A/B/tie, score_A 1-5, score_B 1-5, rater). The key (`blind_key.json`) stays with the organizer only.
- Then: `python tools/blind_rate.py summary --key blind_key.json --ratings "blind/rating_*.csv"` and paste the wins/means into the results table.

## 2. Publish (remote + push)

- `master` is tagged `good-2026-11-01` after the final merge (see Phase F) — verify the tag points at the intended commit before pushing.
- Create the GitHub repo, then: `git remote add origin <url> && git push -u origin master --tags`.
- Fill the three `<your-repo-url>` placeholders in README.md's Install section first.
- Topics ready: `claude-code-skill`, `opencode`, `agent-skills`, `benchmark`.

## 3. Demo recording (MVP #4, ~90 seconds)

- Both spec-02 apps are staged at `_runs-zcode\glm-5.3-flash\{baseline,skill}\02-crud-app-auth\run1` (old benchmark) — record signup → book → cancel on the skill build, and the same on the baseline, side by side. Failures included are fine; the SOW asks for the honest version.

## 4. Kilocode re-test (cross-harness, v0.1.4)

- First check one-shot is actually in Kilocode's skills dir (both prior runs showed no fingerprints at all).
- Then run the Focus Timer brief (Prompt B, verbatim, in memory/`NEXT A/B TEST BRIEF`) with v0.1.4 installed. Tells: `one-shot-work/` appears FIRST; PROGRESS header filled; GATE.md artifact; deliverable files listed in the report; report NOT DONE if the gate blocks.

## 5. Launch posts (after all numbers exist)

- Show HN: tie-led headline (the measured honesty IS the hook), token ratios next to every claim.
- r/ClaudeAI + r/LocalLLaMA: the weak-model angle (STRICT mode, ambient-labeled design).
- X: the fingerprint↔quality correlation finding.
- The post cites: the v0.1 README table (measured, tie), the hard-mode results table (this pack), and the method (sentinel-gated, two-routes, published corrections).

## 6. Merge order for the operator (any remaining branches)

- All branches are merged to master through `59cadba` + scorer hardening `06cde57` except any future work. Verify with `git branch --no-merged master` (expected: none of the landed branches remain).
