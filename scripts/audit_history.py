#!/usr/bin/env python3
"""Scan `git log --all -p` output for secrets and personal data before first push.

Task 1.2 of the pre-publication hardening plan. This repo has never been
pushed to a remote; cleaning history is cheap NOW and expensive after a
push. The tool reads the full patch history and reports every line of
committed file content that matches a leak pattern.

  python -I scripts/audit_history.py [--repo PATH]   (default repo: cwd)

Design decisions (set by the controller 2026-11-07, implemented as-is):

- Scan diff CONTENT only: patch-body lines (starting +/-) plus file-path
  lines (diff --git, ---/+++). Rationale: "author emails are structural git
  metadata, not leaks; flagged emails must be committed content (decided by
  controller 2026-11-07)". Not scanned: Author/Date headers, hunk @@
  headers, index/mode lines, and 4-space-indented commit messages (messages
  are a known, accepted blind spot of this design).
- `sk-` uses a word boundary + 8+ key characters: a bare "sk-" substring
  would false-hit "task-" and "risk-".
- Exit codes: 0 = clean, 1 = one or more hits, 2 = operational failure
  (not a git repo / git failed) with a loud stderr message naming the
  problem. A git failure is never reported as "clean".
- Parsing/matching lives in the pure function scan_log_text() (text in ->
  findings out, no subprocess or filesystem access), so tests can feed
  synthetic `git log -p` text directly and fast; main() does subprocess +
  IO only.
- Output: one line per hit,
  PATTERN <name> | COMMIT <sha> | FILE <path> | <excerpt up to 100 chars>.
  Identical (pattern, commit, file, excerpt) tuples are reported once; the
  same content in different commits is reported per commit (history
  matters for cleaning).

Known non-coverage (accepted for this task): commit messages (see above),
binary-file contents ("Binary files ... differ" lines carry no text), and
anything not reachable via `git log --all -p`.
"""

import argparse
import re
import subprocess
import sys
from collections import namedtuple

Finding = namedtuple("Finding", ["pattern", "commit", "file", "excerpt"])

_EXCERPT_MAX = 100

_COMMIT_RE = re.compile(r"^commit ([0-9a-f]{7,40})(?:\s|$)")

# Each entry: (report name, compiled regex). Rationale for the non-obvious
# shapes lives inline. All matching runs on the raw patch line (diff marker
# included) — markers are +/-/space, which never break a word boundary.
PATTERNS = [
    # The username itself, any case, whole word only.
    ("windows-username", re.compile(r"\bacarg\b", re.IGNORECASE)),
    # Windows user-profile path, back- and forward-slash forms. Any drive
    # letter (profiles get relocated), case-insensitive, at least one char
    # after the final separator so a bare "C:\Users" mention stays clean.
    ("windows-profile-path",
     re.compile(r"[a-z]:[\\/]+users[\\/]+[^\s\"']+", re.IGNORECASE)),
    # Vendor name; leading word boundary only, so respan.ai and RESPAN_x
    # match while "forespan" does not.
    ("vendor-respan", re.compile(r"\brespan", re.IGNORECASE)),
    # \b + 8+ key chars after the dash: a bare "sk-" substring would
    # false-hit "task-" and "risk-"; the charset and length keep real key
    # shapes and reject prose.
    ("api-key-sk", re.compile(r"\bsk-[A-Za-z0-9_-]{8,}")),
    # "Bearer" followed by a token-like string (8+ chars of RFC 3986-ish
    # token charset). Without the token requirement, "Bearer" alone or
    # "Bearer auth" in docs would false-hit.
    ("bearer-token",
     re.compile(r"\bBearer\s+[A-Za-z0-9\-._~+/=]{8,}", re.IGNORECASE)),
    ("api-key-literal", re.compile(r"api_key", re.IGNORECASE)),
    ("base-url-literal", re.compile(r"base_url", re.IGNORECASE)),
    # Pragmatic email shape: local@domain.tld (2+ letter TLD).
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    # RFC1918 + loopback only, with boundaries so "210.1.2.3" and version
    # strings don't match; 172.x is limited to the 16-31 second octet.
    ("private-ip", re.compile(
        r"\b(?:"
        r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
        r"|127\.\d{1,3}\.\d{1,3}\.\d{1,3}"
        r"|192\.168\.\d{1,3}\.\d{1,3}"
        r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
        r")\b")),
]


