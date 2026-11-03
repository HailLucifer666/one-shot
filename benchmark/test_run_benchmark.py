#!/usr/bin/env python3
"""Regression tests for run_benchmark.py. Standard library only.

  python -I benchmark/test_run_benchmark.py

Guards the gateway endpoint. The naive form of this test — assert the URL and
move on — is a false green: it passes against code that honours a
RESPAN_BASE_URL override whenever the variable is unset, which is always.
The second test therefore SETS the variable and asserts the hosted gateway
wins anyway. Probe record: with the pre-trim code (env lookup live) this test
fails exactly there, for that reason; the trim turned it green. 2026-11-03.
"""
import os
import sys
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


if __name__ == "__main__":
    unittest.main()
