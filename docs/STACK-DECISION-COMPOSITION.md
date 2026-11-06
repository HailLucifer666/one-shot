# Composition Decision — 2026-11-06

**Status:** Recommendation accepted by maintainer. Do not add any dependency before P8.
**Rule:** Packs post-publish, core frozen until P8 completes. Any edit during P8 discards the batch.

## Recommendation

**Do not add any of the following to one-shot core. Ship one-shot as-is to 10/10, then add packs.**

**Why:**
1. **Your moat is *less*.** One-shot is 82 lines of Markdown + stdlib Python. Spec-kit/MetaGPT/crewAI add process, dependencies, and tokens — the exact overhead that already makes you 36% more expensive on auth apps. You're competing on *proof*, not framework size.
2. **You haven't yet proven the core.** Main battery tied 10/10, hard-mode 2/5 (threshold not met). Adding ECC/superpowers/specs now complicates a decision that P8 was built to answer: *does the skill beat baseline on a model that can actually lose?* Don't muddy that experiment.
3. **The live session is running P0–P6.** Changing the skill mid-battery discards runs and breaks `verify.py` seal + v0.1.5 freeze.
4. **Zero is a feature.** No deps = drops into ZCode/OpenCode/Kilo/Claude in one copy. That's why 3 deployments verify byte-identical.

## Exact sequence

```text
NOW:       Finish live Phase 5 (16 runs) → 5c (20/20) → 6 (audit+merge to master). Nothing else.
NEXT:      P0 bundle → P1 secret audit → P2 merge branches → P3 private push (the 4 gates to public-safe)
THEN:      P4 D1–D6 → P5 verifier (core fix) → P6 resume test + freeze v0.1.5
THEN:      P7 scorer trust + P8 losable benchmark → publish win|tie|loss|inconclusive
AFTER P8:  (and only then) Add composition as packs, in this order:
             1. karpathy-skills / frontend-design / ui-ux-pro-max (taste)
             2. ponytail (economy) + caveman (compression) — never skip gate checks
             3. ECC / agent-sort (quality gates)
             Skip forever: spec-kit (redundant), MetaGPT/crewAI (host replacement, not a skill)
GO PUBLIC: Private→public only after P8 prints a verdict with denominators.
```

## Tool-by-tool verdict

| Tool | In one-shot today? | Verdict |
|---|---|---|
| ECC (agent-sort + governance) | No (pack candidate) | Post-launch pack #3. Overlaps P5 verifier + P7 calibration. |
| Superpowers (obra/superpowers) | No | Reference only. One-shot already enforces TDD/slices/gate internally. Naming confusion risk. |
| github/spec-kit | No | Skip forever — redundant. One-shot IS a minimal spec-kit. |
| multica-ai/andrej-karpathy-skills | No | Post-launch pack #1 (taste). Best fit, as `modules/` packs per SKILL.md §7. |
| foundationagents/metagpt | No | Skip forever — host replacement, adds deps. |
| crewAIInc/crewAI | No | Skip forever — host replacement, adds deps. |
| subagent-driven-development | No | Skip — one-shot uses sequential slices + filesystem state, not fan-out. |
| caveman / ponytail | No | Post-launch packs #2. Never skip gate checks to be lazy. |

## What not to do

Swap one-shot for spec-kit/MetaGPT/crewAI, bundle subagents as the core loop, or add any pack before P5. All three trade away the only edge — *the agent cannot fake the gate* — for features addable later as optional modules.
