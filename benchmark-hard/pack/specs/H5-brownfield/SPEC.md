# H5: Brownfield change (Taskbox)

You are given an existing working app (the `starter/` folder: a small Node task API with a web page and 13 passing tests). Do not rewrite it. Change it as described. Give the model only this file and the starter folder.

Run the app: `npm start` (port from the PORT environment variable, default 3000). Run tests: `npm test`.

## Changes

**C1. Due dates.** Tasks get an optional `due` field, a date string `YYYY-MM-DD` or `null`.
- POST and PATCH accept `due`. An invalid value (wrong format, or a date that does not exist such as 2030-02-30) returns 400 with `{ "error": ... }`.
- PATCH with `"due": null` clears it.
- Every task in every response includes `due` (`null` when unset).

**C2. Status filter.** `GET /api/tasks?status=open` returns only tasks with done=false, `status=done` only done=true. Any other status value returns 400. With no `status`, behavior is unchanged (all tasks).

**C3. Overdue filter.** `GET /api/tasks?overdue=true` returns only tasks that are not done and whose `due` is before today (UTC date). It can be combined with `status`. Any `overdue` value other than `true` returns 400.

**C4. Fix two bugs.**
- DELETE of an id that does not exist returns 404 with `{ "error": "not found" }` (it currently returns 204).
- PATCH with an empty or whitespace-only `title` returns 400. PATCH of a missing id still returns 404.

**C5. Page.** The page shows each task's due date, highlights overdue open tasks, and has a status filter dropdown (all, open, done).

**C6. Compatibility.** Existing endpoints keep their paths, status codes and response fields. The original tests in `test/store.test.js` and `test/api.test.js` must pass unmodified. Do not edit those two files.

**C7. Tests.** Add tests for the new behavior in NEW files under `test/`. `npm test` must pass.

## Acceptance
Run: `node tools/run_h5.mjs <path-to-candidate-folder>` from the pack root. It reports C1 to C7 as PASS or FAIL. C5 is partly manual: open the page and look.
