#!/usr/bin/env python3
"""Regression tests for run_benchmark.py. Standard library only.

  python -I benchmark/test_run_benchmark.py

Guards the gateway endpoint. The naive form of this test — assert the URL and
move on — is a false green: it passes against code that honours a
RESPAN_BASE_URL override whenever the variable is unset, which is always.
The second test therefore SETS the variable and asserts the hosted gateway
wins anyway. Probe record: with the pre-trim code (env lookup live) this test
fails exactly there, for that reason; the trim turned it green. 2026-11-03.

2026-11-05 (audit): the B9 sentinel gate had only ever been probed by hand,
never pinned as a test; these cover it plus the skip reporting, malformed-
record robustness, the censored median and the `complete` subcommand.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import run_benchmark


class TestGatewayUrl(unittest.TestCase):
    HOSTED = "https://api.respan.ai/api/chat/completions"

    def test_gateway_url_is_the_hosted_gateway(self):
        self.assertEqual(run_benchmark.gateway_url(), self.HOSTED)

    def test_gateway_url_ignores_environment(self):
        with patch.dict(os.environ, {"RESPAN_BASE_URL": "https://evil.example/api"}):
            self.assertEqual(run_benchmark.gateway_url(), self.HOSTED)


SCORED = {"criteria_passed": 9, "follow_up_prompts_needed": 0,
          "tokens_used": 123456, "notes": "t"}


class SummaryFixture(unittest.TestCase):
    def make_run(self, model, mode, spec, n, result=None, sentinel=None):
        d = Path(self.tmp.name) / model / mode / spec / f"run{n}"
        d.mkdir(parents=True, exist_ok=True)
        if result is not None:
            (d / "RESULT.json").write_text(json.dumps(result))
        if sentinel is not None:
            (d / "run-complete.json").write_text(json.dumps(sentinel))
        return d

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def run_summary(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            run_benchmark.summary(self.tmp.name)
        return buf.getvalue()


class TestSummaryGate(SummaryFixture):
    def test_scored_without_sentinel_excluded_and_reported(self):
        # B9, permanent form: a scored row without the sentinel must not count.
        self.make_run("m", "skill", "01-landing-page", 1, result=SCORED)
        out = self.run_summary()
        self.assertNotIn("| m |", out)
        self.assertIn("no run-complete.json", out)   # skipped runs are named, not hidden

    def test_scored_with_completed_sentinel_counts(self):
        self.make_run("m", "skill", "01-landing-page", 1, result=SCORED,
                      sentinel={"exit": "completed"})
        out = self.run_summary()
        self.assertIn("| m | skill | 1 | 0/1 | 9.0 | 0 | 123456 |", out)

    def test_sentinel_not_completed_excluded_and_reported(self):
        self.make_run("m", "skill", "01-landing-page", 1, result=SCORED,
                      sentinel={"exit": "failed"})
        out = self.run_summary()
        self.assertNotIn("| m |", out)
        self.assertIn("sentinel exit is 'failed'", out)

    def test_unscored_scaffold_is_silently_ignored(self):
        self.make_run("m", "skill", "01-landing-page", 1, result=dict(SCORED, criteria_passed=None))
        out = self.run_summary()
        self.assertNotIn("| m |", out)
        self.assertNotIn("skipped", out)

    def test_malformed_result_reported_not_fatal(self):
        # 2026-11-05: one bad file used to kill the whole table with a traceback.
        self.make_run("m", "skill", "01-landing-page", 1, result=SCORED,
                      sentinel={"exit": "completed"})
        self.make_run("m", "skill", "02-crud-app-auth", 1,
                      result={"criteria_passed": "nine"}, sentinel={"exit": "completed"})
        out = self.run_summary()
        self.assertIn("| m | skill | 1 |", out)          # the good row still counts
        self.assertIn("criteria_passed is 'nine'", out)  # the bad row is named

    def test_unreadable_result_reported_not_fatal(self):
        d = self.make_run("m", "skill", "01-landing-page", 1)
        (d / "RESULT.json").write_text("{not json")
        self.make_run("m", "baseline", "01-landing-page", 1, result=SCORED,
                      sentinel={"exit": "completed"})
        out = self.run_summary()
        self.assertIn("| m | baseline | 1 |", out)
        self.assertIn("unreadable RESULT.json", out)

    def test_censored_lower_bound_footnoted(self):
        self.make_run("m", "baseline", "01-landing-page", 1,
                      result=dict(SCORED, follow_up_prompts_needed=">4"),
                      sentinel={"exit": "completed"})
        out = self.run_summary()
        self.assertIn("| 4+ |", out)

    def test_junk_follow_up_reported_not_fatal(self):
        self.make_run("m", "skill", "01-landing-page", 1,
                      result=dict(SCORED, follow_up_prompts_needed=">a lot"),
                      sentinel={"exit": "completed"})
        out = self.run_summary()
        self.assertNotIn("| m |", out)
        self.assertIn("follow_up_prompts_needed is '>a lot'", out)

    def test_junk_tokens_do_not_kill_the_table(self):
        self.make_run("m", "skill", "01-landing-page", 1,
                      result=dict(SCORED, tokens_used="about a million"),
                      sentinel={"exit": "completed"})
        out = self.run_summary()
        self.assertIn("| m | skill | 1 |", out)
        self.assertIn("tokens_used is 'about a million'", out)


class TestMarkComplete(SummaryFixture):
    def test_marks_a_scored_run(self):
        self.make_run("m", "skill", "01-landing-page", 1, result=SCORED)
        path, err = run_benchmark.mark_complete("m", "skill", "01-landing-page", 1,
                                                self.tmp.name)
        self.assertIsNone(err)
        data = json.loads(Path(path).read_text())
        self.assertEqual(data["exit"], "completed")
        self.assertEqual(data["run"], "m/skill/01-landing-page/run1")
        # and the gated summary now counts it
        out = self.run_summary()
        self.assertIn("| m | skill | 1 |", out)

    def test_refuses_unscored_run(self):
        d = self.make_run("m", "skill", "01-landing-page", 1)
        (d / "RESULT.json").write_text(json.dumps(dict(SCORED, criteria_passed=None)))
        path, err = run_benchmark.mark_complete("m", "skill", "01-landing-page", 1,
                                                self.tmp.name)
        self.assertIsNone(path)
        self.assertIn("not scored yet", err)
        self.assertFalse((d / "run-complete.json").exists())

    def test_spec_number_resolves_to_stem(self):
        # probed live 2026-11-05: `complete --spec 01` built .../01/run1 and found
        # nothing - run dirs are keyed by the spec file stem, same as run()
        self.make_run("m", "skill", "01-landing-page", 1, result=SCORED)
        path, err = run_benchmark.mark_complete("m", "skill", "01", 1, self.tmp.name)
        self.assertIsNone(err)
        self.assertTrue(Path(path).is_file())

    def test_refuses_missing_run(self):
        path, err = run_benchmark.mark_complete("m", "skill", "01-landing-page", 9,
                                                self.tmp.name)
        self.assertIsNone(path)
        self.assertIn("no RESULT.json", err)


class TestInit(unittest.TestCase):
    def test_scaffolds_into_alternate_runs_dir(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            run_benchmark.init("m", "skill", 2, tmp.name)
        root = Path(tmp.name) / "m" / "skill"
        specs = sorted(p.name for p in root.iterdir())
        self.assertEqual(len(specs), 5, specs)
        first = root / "01-landing-page" / "run1"
        self.assertTrue((first / "RESULT.json").is_file())
        self.assertTrue((first / "SPEC.md").is_file())
        data = json.loads((first / "RESULT.json").read_text())
        self.assertIsNone(data["criteria_passed"])

    def test_init_never_overwrites_a_scored_record(self):
        # the vendored-record guarantee: re-init on a scored tree must not reset it
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = Path(tmp.name) / "m" / "skill" / "01-landing-page" / "run1"
        d.mkdir(parents=True)
        (d / "RESULT.json").write_text(json.dumps({"criteria_passed": 9}))
        with contextlib.redirect_stdout(io.StringIO()):
            run_benchmark.init("m", "skill", 2, tmp.name)
        self.assertEqual(json.loads((d / "RESULT.json").read_text())["criteria_passed"], 9)


if __name__ == "__main__":
    unittest.main(verbosity=2)
