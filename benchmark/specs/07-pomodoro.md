# Spec 07: Pomodoro timer

Build a single-page Pomodoro timer called "Tempo" for people who work in focused sprints. Vanilla HTML/CSS/JavaScript in one `index.html` file. No backend, no frameworks, no external files. The timer must keep honest wall-clock time even when the browser tab is in the background.

## Requirements

- Work sessions are 25 minutes; short breaks are 5 minutes; after every 4th completed work session the break is a long break of 15 minutes.
- Controls: Start, Pause, Reset, Skip. An "Auto-start next" toggle that defaults to ON — when the current phase ends, the next one starts by itself.
- Keyboard: Space toggles Start/Pause.
- While a session is running, the browser tab title shows the remaining time (e.g. "24:59 — Work").
- The timer state (current phase, remaining seconds, completed work-session count, auto-start setting) must survive a page reload.

## Acceptance criteria (yes or no)

1. Is the entire app one `index.html` file with inline CSS and JS — no external dependencies, no backend?
2. On a fresh load, does clicking Start show a 25:00 work countdown that visibly decreases every second?
3. When a work session finishes, does a 5:00 short break start, and after the 4th completed work session does a 15:00 long break start — with the cycle position visible somewhere (e.g. "Work 2 of 4")?
4. With auto-start ON, does the next phase start by itself with the correct duration, and with auto-start OFF does it wait for Start?
5. While running, does switching to another browser tab show the countdown in the tab title, and does the remaining time stay honest against the wall clock (leaving for 2 minutes and returning shows roughly 2 minutes less, not a stopped or reset timer)?
6. Does reloading the page mid-session restore the phase, the remaining seconds (within a few seconds of drift), the completed-work count, and the auto-start setting?
7. Does Space toggle Start/Pause, does Pause genuinely stop the countdown (wait 30 seconds while paused — the remaining time must not change), and does Reset return to a fresh 25:00 work session with count 0?
8. Does Skip advance to the next phase immediately with its correct duration, without counting a skipped work session as completed?
9. During a full work → break → work transition, does the browser console stay free of errors, and is the current phase always clearly labeled (Work / Short break / Long break)?
10. Is the remaining time computed from wall-clock timestamps (deltas against a saved deadline) rather than by counting interval ticks, so that background throttling cannot make it drift?
