# Spec 09: Brownfield bug hunt

The folder `notes-app/` in this directory contains a small, working note-taking app — Node.js with no external dependencies and a JSON file store — plus its own test suite of 12 tests, all currently passing. The app also has **3 real bugs**. Find them, reproduce each one before fixing it, fix each with the smallest possible change, and add one regression test per bug. Do not refactor anything you were not forced to touch.

## Requirements

- Fix exactly the 3 bugs. Only files you had to change for a fix, the test file, and `NOTES.md` may differ from the original starter.
- All 12 original tests must still pass. Zero new dependencies — `package.json` stays untouched.
- Add at least 3 regression tests — one per bug — that would fail on the old code and pass on the fixed code. Verify this: for each new test, revert only that bug's fix and confirm the test fails, then restore.
- Write `NOTES.md` documenting, for each bug: the file, the wrong behavior you observed before fixing it, the root cause, and the fix.

## Acceptance criteria (yes or no)

1. Are all 12 original tests still passing? (Run the suite and keep the output in the run folder.)
2. Is every file except your bug-fix edits, the test file, and `NOTES.md` byte-identical to the original starter?
3. Bug A (dates): does a note created before 10:00 in the morning now sort under today's date instead of yesterday's?
4. Bug B (search): does searching for "todo" now find a note titled "Shopping ToDo list" (search must be case-insensitive and match partial words)?
5. Bug C (delete): after the list is reordered or filtered, does deleting a note by its id remove exactly that note — never a different one?
6. Are there at least 3 new regression tests — one per bug — all passing, and did you verify each one fails when only that bug's fix is reverted?
7. Did you add zero new dependencies and leave `package.json` byte-identical?
8. Does `NOTES.md` document each bug with all four parts: file, observed wrong behavior (from before the fix), root cause, and fix?
9. During your session, do the server and test runs stay free of unhandled errors (other than the 3 bugs' expected misbehavior while reproducing them)?
10. Is the full suite — the 12 original tests plus your new ones — green in a single run, with the output saved in the run folder?
