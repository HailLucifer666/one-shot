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
  NAME=$(echo "$DIR" | sed 's|[:/\\]|-|g; s|^-*||')
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

# Postcondition 1: nothing left parked. The staging dir may legitimately not
# exist yet (nothing ever parked) — find would exit 1 and pipefail would kill
# the script silently, so guard on the directory first.
if [ -d "$STAGING" ]; then
  LEFTOVERS=$(find "$STAGING" -maxdepth 1 -mindepth 1 2>/dev/null | wc -l)
else
  LEFTOVERS=0
fi
if [ "$LEFTOVERS" -ne 0 ]; then
  echo "WARNING: $LEFTOVERS item(s) still parked in $STAGING:" >&2
  find "$STAGING" -maxdepth 1 -mindepth 1 >&2
fi

# Postcondition 2: if any install is present and the repo is reachable, byte-verify
# (even when nothing was parked, so a stale or tampered install cannot pass silently).
# install.sh --verify expects the PARENT skills dir (it checks $TARGET/one-shot).
VERIFIED=""
if [ -f "$REPO_ROOT/install.sh" ]; then
  for DIR in "$ZCODE_DIR" "$CLAUDE_DIR"; do
    if [ -d "$DIR" ]; then
      if bash "$REPO_ROOT/install.sh" --verify "$(dirname "$DIR")" >/dev/null 2>&1; then
        VERIFIED="$VERIFIED  verified: $DIR byte-identical to repo\n"
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

if [ -z "$RESTORED" ]; then
  if [ -d "$ZCODE_DIR" ] || [ -d "$CLAUDE_DIR" ]; then
    echo -e "RESTORE: OK — nothing was parked, and the installs are already in place:\n$VERIFIED"
  else
    echo -e "RESTORE: OK — nothing was parked and no installs found at:\n  $ZCODE_DIR\n  $CLAUDE_DIR\n(install the skill before running a skill arm)"
  fi
else
  echo -e "RESTORE: OK — skill is back in the ZCode and Claude Code catalogs.\n$RESTORED$VERIFIED"
fi
echo "Skill arms are now clean."