class ScanError(Exception):
    """Operational failure: not a git repo, git missing, or git failed."""


def run_git_log(repo):
    """Run `git -C <repo> log --all -p` and return stdout as text.

    Raises ScanError with the git stderr embedded, so the caller can print
    a loud message naming the problem instead of reporting a false "clean".
    """
    # --no-color is defensive: a user's color.ui=always would corrupt parsing.
    cmd = ["git", "-C", repo, "log", "--all", "-p", "--no-color"]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError:
        raise ScanError("git executable not found on PATH") from None
    if proc.returncode != 0:
        git_stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise ScanError("git log failed for repo {!r} (exit {}): {}".format(
            repo, proc.returncode, git_stderr))
    return proc.stdout.decode("utf-8", errors="replace")


def _path_from_diff_git_line(line):
    """Extract the b/ side path from a `diff --git a/x b/y` line, or None."""
    marker = line.find(" b/")
    if marker == -1:
        return None
    return line[marker + 3:]


def _strip_ab_prefix(path):
    if path.startswith(("a/", "b/")):
        return path[2:]
    return path


def _scan_line(raw_line, commit, path, findings, seen):
    """Match every pattern against one patch line; append deduped findings."""
    if commit is None or not raw_line.strip():
        return
    excerpt = raw_line.lstrip("+-").strip()
    if not excerpt:
        return
    for name, regex in PATTERNS:
        if not regex.search(raw_line):
            continue
        trimmed = excerpt[:_EXCERPT_MAX]
        key = (name, commit, path, trimmed)
        if key in seen:
            continue
        seen.add(key)
        findings.append(Finding(name, commit, path, trimmed))


def scan_log_text(text):
    """Pure function: `git log -p` text in -> deduped findings out.

    Walks the log line by line, tracking the current commit (from
    `commit <sha>` headers) and current file (from diff --git / --- / +++
    path lines). Only patch-body lines and path lines are pattern-scanned;
    everything else is git metadata or commit-message text (design
    decision 1). Paths are best-effort: quoted paths with spaces fall back
    to the ---/+++ lines, which follow every diff --git line anyway.
    """
    findings = []
    seen = set()
    commit = None
    path = None
    for raw in text.split("\n"):
        line = raw.rstrip("\r")
        commit_match = _COMMIT_RE.match(line)
        if commit_match:
            commit, path = commit_match.group(1), None
            continue
        if line.startswith("diff --git "):
            path = _path_from_diff_git_line(line)
            _scan_line(line, commit, path, findings, seen)
            continue
        if line.startswith(("--- ", "+++ ")):
            new_path = _strip_ab_prefix(line[4:])
            if new_path and new_path != "/dev/null":
                path = new_path
            _scan_line(line, commit, path, findings, seen)
            continue
        if line[:1] in ("+", "-"):
            _scan_line(line, commit, path, findings, seen)
            continue
        # Everything else (Author/Date headers, index/mode lines, hunk @@
        # headers, 4-space-indented commit messages) is git metadata or
        # message text: not committed file content, not scanned.
    return findings


def main(argv=None):
    # Windows pipes use cp1252; decoded git bytes may not be representable.
    # Never crash the audit on printing a finding.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except AttributeError:
            pass
    parser = argparse.ArgumentParser(
        description="Flag secrets and personal data in git history "
                    "(diff content only, never git metadata).")
    parser.add_argument("--repo", default=".",
                        help="path to the git repository (default: current directory)")
    args = parser.parse_args(argv)
    try:
        log_text = run_git_log(args.repo)
    except ScanError as exc:
        print("ERROR: {}".format(exc), file=sys.stderr)
        print("Exiting 2: the scan did NOT run; this is not a clean result.",
              file=sys.stderr)
        return 2
    findings = scan_log_text(log_text)
    for finding in findings:
        print("PATTERN {} | COMMIT {} | FILE {} | {}".format(
            finding.pattern, finding.commit, finding.file, finding.excerpt))
    if findings:
        print("{} finding(s); exiting 1.".format(len(findings)), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
