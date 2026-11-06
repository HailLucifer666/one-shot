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

Probe for the tightened respan test, 2026-11-07: vendor-respan
re.IGNORECASE dropped (case-sensitive) -> test_respan_matches_both_cases
failed as expected (uppercase form produced no finding); restored ->
green. This is the discrimination the two separate planted lines buy.

Watched-red regressions for the quality-audit fixes, 2026-11-07 — each
written first and confirmed failing against the unfixed scanner:
- test_repo_pretty_oneline_config_still_scans:
  "AssertionError: 1 != 0" (with format.pretty=oneline and a planted
  sk- key, the scanner exited 0 — the silent false clean).
- test_removed_sql_comment_line_does_not_poison_file_column:
  "AssertionError: 'FILE query.sql | ' not found in 'PATTERN
  api-key-literal | COMMIT e31f75b7... | FILE old sql comment was here
  | ...'" (FILE column carried the removed SQL comment text).
- test_two_distinct_secrets_on_one_long_line_both_reported:
  "AssertionError: 2 != 1" (excerpt was line[:100]; the lone finding's
  excerpt was 99 padding chars containing neither key).

Mutation probes, 2026-11-07: (a) removed --pretty=medium from the git
command -> test_repo_pretty_oneline_config_still_scans failed with
"AssertionError: 1 != 2" and stderr showing the new tripwire ("git log
output has 4 patch line(s) but no 'commit <sha>' headers; output shape
is not the expected --pretty=medium") — the tripwire turned the old
silent exit 0 into a loud exit 2; restored -> green. (b) tripwire
disabled (pin intact) -> all 19 green: the pin shields the subprocess
layer, while scan_log_text itself is pure and directly reachable with
synthetic text regardless of any config — pinned by its own unit test
in the second round below (the earlier "backstop, unreachable while
the pin holds" framing was wrong at the unit layer and is withdrawn).
Restored -> green.

Second review round on aef7a9a, 2026-11-07 — watched red first:
- test_quoted_path_line_unquoted_into_real_filename:
  "AssertionError: 'café.md' != None" (core.quotePath-quoted path lines
  were rejected; the finding degraded to FILE None).
- test_space_filename_path_line_has_no_trailing_tab:
  "AssertionError: 'my file.sql' != 'my file.sql\t'" (git appends a TAB
  separator to unquoted space-filename path lines; it rode into FILE).
- test_quoted_utf8_filename_reports_real_name:
  "AssertionError: 'FILE café.md | ' not found in '... | FILE None | ...'".
- test_abbreviated_commit_headers_still_scan:
  "AssertionError: 1 != 2" with the tripwire message on stderr
  (core.abbrev=4 headers fell below _COMMIT_RE's {7,40}; a legitimate
  repo exited 2 with a message that never mentioned abbrev).
Coverage guards green on arrival by design — they pin behavior already
shipped in aef7a9a that had no committed test:
test_headerless_patch_text_raises_and_headered_scans,
test_git_timeout_maps_to_exit_2_with_loud_stderr. Byte shapes for the
synthetic fixtures verified live on git 2.53: `+++ b/my file.sql\t`
(TAB separator, no quoting), `+++ "b/caf\303\251.md"` (quoted, no
trailing TAB on this git — the regex keeps \t optional), `commit 933a`
under core.abbrev=4.

Mutation probe, 2026-11-07: quoted-path support reverted to the true
pre-fix state (both the scan_log_text quoted branch and the quoted
diff --git handling) -> test_quoted_utf8_filename_reports_real_name and
test_quoted_path_line_unquoted_into_real_filename failed with FILE None
/ "None != café.md"; restored -> green. A narrower mutation (only the
scan_log_text quoted branch disabled, quoted diff --git handling kept)
stayed green: the two quoted-path setters redundantly back each other
up, which is exactly the ---/+++ correction the scanner docstring
describes.

Third review round on dca7468, 2026-11-07 — watched red first:
- test_quoted_content_line_does_not_poison_file_column:
  "AssertionError: 'notes.sql' != 'done'" (the round-2 quoted regex
  accepted any quoted body, so a removed `-- "done"` content line
  poisoned the FILE column — the round-1 defect reopened through the
  new quoted branch).
- test_abbreviated_commit_headers_still_scan (strengthened with a
  full-sha assertion): "AssertionError: 'c724996a...' not found in
  '... | COMMIT c724 | ...'" (the COMMIT column carried the 4-hex
  abbreviation; --no-abbrev-commit now pins the full sha).
- test_quoted_devnull_sides_never_set_the_path: guard, green on arrival
  by design — pins the quoted-/dev/null behavior through the tightening
  (a quoted /dev/null side matches via the /dev/null alternation and is
  skipped as a path setter by the new_path != "/dev/null" guard; the
  real filename wins on both sides of the pair).

Implementation note: the first cut of the tightened regex dropped the
capturing group entirely ("(?:...)" everywhere), which made
quoted_match.group(1) raise IndexError — the two quoted unit tests
errored, and the cafe e2e failed with EMPTY stdout behind a rc==1 that
was Python's unhandled-exception exit code, not the findings exit. The
suite caught it before commit; the shipped regex captures the validated
body: "((?:a|b)/.*|/dev/null)".

Mutation probe, 2026-11-07: _QUOTED_PATH_LINE_RE reverted to the loose
round-2 form -> test_quoted_content_line_does_not_poison_file_column
failed with "AssertionError: 'notes.sql' != 'done'" (poisoning
reappears); restored -> green.

Fourth review round (build-pr) on 72e5572, 2026-11-07 — watched red
first: test_textconv_filters_cannot_replace_patch_body failed with
"AssertionError: 1 != 0 : textconv must not replace the patch body" —
porcelain git log -p applies .gitattributes-driven textconv filters BY
DEFAULT, so the exact fixture (.gitattributes `*.secret diff=hide` +
config diff.hide.textconv = echo TEXTCONV-REPLACED-THIS-CONTENT,
key.secret holding a planted fake sk- key) scanned CLEAN (exit 0): the
round-1 CRITICAL class through a different config door.
--no-textconv now pins the patch body to real committed content; the
two docstring claims the defect falsified verbatim (ambient-config
defense list, reachability boundary) were corrected to name the pin.
The fixture is the standard real-world textconv setup (GPG-encrypted
files, office docs) — no malice required.

Mutation probe, 2026-11-07: --no-textconv dropped from the pinned
command -> test_textconv_filters_cannot_replace_patch_body failed with
"AssertionError: 1 != 0" (the exact false clean reappears; only
failure in the run); restored -> green.
"""

import io
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
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
        "@@ -1,2 +1,11 @@",
        " unchanged context line",
        '+api_key = "fakekeyvalue123"',
        '+base_url = "https://fake.example.invalid"',
        "+contact: leaked.person@example.com",
        "+Authorization: Bearer eyJfAkETOKEN1234567890",
        "+key = sk-testFAKE0000000000000000",
        "+vpn endpoint 192.168.1.50 and old gateway 10.0.0.5",
        r"+cache dir C:\Users\acarg\AppData\cache",
        "+docs mirrored from C:/Users/dev/notes",
        # Respan gets two SEPARATE lines, each carrying only one case form:
        # one finding per excerpt, so a case-sensitive pattern fails the
        # respan test (a combined line could not distinguish the two).
        "+RESPAN endpoint",
        "+respan.ai endpoint",
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
        # Two separate planted lines (see LOG_WITH_HITS): each excerpt
        # carries exactly one case form, so a case-sensitive pattern fails
        # here - one form goes unflagged. A single combined line (both
        # forms on one line, one finding) could not distinguish the two.
        upper = [e for e in self._excerpts(LOG_WITH_HITS, "vendor-respan")
                 if "RESPAN" in e]
        lower = [e for e in self._excerpts(LOG_WITH_HITS, "vendor-respan")
                 if "respan.ai" in e]
        self.assertEqual(1, len(upper),
                         "uppercase RESPAN must produce its own finding")
        self.assertEqual(1, len(lower),
                         "lowercase respan.ai must produce its own finding")

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

    def test_two_distinct_secrets_on_one_long_line_both_reported(self):
        # Regression 2026-11-07 (watched red): the excerpt was line[:100],
        # so a secret past char 100 never appeared in its own finding's
        # evidence, and dedupe keyed on that truncation collapsed distinct
        # secrets sharing a long prefix into one finding. The excerpt must
        # be a window around the matched span, and every match on the line
        # must be reported.
        padding = "p" * 120
        line = ("+" + padding + " sk-AAAA1111AAAAAAAAAAAAAAAA "
                + padding + " sk-BBBB2222BBBBBBBBBBBBBBBB")
        self.assertGreater(len(line), 100)
        text = _commit_block(SHA_A, "long.md", ["@@ -1,1 +1,2 @@", line])
        sk = [f for f in self._scan(text) if f.pattern == "api-key-sk"]
        self.assertEqual(2, len(sk),
                         "two distinct sk- keys on one line must yield "
                         "two findings, got: {}".format(sk))
        first = [f for f in sk if "sk-AAAA1111AAAAAAAA" in f.excerpt]
        second = [f for f in sk if "sk-BBBB2222BBBBBBBB" in f.excerpt]
        self.assertEqual(1, len(first),
                         "first key's finding must show the first key")
        self.assertEqual(1, len(second),
                         "second key's finding must show the second key")
        self.assertNotEqual(first[0].excerpt, second[0].excerpt,
                            "distinct secrets must dedupe separately")

    def test_quoted_path_line_unquoted_into_real_filename(self):
        # Regression 2026-11-07 round 2 (watched red): core.quotePath
        # (default true) makes git emit `+++ "b/caf\303\251.md"` for
        # non-ASCII filenames; the strict path regex rejected the quoted
        # form and _path_from_diff_git_line returned None on the quoted
        # diff --git line, so findings degraded to FILE None. The quoted
        # body (including the b/ prefix) is C-unescaped -- \" and \\ plus
        # three-digit octal bytes -- then UTF-8 decoded. Byte shape
        # verified live on git 2.53: quoted lines carry no trailing TAB
        # here; the optional \t in the regex tolerates versions that do.
        text = "\n".join([
            "commit " + SHA_A,
            "diff --git \"a/caf\\303\\251.md\" \"b/caf\\303\\251.md\"",
            "--- \"a/caf\\303\\251.md\"",
            "+++ \"b/caf\\303\\251.md\"",
            "@@ -1,1 +1,2 @@",
            "+api_key = \"fakekeyvalue123\"",
            "",
        ])
        findings = self._scan(text)
        self.assertEqual(["api-key-literal"], [f.pattern for f in findings])
        self.assertEqual("caf\u00e9.md", findings[0].file,
                         "quoted path must unescape to the real filename, "
                         "got: {}".format(findings[0].file))

    def test_space_filename_path_line_has_no_trailing_tab(self):
        # Regression 2026-11-07 round 2 (watched red): git does NOT quote
        # space filenames -- it appends a TAB separator instead
        # (`+++ b/my file.sql\t`, byte shape verified live on git 2.53),
        # and the raw line[4:] slice carried that TAB into the FILE column
        # (pre-existing defect, now stripped).
        text = "\n".join([
            "commit " + SHA_A,
            "diff --git a/my file.sql b/my file.sql",
            "--- a/my file.sql\t",
            "+++ b/my file.sql\t",
            "@@ -1,1 +1,2 @@",
            "+api_key = \"fakekeyvalue123\"",
            "",
        ])
        findings = self._scan(text)
        self.assertEqual(["api-key-literal"], [f.pattern for f in findings])
        self.assertEqual("my file.sql", findings[0].file,
                         "FILE column must not carry the TAB separator, "
                         "got: {}".format(repr(findings[0].file)))

    def test_headerless_patch_text_raises_and_headered_scans(self):
        # Coverage guard, 2026-11-07 round 2: the tripwire shipped in
        # aef7a9a had no committed test. scan_log_text is pure and
        # directly reachable with synthetic text -- the --pretty=medium
        # pin does NOT shield this layer, so the earlier "unreachable
        # while the pin holds" note was wrong and has been removed.
        text = "diff --git a/x b/x\n--- a/x\n+++ b/x\n+sk-fakekey123456\n"
        with self.assertRaises(audit_history.ScanError):
            self._scan(text)
        headed = "commit " + SHA_A + "\n" + text
        sk = [f for f in self._scan(headed) if f.pattern == "api-key-sk"]
        self.assertEqual(1, len(sk),
                         "the same text with a commit header must scan, "
                         "not raise")

    def test_quoted_content_line_does_not_poison_file_column(self):
        # Regression 2026-11-07 round 3 (watched red): the quoted
        # path-line regex accepted ANY quoted body, so a removed content
        # line shaped `-- "done"` (SQL comment quoting an identifier)
        # rendered as `--- "done"` and matched, poisoning the FILE column
        # to "done" for the rest of the diff -- the round-1 defect
        # reopened through the new quoted branch (reviewer reproduced at
        # unit level: file='done'). The quoted body now requires the same
        # a/ b/ /dev/null prefix set as the plain form, so the line falls
        # through to the patch-body branch and is scanned as removed
        # content under the real filename.
        text = "\n".join([
            "commit " + SHA_A,
            "diff --git a/notes.sql b/notes.sql",
            "--- a/notes.sql",
            "+++ b/notes.sql",
            "@@ -1,2 +1,2 @@",
            "--- \"done\"",
            "+SELECT 1;",
            "+api_key = \"fakekeyvalue123\"",
            "",
        ])
        findings = self._scan(text)
        self.assertEqual(["api-key-literal"], [f.pattern for f in findings])
        self.assertEqual("notes.sql", findings[0].file,
                         "removed '-- \"done\"' content must not poison "
                         "FILE, got: {}".format(findings[0].file))

    def test_quoted_devnull_sides_never_set_the_path(self):
        # Guard, 2026-11-07 round 3: pins the intended behavior for a
        # quoted /dev/null on BOTH sides of a /dev/null rename pair (git
        # never quotes pure-ASCII /dev/null in practice; this pins the
        # parser if a git version ever does). Observed behavior, stated
        # per review request: a quoted /dev/null side matches the
        # tightened quoted regex via the /dev/null alternation and is then
        # skipped as a path setter by the same new_path != "/dev/null"
        # guard the plain form uses, so the real filename from the other
        # side wins and no finding ever reports FILE /dev/null. Green on
        # arrival by design: it pins behavior that must survive the
        # round-3 regex tightening.
        created = "\n".join([
            "commit " + SHA_A,
            "diff --git \"a/caf\\303\\251.md\" \"b/caf\\303\\251.md\"",
            "--- \"/dev/null\"",
            "+++ \"b/caf\\303\\251.md\"",
            "@@ -0,0 +1,1 @@",
            "+api_key = \"fakekeyvalue123\"",
            "",
        ])
        deleted = "\n".join([
            "commit " + SHA_B,
            "diff --git \"a/caf\\303\\251.md\" \"b/caf\\303\\251.md\"",
            "--- \"a/caf\\303\\251.md\"",
            "+++ \"/dev/null\"",
            "@@ -1,1 +0,0 @@",
            "-api_key = \"fakekeyvalue123\"",
            "",
        ])
        for text in (created, deleted):
            findings = self._scan(text)
            self.assertEqual(["api-key-literal"],
                             [f.pattern for f in findings])
            self.assertEqual("caf\u00e9.md", findings[0].file,
                             "/dev/null side must be skipped as a path "
                             "setter, got: {}".format(findings[0].file))


class MainUnitTests(unittest.TestCase):
    """main()-level error mapping that needs no git subprocess."""

    def test_git_timeout_maps_to_exit_2_with_loud_stderr(self):
        # Coverage guard, 2026-11-07 round 2: the 120s git timeout shipped
        # in aef7a9a had no committed test. A hung git must exit 2 loudly,
        # never hang CI and never report clean.
        def boom(*args, **kwargs):
            raise subprocess.TimeoutExpired(cmd="git log", timeout=120)

        original_run = audit_history.subprocess.run
        audit_history.subprocess.run = boom
        try:
            stderr = io.StringIO()
            with redirect_stderr(stderr):
                code = audit_history.main([])
        finally:
            audit_history.subprocess.run = original_run
        self.assertEqual(2, code)
        self.assertIn("timed out", stderr.getvalue())


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

    def test_repo_pretty_oneline_config_still_scans(self):
        # Regression 2026-11-07 (CRITICAL, watched red): with
        # format.pretty=oneline, `git log --all -p` printed one-liners with
        # no `commit <sha>` headers; the parser recognised no commits,
        # skipped every patch line behind the commit-is-None guard, and the
        # scanner exited 0 on a repo full of secrets. The command now pins
        # --pretty=medium (command line beats config), and scan_log_text()
        # raises ScanError if patch content ever appears without commit
        # headers, so a future output-shape surprise exits 2, never clean.
        cfg = self._git("config", "format.pretty", "oneline")
        self.assertEqual(cfg.returncode, 0, cfg.stderr)
        self._commit_file("note.md", 'key = "sk-testFAKE0000000000000000"\n')
        done = self._run_scanner()
        self.assertEqual(1, done.returncode,
                         "oneline format must not silence the scanner:\n"
                         + done.stdout + done.stderr)
        self.assertIn("api-key-sk", done.stdout)
        self.assertIn("sk-testFAKE", done.stdout)

    def test_removed_sql_comment_line_does_not_poison_file_column(self):
        # Regression 2026-11-07 (watched red): a removed line whose content
        # starts with "-- " (SQL comment) renders as `--- <text>` in the
        # patch; the parser took any `--- ` line for a file-path line, so
        # the FILE column reported the comment text for later findings in
        # the same diff. Paths are now accepted only from
        # `--- / +++ (a/|b/|/dev/null)`, with the a/ b/ prefixes pinned on
        # the git command line (-c diff.*Prefix / noprefix / mnemonic).
        self._commit_file("query.sql", "-- old sql comment was here\nSELECT 1;\n")
        self._commit_file("query.sql", 'SELECT 1;\napi_key = "fakekeyvalue123"\n')
        done = self._run_scanner()
        self.assertEqual(1, done.returncode, done.stdout + done.stderr)
        self.assertIn("api-key-literal", done.stdout)
        self.assertIn("FILE query.sql | ", done.stdout)
        self.assertNotIn("old sql comment was here", done.stdout,
                         "comment text must not leak into the FILE column "
                         "or any finding:\n" + done.stdout)

    def test_quoted_utf8_filename_reports_real_name(self):
        # Regression 2026-11-07 round 2 (watched red): end-to-end twin of
        # the quoted-path unit test -- a real repo file named café.md,
        # core.quotePath on by default, finding must show the real
        # filename, not FILE None.
        self._commit_file("caf\u00e9.md", 'api_key = "fakekeyvalue123"\n')
        done = self._run_scanner()
        self.assertEqual(1, done.returncode, done.stdout + done.stderr)
        self.assertIn("api-key-literal", done.stdout)
        self.assertIn("FILE caf\u00e9.md | ", done.stdout)
        self.assertNotIn("FILE None", done.stdout)

    def test_abbreviated_commit_headers_still_scan(self):
        # Regression 2026-11-07 round 2 (watched red): with core.abbrev=4
        # the medium-format header is `commit 933a` (shape verified live
        # on git 2.53), below _COMMIT_RE's old {7,40} minimum; no header
        # matched, the tripwire fired, and a legitimate repo exited 2 with
        # a message that never mentioned abbrev. The regex now accepts
        # 4-40 hex digits (safe at column 0: patch lines are always
        # prefixed and commit messages are indented). Pinned to exit 1 --
        # the reviewer allowed 2 as tolerance, but a test accepting 2
        # could never fail, i.e. could never catch this widening
        # regressing; a future exit 2 here IS the defect re-appearing.
        # Round 3 (watched red): --no-abbrev-commit now pins the COMMIT
        # column to the full 40-hex sha regardless of log.abbrevCommit /
        # core.abbrev (a 4-hex sha can collide across commits and collapse
        # the dedupe); the {4,40} header regex still accepts full shas.
        self._git("config", "log.abbrevCommit", "true")
        self._git("config", "core.abbrev", "4")
        self._commit_file("note.md", 'key = "sk-testFAKE0000000000000000"\n')
        full_sha = self._git("rev-parse", "HEAD").stdout.strip()
        self.assertEqual(40, len(full_sha), full_sha)
        done = self._run_scanner()
        self.assertEqual(1, done.returncode,
                         "abbreviated commit headers must not degrade the "
                         "scan:\n" + done.stdout + done.stderr)
        self.assertIn("api-key-sk", done.stdout)
        self.assertIn(full_sha, done.stdout,
                      "COMMIT column must carry the full 40-hex sha even "
                      "under log.abbrevCommit / core.abbrev:\n"
                      + done.stdout)

    def test_textconv_filters_cannot_replace_patch_body(self):
        # Regression 2026-11-07 round 4 (watched red): porcelain
        # `git log -p` applies textconv filters BY DEFAULT, so a repo
        # with .gitattributes `*.secret diff=hide` plus config
        # diff.hide.textconv made the pinned command emit
        # `+TEXTCONV-REPLACED-THIS-CONTENT <tmpfile>` instead of the real
        # content line: a committed key.secret holding a fake sk- key
        # scanned CLEAN (exit 0) -- the round-1 CRITICAL class (silent
        # false clean) through a different config door. --no-textconv
        # pins the patch body to real committed content. Real-world
        # trigger needs no malice: textconv is the standard setup for
        # GPG-encrypted files and office docs.
        self._commit_file(".gitattributes", "*.secret diff=hide\n")
        cfg = self._git("config", "diff.hide.textconv",
                        "echo TEXTCONV-REPLACED-THIS-CONTENT")
        self.assertEqual(cfg.returncode, 0, cfg.stderr)
        self._commit_file("key.secret",
                          'api_key = "sk-testFAKE0000000000000000"\n')
        done = self._run_scanner()
        self.assertEqual(1, done.returncode,
                         "textconv must not replace the patch body:\n"
                         + done.stdout + done.stderr)
        self.assertIn("api-key-sk", done.stdout)
        self.assertIn("sk-testFAKE", done.stdout)
        self.assertNotIn("TEXTCONV-REPLACED-THIS-CONTENT", done.stdout,
                         "textconv output must not reach the findings:\n"
                         + done.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
