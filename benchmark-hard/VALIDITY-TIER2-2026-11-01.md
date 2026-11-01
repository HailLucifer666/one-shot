# VALIDITY CHECK — Tier 2 completion (H2/H3/H4 baselines, 2026-11-01)

Completes the Step 0 "3 of 5" rule from PRE-REGISTERED-2026-11-01.md. Rule (unchanged after
results): a spec discriminates pass-rate iff the no-skill baseline scores strictly below 90%.
Tier 1 numbers (H1, H5 v2) are from `_runs-hardmode\glm-5.3-flash\tier1\`; Tier 2 baselines from
`glm-5.3-flash\tier2\baseline\`. Every claim cites the file that holds the evidence.

## Verdict

| Spec | Baseline first-run | < 90%? | Evidence |
|---|---|---|---|
| H1 vague coffee shop | 8/19 = 42.1% (r1), 9/19 = 47.4% (r2) — mean **44.7%** | **YES** | tier1 baseline RESULT.json files; VALIDITY-2026-11-01.md |
| H2 salon booking | **27/27 = 100%** (21 live + 6 structural) | no | `_runs-hardmode\h2_battery_result.json` (per-criterion evidence) |
| H3 conflicting requirements | **13/13 = 100%** | no | tier2/baseline/H3.../run1/RESULT.json (items 6 + 12 closed live this session: export→clear→import round-trip through the app's real handler; 100k seed 710 ms, search 33–47 ms) |
| H4 security traps | **14/18 = 77.8%** | **YES** | tier2/baseline/H4.../run1/RESULT.json + `_runs-hardmode\h4_battery_result.json` (18-check battery, run twice, identical) |
| H5 brownfield v2 | 8/8 = 100% | no | tier1 RESULT.json (ceiling; strengthening cap reached) |

**2 of 5 specs discriminate pass-rate for GLM 5.3 Flash (H1, H4). The pre-registered launch rule
("wins ≥3 of 5") cannot be met on this model.** The pack's own fallback applies verbatim:
*publish what you learned and fix the skill first. Do not hide a tie or a loss.*

## What this session's baselines actually found

- **H4 discriminates — the handoff predicted it would not** ("expect a high score"). The battery
  found four genuine gaps, none of them scorer artifacts:
  - #7 login throttle is real but looser than the bar (10 failures/15 min per IP vs "6th within a
    minute blocked") — observed 401×6 twice on fresh in-memory limiters.
  - #9 `.env.example` absent (no secrets anywhere either; `find . -name '.env*'` → none).
  - #13 prompt-injection call design: attacker text confined to the `user` field with labeled
    framing, but the system prompt never says the recipe text is data-not-instructions.
  - #17 no dependency audit documented anywhere on disk (cross-check: `npm audit` = 0
    vulnerabilities — the failure is documentation, not exposure).
  - Everything the pack worried about passed: stored XSS inert in browser on list/search/detail,
    hostile summary rendered as text, IDOR 403s, content-based upload rejection (proven by the
    #6 control: real PNG accepted through the same multipart path), CSRF 403 without token,
    scrypt hashes, CSP + frame-ancestors + nosniff, clean error bodies.
- **H2 and H3 are ceiling specs for this model** (100% both). Their arm comparisons still carry
  fix-rounds and token evidence (the Tier 1 pattern: H5 tied at 100% but the skill arm still
  recorded different cost).

## Consequences for the remaining steps

1. **Tier 2 skill arm proceeds as pre-registered** (H2/H3/H4 × run1, then run2). With H4 now a
   discriminating spec, the H4 arm comparison is a genuine pass-rate test, not only
   fix-rounds/tokens. H1 and H5 comparisons already stand from Tier 1.
2. **The launch decision is already closed by the validity rule** — even a perfect Tier 2 sweep
   cannot reach "3 of 5 specs" because H2/H3/H5 cannot go below ceiling on the baseline side and
   the skill cannot win a spec the baseline aces. The honest headline for the write-up: the pack
   produced one clean skill win (H1 fix rounds, zero regressions), one discriminating spec with a
   77.8% baseline (H4, arm comparison pending), and three ceiling specs.
3. Per PRE-REGISTERED decision 7: no rule on this page changed after results.

## Scorer notes (tool provenance for this session)

- `_probe/h4_score.py` was written this session from the H2 pattern; its browser-only criteria
  (1, 14) merge via `--merge` with evidence from live IAB probes. First invocation accidentally
  ran the battery twice (the `--merge` call re-executed all checks); the second run landed on a
  fresh server process with an identical result — recorded as determinism evidence, and the #7
  probe in the final JSON is the clean fresh-limiter observation (both runs agree: 401×6).
- The merge-file path is `_runs-hardmode\h4_browser_merge_baseline.json`.
- H3 items 6 and 12 carry the pre-registered IAB fallback notes (native file-picker not
  exercisable; synthetic File+DataTransfer through the app's real onchange handler; export path
  fully live including a real download).
