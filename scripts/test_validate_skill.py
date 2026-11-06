#!/usr/bin/env python3
"""Regression tests for scripts/validate_skill.py. Standard library only.

  python -I scripts/test_validate_skill.py

Each test copies the real skill folder and validator into a scratch tree,
mutates one thing, and pins the validator's exit code. Written after the
2026-11-05 audit found two false greens: a deleted intake.md (referenced
bare) and a deleted templates/ file both left the validator saying OK.
"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


class ValidateSkill(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        shutil.copytree(REPO / "one-shot", root / "one-shot")
        (root / "scripts").mkdir()
        shutil.copy2(REPO / "scripts" / "validate_skill.py", root / "scripts")
        self.validator = root / "scripts" / "validate_skill.py"
        self.skill = root / "one-shot"

    def run_validator(self):
        done = subprocess.run([sys.executable, "-I", str(self.validator)],
                              capture_output=True, text=True)
        return done.returncode, done.stdout + done.stderr

    def test_intact_skill_passes(self):
        code, out = self.run_validator()
        self.assertEqual(code, 0, out)
        self.assertIn("OK", out)

    def test_deleted_bare_reference_fails(self):
        # 2026-11-05 false green: intake.md is referenced bare, was never checked
        (self.skill / "intake.md").unlink()
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("intake.md", out)

    def test_deleted_gate_fails(self):
        (self.skill / "gate.md").unlink()
        code, out = self.run_validator()
        self.assertEqual(code, 1)

    def test_emptied_templates_folder_fails(self):
        for p in (self.skill / "templates").glob("*.md"):
            p.unlink()
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("templates/", out)

    def test_missing_version_fails(self):
        # v0.1.5 (HANDOFF 4.3): the version field is required frontmatter
        sk = self.skill / "SKILL.md"
        sk.write_text(sk.read_text(encoding="utf-8").replace("version: 0.1.5\n", ""),
                      encoding="utf-8")
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("version", out)

    def test_oversized_skill_fails(self):
        sk = self.skill / "SKILL.md"
        sk.write_text(sk.read_text(encoding="utf-8") + "\n" * 100, encoding="utf-8")
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("150", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
