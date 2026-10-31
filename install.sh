#!/bin/sh
# Install the one-shot skill by copying one folder.
# Usage: ./install.sh [target-skills-dir]   (default: ~/.claude/skills)
set -e
TARGET="${1:-$HOME/.claude/skills}"
mkdir -p "$TARGET"
rm -rf "$TARGET/one-shot"
cp -R "$(dirname "$0")/one-shot" "$TARGET/one-shot"
echo "Installed one-shot to $TARGET/one-shot"
