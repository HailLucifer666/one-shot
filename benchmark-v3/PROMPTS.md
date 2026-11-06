# PROMPTS.md — copy-paste pairs for every spec

Every spec is tested as a pair: **one run WITHOUT the skill, one run WITH the skill**. The two prompts are byte-identical except for the `/one-shot ` prefix. Never edit the spec text between arms — any difference in the prompt makes the pair unscorable.

## How to build each prompt

**PROMPT A — WITHOUT SKILL (baseline arm):**

```
Build this. Here is the spec:

<Paste the FULL text of the spec file here>
```

**PROMPT B — WITH SKILL (skill arm):**

```
/one-shot Build this. Here is the spec:

<Paste the FULL text of the same spec file, unchanged>
```

The spec files live in the repo at `benchmark/specs/`. Copy the whole file, first line to last — including the title line. Before each run, check the arm hygiene rules in PROTOCOL.md (for the baseline arm the skill must be parked out of the catalog, or the run is contaminated).

## Spec files

| Spec | File | Mode |
|---|---|---|
| 01 | `benchmark/specs/01-landing-page.md` | full + vague |
| 04 | `benchmark/specs/04-slide-deck.md` | full |
| 06 | `benchmark/specs/06-calculator.md` | full |
| 07 | `benchmark/specs/07-pomodoro.md` | full |
| 08 | `benchmark/specs/08-expense-splitter.md` | full |
| 09 | `benchmark/specs/09-brownfield-bugs.md` | full — copy `benchmark-v3/starters/09-notes-app/` into the run folder FIRST (see PROTOCOL.md) |
| 10 | `benchmark/specs/10-data-transform.md` | full — the CSV fixture is embedded in the spec; the agent saves it |

## Vague mode (its own prompt, no spec text)

Vague mode tests interview discipline: one sentence, nothing else. Score against `benchmark-v3/vague-criteria.md`.

Give this and nothing else:

```
Build me a website for my cousin's pet grooming salon.
```

Variants for repeat runs (rotate so the model never sees the same one twice):

```
Build me a website for my local cricket club.
```

```
Build me a website for my sister's tutoring business.
```

```
Build me a simple app to track which plants I've watered.
```

## Budget rule

Each pair should cost roughly 1–2M tokens total (about 0.5–1M per run). If a single run is blowing past ~1.2M tokens (visible in the harness usage display), abort it, mark the run INVALID-aborted in RUN-NOTE.md with the tokens-so-far, and start a fresh run. Do not push a runaway to completion — an over-budget run is not a valid data point for this pack.
