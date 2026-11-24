#!/usr/bin/env python3
"""Validate the one-shot skill folder (v0.2.0). Exit 1 on any problem."""
import re
import subprocess
import sys
from pathlib import Path

EXPECTED_VERSION = "0.2.0"
LINE_LIMIT = 80

skill = Path(__file__).resolve().parent.parent / "one-shot"
errors = []
text = (skill / "SKILL.md").read_text(encoding="utf-8")
m = re.match(r"---\r?\n(.*?)\r?\n---\r?\n", text, re.S)
if not m:
    errors.append("SKILL.md: missing YAML frontmatter")
else:
    fm = m.group(1)
    for key in ("name", "description", "version"):
        if not re.search(rf"^{key}:\s*\S", fm, re.M):
            errors.append(f"SKILL.md: frontmatter missing {key}")
    vm = re.search(r"^version:\s*(\S+)", fm, re.M)
    if vm and vm.group(1) != EXPECTED_VERSION:
        errors.append(f"SKILL.md: version is {vm.group(1)!r}, expected {EXPECTED_VERSION!r}")

lines = len(text.splitlines())
if lines > LINE_LIMIT:
    errors.append(f"SKILL.md: {lines} lines, limit is {LINE_LIMIT}")

for ref in re.findall(r"`((?:modules/|templates/|scripts/)?[\w./-]+\.(?:md|json|mjs|py))`", text):
    if ref.startswith("one-shot-work/"):
        continue  # runtime project artifact, not a bundled skill file
    if not (skill / ref).exists():
        errors.append(f"SKILL.md references missing file: {ref}")

if not (skill / "gate.md").exists():
    errors.append("gate.md missing")

verify_script = skill / "scripts" / "verify.mjs"
if not verify_script.is_file():
    errors.append("bundled scripts/verify.mjs missing")
else:
    try:
        done = subprocess.run(
            ["node", str(verify_script), "--help"],
            capture_output=True, text=True, timeout=15,
        )
        if done.returncode != 0:
            errors.append(f"scripts/verify.mjs --help exited {done.returncode}: {done.stderr.strip()}")
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(f"scripts/verify.mjs --help failed to run: {exc}")

print("\n".join(errors) if errors else f"OK: SKILL.md valid ({lines} lines, v{EXPECTED_VERSION}, verify.mjs --help OK)")
sys.exit(1 if errors else 0)
