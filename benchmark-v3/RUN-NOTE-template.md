# RUN-NOTE

Copy this file into every run folder as `RUN-NOTE.md` and fill it in. It is the evidence record the scorer trusts — anything not written here did not happen.

```
# RUN-NOTE

- model:
- harness:            (zcode / claude-code / kilocode / opencode / other)
- arm:                (baseline / skill)
- run state:          (VALID / INVALID-fingerprint / INVALID-aborted / CONTAMINATED)
- spec:               (01 / 04 / 06 / 07 / 08 / 09 / 10 / vague)
- date:
- tokens used:        (from the harness usage display; for INVALID-aborted runs write tokens-so-far at the abort; write "not shown" if unavailable)
- duration:
- follow-up prompts:  (count; 0 if none; paste their text below if any)
- fixlog:             (fixlog.md attached? yes/no)

## Skill-arm tells (fill only for arm = skill)
- one-shot-work/ directory present:          (yes/no)
- "one-shot loaded, rigor ___" line seen:    (yes/no — quote the line)
- final report has "Known limitations":      (yes/no)

## Vague-mode transcript questions (fill only for spec = vague)
- Q1: did it ask at least 3 concrete questions before coding?   (yes/no)
- Q2: were the questions batched into 1-2 rounds?               (yes/no)
- Q3: did it wait for answers or state labeled assumptions?     (yes/no — say which)

## Evidence attached
(list every file: e.g. reload-screenshot.png, tab-hidden-recording.mp4,
npm-test-output.txt, report.json, curl-400-evidence.txt …)

## Anything odd you saw
(free text — surprising behavior, harness quirks, deviations you noticed)
```

Rules reminders:

- Behavioral criteria score only from attached evidence; no attachment = unverifiable (excluded from the denominator, footnoted — never counted as a pass).
- Below 7/10 first-run: record follow-up count as `>X` and stop.
- Stopped at the 5-round cap without reaching 10/10: record the count as `5 (capped)`.
- Run state INVALID-fingerprint → rerun the arm; never count it as the other arm.
