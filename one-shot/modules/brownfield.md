# Brownfield Pack (Existing Codebase & Bugfix Traps)

Load when modifying an existing repository, fixing bugs, or adding features to existing code.

## Non-Negotiable Rules

1. **Diff-Scope Guard:**
   - Touch **only** the files required by the task. Zero drive-by reformatting, zero unrelated refactors, zero dependency upgrades unless requested.
   - Inspect `git diff --stat` before running the release gate; revert any incidental edits outside scope.
2. **Revert-Verified Regression Test (Watched-Red First):**
   - Write the regression test reproducing the exact bug **before** editing production code.
   - Run it and confirm it fails for the stated defect (not a syntax/import error).
   - Apply the minimal fix, re-run, and confirm it passes **plus** an adjacent false-positive guard (the valid case that must keep passing).
3. **Preserve Existing Suite & Contracts:**
   - Run the repository's full existing test suite before and after your changes. Never weaken an existing assertion or alter a test harness to make a failure disappear.
   - Match the repository's existing patterns, naming, and error shapes rather than introducing a new style.
4. **Honest Blast Radius:**
   - Before editing a shared helper, grep all callers and check sibling paths for the same defect class.
   - Record any deliberately untouched pre-existing issues in the final report instead of silently fixing or ignoring them.
