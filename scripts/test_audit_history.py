#!/usr/bin/env python3
"""Tests for scripts/audit_history.py. Standard library only.

  python -I scripts/test_audit_history.py

Two layers:
- Unit tests feed synthetic `git log -p` text straight into the pure
  function scan_log_text(): fast, no git binary, no filesystem. One test
  per pattern class, plus must-stay-clean guards (task-, risk-, version
  strings, public IPs, bare Bearer, 172.32.x, git Author metadata) and
  dedupe / per-commit reporting guards.
- End-to-end tests build throwaway git repos in a temp dir, commit with a
  pinned identity (-c user.name / -c user.email, so global git config is
  irrelevant), and run the scanner as a subprocess to pin exit codes
  1 (hits) / 0 (clean) / 2 (operational failure).

Mutation probes run 2026-11-07: (a) removed sk- pattern -> e2e planted-key
test failed as expected; (b) restored -> green. Extra probe same day:
private-ip loosened to any dotted quad -> test_innocent_lines_produce_
no_findings failed as expected (public 203.0.113.9 got flagged); restored
-> green. Both mutations were verified applied (grep for the pattern name
in the scanner) before trusting the red.
"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import audit_history


def _commit_block(sha, file_path, patch_lines, message="update notes"):
    """Build one synthetic `git log -p` commit block with a realistic shape.

    Includes the git metadata headers and an indented commit message so the
    tests prove those are NOT scanned (design decision 1).
    """
    lines = [
        "commit " + sha,
        "Author: Test User <test@example.com>",
        "Date:   Fri Nov 7 10:00:00 2026 +0530",
        "",
        "    " + message,
        "",
        "diff --git a/" + file_path + " b/" + file_path,
        "index 1111111..2222222 100644",
        "--- a/" + file_path,
        "+++ b/" + file_path,
    ]
    lines.extend(patch_lines)
    return "\n".join(lines) + "\n"


SHA_A = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111"
SHA_B = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222"

LOG_WITH_HITS = _commit_block(
    SHA_A, "config/settings.md",
    [
        "@@ -1,2 +1,10 @@",
        " unchanged context line",
        '+api_key = "fakekeyvalue123"',
        '+base_url = "https://fake.example.invalid"',
        "+contact: leaked.person@example.com",
        "+Authorization: Bearer eyJfAkETOKEN1234567890",
        "+key = sk-testFAKE0000000000000000",
        "+vpn endpoint 192.168.1.50 and old gateway 10.0.0.5",
        r"+cache dir C:\Users\acarg\AppData\cache",
        "+docs mirrored from C:/Users/dev/notes",
        "+we use RESPAN and respan.ai daily",
        "-stale line mentioning 172.16.5.4",
    ],
)

LOG_INNOCENT = _commit_block(
    SHA_B, "docs/readme.md",
    [
        "@@ -1,2 +1,5 @@",
        "+task-list and risk-free wording stayed; version 1.2.3 shipped",
        "+the proxy 203.0.113.9 is public and 172.32.0.1 is not in the private ranges",
        "+the auth docs explain: Bearer",
        " unchanged trailing context",
    ],
)

LOG_AUTHOR_ONLY = _commit_block(
    "cccc3333cccc3333cccc3333cccc3333cccc3333", "docs/readme.md",
    ["@@ -1,2 +1,2 @@", " context only, nothing added"],
    message="reworded the api_key docs note",
)


class ScanLogTextUnitTests(unittest.TestCase):
    """Pattern-class coverage against synthetic `git log -p` text."""

    def _scan(self, text):
        return audit_history.scan_log_text(text)

    def _patterns(self, text):
        return [f.pattern for f in self._scan(text)]

    def _excerpts(self, text, pattern):
        return [f.excerpt for f in self._scan(text) if f.pattern == pattern]

    def test_sk_key_flagged(self):
        self.assertIn("api-key-sk", self._patterns(LOG_WITH_HITS))
        self.assertTrue(
            any("sk-testFAKE" in e for e in self._excerpts(LOG_WITH_HITS, "api-key-sk")),
            "sk- excerpt must carry the planted key text")

    def test_email_in_file_line_flagged(self):
        self.assertIn("email", self._patterns(LOG_WITH_HITS))
        self.assertTrue(
            any("leaked.person@example.com" in e
                for e in self._excerpts(LOG_WITH_HITS, "email")))

    def test_bearer_token_flagged(self):
        self.assertIn("bearer-token", self._patterns(LOG_WITH_HITS))
        self.assertTrue(
            any("Bearer eyJfAkETOKEN" in e
                for e in self._excerpts(LOG_WITH_HITS, "bearer-token")))

    def test_api_key_literal_flagged(self):
        self.assertIn("api-key-literal", self._patterns(LOG_WITH_HITS))

    def test_base_url_literal_flagged(self):
        self.assertIn("base-url-literal", self._patterns(LOG_WITH_HITS))

    def test_respan_matches_both_cases(self):
        self.assertIn("vendor-respan", self._patterns(LOG_WITH_HITS))
        joined = " ".join(self._excerpts(LOG_WITH_HITS, "vendor-respan"))
        self.assertIn("RESPAN", joined)
        self.assertIn("respan.ai", joined)

    def test_private_ip_ranges_flagged(self):
        self.assertIn("private-ip", self._patterns(LOG_WITH_HITS))
        joined = " ".join(self._excerpts(LOG_WITH_HITS, "private-ip"))
        self.assertIn("192.168.1.50", joined)
        self.assertIn("10.0.0.5", joined)
        # Removed (-) lines are history too and must be scanned.
        self.assertIn("172.16.5.4", joined)

    def test_username_and_profile_path_both_fire(self):
        pats = self._patterns(LOG_WITH_HITS)
        self.assertIn("windows-username", pats)
        self.assertIn("windows-profile-path", pats)
        self.assertTrue(
            any("acarg" in e for e in self._excerpts(LOG_WITH_HITS, "windows-username")))

    def test_forward_slash_profile_flags_path_not_username(self):
        self.assertTrue(
            any("C:/Users/dev/notes" in e
                for e in self._excerpts(LOG_WITH_HITS, "windows-profile-path")))
        self.assertNotIn(
            "windows-username",
            [f.pattern for f in self._scan(LOG_WITH_HITS) if "C:/Users/dev" in f.excerpt],
            "a profile path of another user must not fire the acarg username pattern")

    def test_innocent_lines_produce_no_findings(self):
        # task-, risk-, 1.2.3, public IP, bare Bearer, 172.32.x: all clean.
        self.assertEqual([], self._scan(LOG_INNOCENT))

    def test_author_metadata_and_commit_message_not_flagged(self):
        # Author header carries an email; commit message carries api_key.
        # Neither is committed file content (design decision 1): no hits.
        self.assertEqual([], self._scan(LOG_AUTHOR_ONLY))

    def test_dedupe_identical_hits_once(self):
        text = _commit_block(SHA_A, "cfg.md", [
            "@@ -1,2 +1,3 @@", " ctx",
            "+key = sk-testFAKE0000000000000000",
            "@@ -9,2 +10,3 @@", " ctx2",
            "+key = sk-testFAKE0000000000000000",
        ])
        sk = [f for f in self._scan(text) if f.pattern == "api-key-sk"]
        self.assertEqual(1, len(sk), "identical (pattern, commit, file, excerpt) "
                                     "tuples must be reported once")

    def test_same_content_in_two_commits_reported_per_commit(self):
        added = _commit_block(SHA_A, "cfg.md",
                              ["@@ -1,1 +1,2 @@", " ctx",
                               "+key = sk-testFAKE0000000000000000"])
        removed = _commit_block(SHA_B, "cfg.md",
                                ["@@ -1,2 +1,1 @@", " ctx",
                                 "-key = sk-testFAKE0000000000000000"])
        commits = {f.commit for f in self._scan(added + removed)
                   if f.pattern == "api-key-sk"}
        self.assertEqual({SHA_A, SHA_B}, commits)


class EndToEndTests(unittest.TestCase):
    """Scanner as a subprocess against throwaway git repos: exit codes."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = os.path.join(self.tmp.name, "repo")
        os.makedirs(self.repo)
        init = self._git("init", "-q")
        self.assertEqual(init.returncode, 0, init.stderr)
        self.scanner = str(Path(__file__).resolve().parent / "audit_history.py")

    def _git(self, *args):
        return subprocess.run(["git", "-C", self.repo] + list(args),
                              capture_output=True, text=True)

    def _commit_file(self, name, content):
        with open(os.path.join(self.repo, name), "w", encoding="utf-8") as fh:
            fh.write(content)
        add = self._git("add", "-A")
        self.assertEqual(add.returncode, 0, add.stderr)
        commit = self._git("-c", "user.name=Tester", "-c",
                           "user.email=test@example.com", "commit", "-q",
                           "-m", "add " + name)
        self.assertEqual(commit.returncode, 0, commit.stderr)

    def _run_scanner(self, repo=None):
        return subprocess.run(
            [sys.executable, "-I", self.scanner, "--repo", repo or self.repo],
            capture_output=True, text=True)

    def test_planted_secret_exits_1_and_reports_excerpt(self):
        self._commit_file("note.md",
                          "a clean first line\n"
                          'api_key = "fakekeyvalue123"\n'
                          'key = "sk-testFAKE0000000000000000"\n')
        done = self._run_scanner()
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("api-key-sk", done.stdout)
        self.assertIn("sk-testFAKE", done.stdout)
        self.assertIn("note.md", done.stdout)
        self.assertIn("api-key-literal", done.stdout)

    def test_clean_repo_exits_0(self):
        self._commit_file("note.md", "clean note about testing version 1.2.3\n")
        done = self._run_scanner()
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertNotIn("PATTERN", done.stdout)

    def test_non_git_dir_exits_2(self):
        plain = os.path.join(self.tmp.name, "plain")
        os.makedirs(plain)
        done = self._run_scanner(repo=plain)
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertIn("not a git repository", done.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
