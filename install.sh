#!/bin/sh
# Install the one-shot skill by copying one folder.
# Usage: ./install.sh [--verify] [target-skills-dir]   (default target: ~/.claude/skills)
#
#   --verify  check an existing installation instead of copying: every file in
#             the source skill folder must exist in the target and match
#             byte-for-byte, the target must hold no extra files, and SKILL.md
#             must carry the `name: one-shot` fingerprint. Exits 1 on any
#             mismatch so scripts and CI can gate on it.
#
# Why --verify exists: two benchmark runs on Kilocode ran without the skill
# installed at all — the installer copied and trusted, and nobody checked what
# landed. Verify what you deployed.
set -e
VERIFY=0
if [ "${1:-}" = "--verify" ]; then
  VERIFY=1
  shift
fi
SOURCE_DIR="$(dirname "$0")/one-shot"
TARGET="${1:-$HOME/.claude/skills}"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "source skill folder not found: $SOURCE_DIR" >&2
  exit 1
fi

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -c1-12
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -c1-12
  else
    echo "unavailable"
  fi
}

if [ "$VERIFY" = 1 ]; then
  if [ ! -d "$TARGET/one-shot" ]; then
    echo "not installed: $TARGET/one-shot does not exist"
    exit 1
  fi
  FAIL=0
  SRC_COUNT=0
  # manifest derived from the source tree — never a hand-typed file list;
  # cd into $SOURCE_DIR so regex metacharacters in $SOURCE_DIR cannot corrupt
  # path stripping, and read line-by-line so spaces in filenames stay intact.
  TMP_LIST=$(mktemp)
  trap 'rm -f "$TMP_LIST"' EXIT
  (cd "$SOURCE_DIR" && find . -type f | sed 's|^\./||' | sort) > "$TMP_LIST"
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    SRC_COUNT=$((SRC_COUNT + 1))
    if [ ! -f "$TARGET/one-shot/$rel" ]; then
      echo "MISSING: one-shot/$rel"
      FAIL=1
    elif ! cmp -s "$SOURCE_DIR/$rel" "$TARGET/one-shot/$rel"; then
      echo "DIFFERS: one-shot/$rel"
      FAIL=1
    fi
  done < "$TMP_LIST"
  TGT_COUNT=$(find "$TARGET/one-shot" -type f | wc -l | tr -d '[:space:]')
  if [ "$SRC_COUNT" -ne "$TGT_COUNT" ]; then
    echo "FILE COUNT: source has $SRC_COUNT, target has $TGT_COUNT"
    FAIL=1
  fi
  if ! grep -q "^name: one-shot" "$TARGET/one-shot/SKILL.md"; then
    echo "FINGERPRINT: 'name: one-shot' not found in installed SKILL.md"
    FAIL=1
  fi
  if [ "$FAIL" -ne 0 ]; then
    echo "VERIFY: FAILED"
    exit 1
  fi
  echo "VERIFY: OK - $SRC_COUNT files match, fingerprint present"
  echo "installed version: $(grep '^version:' "$TARGET/one-shot/SKILL.md" 2>/dev/null | head -1 | sed 's/^version:[[:space:]]*//' || echo unknown)"
  echo "installed sha256 (SKILL.md): $(hash_file "$TARGET/one-shot/SKILL.md")"
  exit 0
fi

mkdir -p "$TARGET"
rm -rf "$TARGET/one-shot"
cp -R "$SOURCE_DIR" "$TARGET/one-shot"
echo "Installed one-shot to $TARGET/one-shot"
echo "installed version: $(grep '^version:' "$TARGET/one-shot/SKILL.md" 2>/dev/null | head -1 | sed 's/^version:[[:space:]]*//' || echo unknown)"
echo "installed sha256 (SKILL.md): $(hash_file "$TARGET/one-shot/SKILL.md")"
sh "$0" --verify "$TARGET"
