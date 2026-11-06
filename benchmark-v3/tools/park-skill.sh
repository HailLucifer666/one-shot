#!/usr/bin/env bash
# park-skill.sh — move the one-shot skill OUT of every harness catalog so a
# baseline arm runs clean. Postcondition-verified: exits non-zero if any
# install dir still exists after parking. Never silently "succeed".
#
# Why this exists: the skill's description auto-triggers on build asks, so a
# baseline run with the skill still installed is CONTAMINATED (pre-registered
# rule, benchmark-hard/PRE-REGISTERED-2026-11-01.md decision 4).
#
# Env overrides for testing (default to the real locations):
#   PARK_ZCODE_DIR, PARK_CLAUDE_DIR, PARK_STAGING_DIR
set -euo pipefail

ZCODE_DIR="${PARK_ZCODE_DIR:-$HOME/.zcode/skills/one-shot}"
CLAUDE_DIR="${PARK_CLAUDE_DIR:-$HOME/.claude/skills/one-shot}"
STAGING="${PARK_STAGING_DIR:-$(dirname "$0")/../../_skill-staging/v3-park}"

mkdir -p "$STAGING"
FAIL=0
MOVED=""

for DIR in "$ZCODE_DIR" "$CLAUDE_DIR"; do
  if [ -d "$DIR" ]; then
    NAME=$(echo "$DIR" | sed 's|[/\\]|-|g; s|^-*||')
    DEST="$STAGING/$NAME"
    rm -rf "$DEST"
    if mv "$DIR" "$DEST"; then
      MOVED="$MOVED  parked: $DIR -> $DEST\n"
    else
      echo "ERROR: failed to move $DIR" >&2; FAIL=1
    fi
  fi
done

# Postcondition: neither install may remain. A silent mv failure would
# contaminate the baseline while looking clean — verify, loudly.
for DIR in "$ZCODE_DIR" "$CLAUDE_DIR"; do
  if [ -d "$DIR" ]; then
    echo "CONTAMINATION RISK: $DIR still exists after parking" >&2
    FAIL=1
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo "PARK: FAILED — fix the errors above before running any baseline arm." >&2
  exit 1
fi

echo -e "PARK: OK — skill is out of every catalog.\n$MOVED"
echo "Baseline arms are now clean. Restore afterward with restore-skill.sh."
