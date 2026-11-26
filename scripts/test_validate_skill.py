#!/usr/bin/env python3
"""Regression tests for scripts/validate_skill.py (v0.3.0). Standard library only.

  python -I scripts/test_validate_skill.py

Each test copies the real skill folder and validator into a scratch tree,
mutates one thing, and pins the validator's exit code.
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
        (self.skill / "intake.md").unlink()
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("intake.md", out)

    def test_deleted_gate_fails(self):
        (self.skill / "gate.md").unlink()
        code, out = self.run_validator()
        self.assertEqual(code, 1)

    def test_deleted_contract_template_fails(self):
        (self.skill / "templates" / "contract.json").unlink()
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("contract.json", out)

    def test_deleted_brownfield_module_fails(self):
        (self.skill / "modules" / "brownfield.md").unlink()
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("brownfield.md", out)

    def test_missing_version_fails(self):
        sk = self.skill / "SKILL.md"
        sk.write_text(sk.read_text(encoding="utf-8").replace("version: 0.3.0\n", ""),
                      encoding="utf-8")
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("version", out)

    def test_wrong_version_fails(self):
        sk = self.skill / "SKILL.md"
        sk.write_text(sk.read_text(encoding="utf-8").replace("version: 0.3.0\n", "version: 0.1.5\n"),
                      encoding="utf-8")
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("0.3.0", out)

    def test_oversized_skill_fails(self):
        # v0.2.0 tightens the kernel limit from 150 lines to 80 lines.
        sk = self.skill / "SKILL.md"
        sk.write_text(sk.read_text(encoding="utf-8") + "\n" * 50, encoding="utf-8")
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("80", out)

    def test_missing_verify_script_fails(self):
        (self.skill / "scripts" / "verify.mjs").unlink()
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("verify.mjs", out)

    def test_broken_verify_help_fails(self):
        (self.skill / "scripts" / "verify.mjs").write_text("process.exit(1);\n", encoding="utf-8")
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("--help", out)

    def test_deprecated_artifact_reference_fails(self):
        intake = self.skill / "intake.md"
        intake.write_text(intake.read_text(encoding="utf-8") + "\nLog to ASSUMPTIONS.md\n", encoding="utf-8")
        code, out = self.run_validator()
        self.assertEqual(code, 1)
        self.assertIn("ASSUMPTIONS.md", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
