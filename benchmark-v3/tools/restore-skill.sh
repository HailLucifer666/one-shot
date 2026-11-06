#!/usr/bin/env bash
# restore-skill.sh — put the one-shot skill back after a baseline arm.
# Postcondition-verified: every parked install must be back in place, and if
# the repo checkout is reachable, byte-verified against it.
set -euo pipefail

ZCODE_DIR="${PARK_ZCODE_DIR:-$HOME/.zcode/skills/one-shot}"
CLAUDE_DIR="${PARK_CLAUDE_DIR:-$HOME/.claude/skills/one-shot}"
STAGING="${PARK_STAGING_DIR:-$(dirname "$0")/../../_skill-staging/v3-park}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

FAIL=0
RESTORED=""

for PAIR in "$ZCODE_DIR" "$CLAUDE_DIR"; do
  DIR="$PAIR"
  NAME=$(echo "$DIR" | sed 's|[/\\]|-|g; s|^-*||')
  SRC="$STAGING/$NAME"
  if [ -d "$SRC" ]; then
    rm -rf "$DIR"
    if mv "$SRC" "$DIR"; then
      RESTORED="$RESTORED  restored: $SRC -> $DIR\n"
    else
      echo "ERROR: failed to restore $SRC" >&2; FAIL=1
    fi
  fi
done

# Postcondition 1: nothing left parked.
LEFTOVERS=$(find "$STAGING" -maxdepth 1 -mindepth 1 2>/dev/null | wc -l)
if [ "$LEFTOVERS" -ne 0 ]; then
  echo "WARNING: $LEFTOVERS item(s) still parked in $STAGING:" >&2
  find "$STAGING" -maxdepth 1 -mindepth 1 >&2
fi

# Postcondition 2: if a restore happened and the repo is reachable, byte-verify.
# install.sh --verify expects the PARENT skills dir (it checks $TARGET/one-shot).
if [ -n "$RESTORED" ] && [ -f "$REPO_ROOT/install.sh" ]; then
  for DIR in "$ZCODE_DIR" "$CLAUDE_DIR"; do
    if [ -d "$DIR" ]; then
      if bash "$REPO_ROOT/install.sh" --verify "$(dirname "$DIR")" >/dev/null 2>&1; then
        RESTORED="$RESTORED  verified: $DIR byte-identical to repo\n"
      else
        echo "VERIFY FAILED: $DIR differs from the repo's one-shot/ — reinstall before skill arms." >&2
        FAIL=1
      fi
    fi
  done
fi

if [ "$FAIL" -ne 0 ]; then
  echo "RESTORE: FAILED — fix the errors above before running any skill arm." >&2
  exit 1
fi

echo -e "RESTORE: OK — skill is back in every catalog.\n$RESTORED"
echo "Skill arms are now clean."
