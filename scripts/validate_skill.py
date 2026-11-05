#!/usr/bin/env python3
"""Validate the one-shot skill folder. Exit 1 on any problem."""
import re, sys
from pathlib import Path

skill = Path(__file__).resolve().parent.parent / "one-shot"
errors = []
text = (skill / "SKILL.md").read_text()
m = re.match(r"---\n(.*?)\n---\n", text, re.S)
if not m:
    errors.append("SKILL.md: missing YAML frontmatter")
else:
    fm = m.group(1)
    for key in ("name", "description"):
        if not re.search(rf"^{key}:\s*\S", fm, re.M):
            errors.append(f"SKILL.md: frontmatter missing {key}")
lines = len(text.splitlines())
if lines > 150:
    errors.append(f"SKILL.md: {lines} lines, limit is 150")
for ref in re.findall(r"`((?:modules/|templates/)?[\w./-]+\.md)`", text):
    # 2026-11-05 (audit): every backticked .md reference is checked - bare names
    # like intake.md used to be skipped, so deleting them stayed green.
    if not (skill / ref).exists():
        errors.append(f"SKILL.md references missing file: {ref}")
# 2026-11-05 (audit): Setup reads the files in `templates/`; an emptied folder
# left the validator green while the skill broke. Known limit, deliberate: the
# individual template names appear only in prose (SPEC.md, PLAN.md, ...), and
# parsing prose would model the text instead of checking it - deleting ONE
# template still passes. Make them backticked paths in SKILL.md to close that.
if "`templates/`" in text:
    tdir = skill / "templates"
    if not tdir.is_dir() or not any(tdir.glob("*.md")):
        errors.append("SKILL.md references templates/ but no template .md files exist")
if not (skill / "gate.md").exists():
    errors.append("gate.md missing")
print("\n".join(errors) if errors else f"OK: SKILL.md valid ({lines} lines)")
sys.exit(1 if errors else 0)
