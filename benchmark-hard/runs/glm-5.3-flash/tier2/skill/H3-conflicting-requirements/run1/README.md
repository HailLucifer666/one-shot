# TeamBoard

An offline-first task board in a single HTML file. No server, no network, no third-party code, no build step.

## Run

Double-click `teamboard.html` (or open it in any desktop Chromium/Firefox). That is the whole install.
The file makes zero network requests — verified by an instrumented server access log during testing
(only `GET /teamboard.html` was ever fetched) and by static checks in the test suite.

## Use

- **Board**: three columns (Todo / Doing / Done). Create with “+ New task”, edit or delete with the
  row buttons (✎ / ✕). Filter with the status chips; search by title or assignee in the search box.
- **Gantt**: one status-colored bar per task on a shared timeline, today marker, virtualized scroll
  (handles 100,000 rows), click a row to edit.
- **Data menu**: `Load 100k demo tasks…` (replaces data with 100,000 generated tasks to test scale),
  `Export JSON`, `Import JSON`, and `Link disk backup…` (Chromium: picks a file that is re-written
  automatically within ~2 s of every change).

## Multi-user sync (how it works without a server)

Other users = other tabs/windows of the app on the same machine. Every change is broadcast via
BroadcastChannel + storage events, with a 300 ms poll as a guaranteed fallback — no network involved.
Measured in testing: a change made in one tab appeared in a second tab in **68–74 ms**, deletes
included. Cross-device sync would require a network and is out of scope by design (spec R1).

## Where data lives (durability model)

1. **IndexedDB** (primary) — handles the full 100k dataset (~14 MB).
2. **localStorage mirror** (written ≤400 ms after each change) — if IndexedDB is ever empty or
   unavailable, the app restores from the mirror automatically and heals IndexedDB back.
3. **Export JSON / disk backup** — the only defenses that survive the browser itself wiping origin
   storage. If the browser clears *all* its storage, in-browser copies are gone by definition; the
   linked disk file (or a previously exported file) is the recovery path. No page can do more.

## Tests

```
node --test tests/tb.test.mjs
```

17 tests, no dependencies: file size ≤ 50,000 bytes, zero network capability (static), XSS escaping,
data-model validation, last-write-wins merge semantics, capped scan behavior, 100,000-task search
bench (< 50 ms steady-state), persistence round-trips, recovery-source matrix, Gantt layout math.

## Known limitations

- The Gantt is hand-written Canvas 2D, **not** Chart.js: Chart.js is a third-party library
  (forbidden by the zero-dependency requirement) and its ~200 KB minified size alone would break the
  50 KB single-file budget.
- A literal guarantee that “data is never lost even if the browser clears its storage” is not
  physically possible from inside a page; the shipped mitigations (dual store + auto-heal + export +
  disk backup) are the strongest feasible set.
- Browse-all mode with 100k tasks shows a capped window (5,000 in the Gantt, 100 rows per column,
  “and N more — refine search”); any non-empty search is exhaustive.
- The load-race fix (sync poll firing mid-load could render an empty board once) is verified by a
  browser re-test; the test harness cannot execute the app's async IndexedDB + timer path, so no unit
  test covers that exact race.
- Disk backup needs Chromium (File System Access API); Export/Import works everywhere.
- On `file://`, browsers differ in whether storage events cross tabs (Chrome shares, Firefox may
  isolate per directory); the 300 ms poll covers the gap where storage is shared.
