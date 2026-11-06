# Vague-brief criteria (yes or no)

These apply when the prompt is one sentence (vague mode) and no spec was given. Scored from the session transcript (what the agent said and asked) plus the finished build. The three transcript questions (Q1–Q3) are answered by the human runner in RUN-NOTE.md; the build checks are judged from screenshots and the files.

1. (Q1) Before writing any code, did the agent ask at least 3 concrete questions about the brief — content, style, sections, functionality — rather than building immediately?
2. (Q2) Were those questions batched into one round (or at most two), instead of dribbling out one at a time across many turns?
3. (Q3) Did the agent either wait for the answers or explicitly state labeled assumptions it would proceed on — rather than silently inventing details?
4. Are all names, prices, addresses, opening hours, and contact details either taken from the user's answers or clearly labeled as placeholders — never invented as if they were real?
5. Does the finished build honor every answer the user gave — every section they requested exists, and any colors or fonts they specified actually appear in the CSS?
6. Is there exactly one non-empty `h1`, and does every image carry alt text?
7. Is body-text contrast at least 4.5:1 (measured, not eyeballed)?
8. At 360px width, is there no horizontal scrolling?
9. Does the visible page text contain no lorem ipsum and no template filler?
10. Does the agent's final report include a "Known limitations" section instead of claiming bare completion?
