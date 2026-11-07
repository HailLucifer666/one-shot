# PREREG-EXPLORATORY-2026-11-07 — benchmark-v3 discriminating pack

**Status: EXPLORATORY.** Every number this pack produces is exploratory. None of it may be quoted as a published claim or a headline. A published battery requires a real pre-registration (like `benchmark-hard/PRE-REGISTERED-2026-11-01.md`) written and committed BEFORE its runs, with fixed n, fixed specs, a fixed stopping rule, and no peeking. This file governs the exploratory campaign only.

Committed 2026-11-07, before any benchmark-v3 run.

## Purpose

The v0.1.4 battery tied 10/10 vs 10/10 on GLM 5.3 Flash: a strong model maxes specs 01–05, so the benchmark could not discriminate. This pack adds specs designed to fail a no-skill baseline — vague briefs, exact-logic edges, hidden-state traps, offline-test discipline, and seeded brownfield bugs — and collects A/B pairs (with-skill / without-skill) run by a human across many models, starting with ZCode GLM 5.3 Flash.

## Hypotheses (directional, exploratory)

- H-A: On the new specs, GLM 5.3 Flash baselines score strictly below 90% mean first-run on at least 4 of the 6 new/vague cells (06, 07, 08, 09, 10, vague) — i.e. most of the pack discriminates where the old pack ceilinged.
- H-B: The skill arm's first-run pass rate exceeds the baseline's on the discriminating cells (direction unknown per cell; magnitude not pre-claimed).
- H-C: The skill arm shows its signature (the PROTOCOL tells: a `one-shot-work/` directory, the "one-shot loaded, rigor LEAN/STANDARD/STRICT" line, and a gate-style "Known limitations" section) in every valid skill-arm run.
- H-D: Vague mode discriminates most sharply on the interview-discipline criteria — items 1–5 of `vague-criteria.md` (clarifying-question count, batching, stated assumptions, no invented facts, honoring answers) — with baselines inventing details instead of asking. *(Dated pre-run clarification 2026-11-07: this hypothesis originally said "criteria (v1–v5)"; no v-prefixed numbering exists in the pack, so it is pinned here to vague-criteria items 1–5 before any run.)*

## Fixed rules for the exploratory campaign

1. Every run gets a run state: VALID / INVALID-fingerprint / INVALID-aborted / CONTAMINATED (PROTOCOL.md). Only VALID runs are scored; invalid runs are reported by count, never silently dropped.
2. First-run score is the headline; follow-up fix rounds (max 5, failing criteria verbatim) are logged separately. Below 7/10 first-run: record `>X` and stop.
3. Behavioral criteria score only from recorded evidence; no evidence = unverifiable = excluded from the denominator with a footnote, never a pass.
4. A spec whose GLM baselines reach ≥90% mean is flagged NOT-DISCRIMINATING and gets hardened or pruned before other-model spending continues (the H5 lesson).
5. Token budget per run ~0.5–1M; the first GLM pair per spec verifies it; consistent overruns mean the spec is re-scoped, not pushed through.
6. Spec text is never edited between arms or after runs begin; if a spec must change, its prior runs are marked superseded in RESULTS.md and the change is noted with a date.
7. Results, including unflattering ones, are recorded in `benchmark-v3/RESULTS.md` as they land.

## Design notes (for the eventual real prereg)

- The eventual publishable battery must pre-register: exact model IDs, arms, n per cell, randomized interleaved run order with a logged seed, a fixed stopping rule, Fisher exact + Wilson interval analysis, and the rule that the result is published whatever it shows.
- The known confound from the 2026-11-05 battery remains: ambient harness skills exist in BOTH arms; only one-shot is added to the skill arm.
