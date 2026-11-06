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
  PATTERN <name> | COMMIT <sha> | FILE <path> | <excerpt: window around
  the matched span, ~40 chars either side, ellipses where trimmed>.
  The excerpt is taken from the raw patch line, so it may begin with the
  +/- diff marker (kept deliberately: the marker shows whether the line
  was added or removed).
  Identical (pattern, commit, file, excerpt) tuples are reported once; the
  same content in different commits is reported per commit (history
  matters for cleaning). Every match on a line is reported (not just the
  first), and the excerpt always contains the matched span, so a secret
  far into a long line is still visible and two distinct secrets cannot
  collapse into one deduped finding (quality-audit fix, 2026-11-07).

Output-shape defenses (quality-audit fix, 2026-11-07): the git command
pins --pretty=medium and the diff prefixes (-c diff.noprefix / mnemonic /
srcPrefix / dstPrefix) so ambient user config cannot change the output
shape the parser depends on (format.pretty=oneline used to silence the
scanner into a false "clean"); --no-ext-diff is belt-and-suspenders (git
log runs external diff drivers only on an explicit --ext-diff; verified
not invoked with the flag removed); --no-abbrev-commit keeps the COMMIT
column at the full 40-hex sha regardless of log.abbrevCommit / core.abbrev
(a 4-hex sha can collide across commits and collapse the dedupe);
scan_log_text() additionally refuses
patch content with no `commit <sha>` headers (ScanError -> exit 2) so any
future shape surprise is loud, never silent; and the git call has a 120s
timeout so a hung git cannot hang CI.

Known non-coverage (accepted for this task): commit messages (see above),
binary-file contents ("Binary files ... differ" lines carry no text), and
anything not reachable via `git log --all -p` -- concretely, a secret
introduced only in a merge resolution does not appear in this output
(verified on this git). Exit 0 therefore certifies "no secrets reachable
by git log --all -p", NOT the whole history; any future CI check built on
this tool must not be trusted past that boundary.
"""

import argparse
import re
import subprocess
import sys
from collections import namedtuple

Finding = namedtuple("Finding", ["pattern", "commit", "file", "excerpt"])

# Excerpt window: chars of context kept on each side of the matched span
# (clamped to the line bounds, ellipses where trimmed). The match itself is
# always fully inside the excerpt.
_EXCERPT_RADIUS = 40

# 4 hex minimum: core.abbrev=4 shortens medium-format headers to
# `commit 933a` (git's abbrev floor is 4; shape verified live on git
# 2.53). Safe at column 0 -- patch lines are always prefixed and commit
# messages are indented, so a short-hex `commit ` token there can only
# be a header.
_COMMIT_RE = re.compile(r"^commit ([0-9a-f]{4,40})(?:\s|$)")

# File-path lines are trusted only in the exact shape git emits: the two
# dashes/plusses, a space, then a known prefix. A removed source line that
# merely starts with "-- " (SQL comments, YAML) renders as `--- <text>` and
# used to be taken for a path line, poisoning the FILE column (fixed
# 2026-11-07). a/ b/ are pinned on the git command line (see run_git_log).
_AB_PATH_LINE_RE = re.compile(r"^(?:---|\+\+\+) (?:a/|b/|/dev/null)")

# core.quotePath (default true) C-quotes non-ASCII filenames, so the line
# arrives as `+++ "b/caf\303\251.md"`. Verified live on git 2.53: quoted
# lines carry no trailing TAB there; the optional \t tolerates versions
# that append one. The quoted body must carry the same a/ b/ /dev/null
# prefix set as the plain form: a removed content line shaped `-- "done"`
# (SQL comment quoting an identifier) renders as `--- "done"` and must
# fall through to the patch-body branch, not poison the FILE column
# (round-3 fix). Greedy .* is safe: raw quotes inside quoted bodies are
# always backslash-escaped (reviewer-verified).
_QUOTED_PATH_LINE_RE = re.compile(
    r'^(?:---|\+\+\+) "((?:a|b)/.*|/dev/null)"\t?$')

# Same for the diff --git header of a quoted path: both sides quoted.
_DIFF_GIT_QUOTED_RE = re.compile(r'^diff --git "(?:.+)" "(.+)"$')

# Short forms git's C-quoting uses; every other non-printable byte arrives
# as backslash + three octal digits (handled in _unquote_git_path).
_C_SHORT_ESCAPES = {
    '"': b'"', "\\": b"\\", "a": b"\a", "b": b"\b", "f": b"\f",
    "n": b"\n", "r": b"\r", "t": b"\t", "v": b"\v",
}

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
    # Ambient-config defenses (quality-audit fix, 2026-11-07): a command
    # line --pretty beats any format.pretty config (oneline output has no
    # `commit <sha>` headers and used to silence the scanner entirely),
    # the -c diff.* pins force the standard a/ b/ path-line prefixes no
    # matter the user's diff.noprefix / mnemonicPrefix / srcPrefix /
    # dstPrefix config. --no-ext-diff is belt-and-suspenders: git log runs
    # external diff drivers only on an explicit --ext-diff (verified: not
    # invoked with this flag removed), so this closes an already-shut
    # door. --no-abbrev-commit keeps the COMMIT column at the full 40-hex
    # sha no matter the user's log.abbrevCommit / core.abbrev: a 4-hex
    # sha can collide across commits and collapse the dedupe.
    # --no-color is the same defense class: a user's color.ui=always
    # would corrupt parsing.
    cmd = [
        "git", "-C", repo,
        "-c", "diff.noprefix=false",
        "-c", "diff.mnemonicPrefix=false",
        "-c", "diff.srcPrefix=a/",
        "-c", "diff.dstPrefix=b/",
        "log", "--all", "-p",
        "--no-color", "--pretty=medium", "--no-ext-diff",
        "--no-abbrev-commit",
    ]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=120)
    except FileNotFoundError:
        raise ScanError("git executable not found on PATH") from None
    except subprocess.TimeoutExpired:
        raise ScanError(
            "git log for repo {!r} timed out after 120s; aborting instead "
            "of hanging CI".format(repo)) from None
    if proc.returncode != 0:
        git_stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise ScanError("git log failed for repo {!r} (exit {}): {}".format(
            repo, proc.returncode, git_stderr))
    return proc.stdout.decode("utf-8", errors="replace")


def _unquote_git_path(quoted_body):
    """Decode the body of a git C-quoted path (the text between quotes).

    git escapes '"' and '\\' with a backslash and non-printable/non-ASCII
    bytes as backslash + three octal digits; octal escapes accumulate as
    raw bytes and the result is UTF-8 decoded once (git paths are bytes;
    errors="replace" keeps one weird byte from crashing the audit).
    """
    out = bytearray()
    i = 0
    while i < len(quoted_body):
        ch = quoted_body[i]
        if ch == "\\" and i + 1 < len(quoted_body):
            short = _C_SHORT_ESCAPES.get(quoted_body[i + 1])
            if short is not None:
                out += short
                i += 2
                continue
            octal = quoted_body[i + 1:i + 4]
            if len(octal) == 3 and all(c in "01234567" for c in octal):
                out.append(int(octal, 8))
                i += 4
                continue
        out += ch.encode("utf-8")
        i += 1
    return out.decode("utf-8", errors="replace")


def _path_from_diff_git_line(line):
    """Extract the b/ side path from a `diff --git a/x b/y` line, or None.

    Handles the plain form (the find offset consumes the b/ prefix) and
    git's C-quoted form (`diff --git "a/x" "b/y"` under core.quotePath),
    where the b/ token is unquoted before the prefix is stripped. Checked
    quoted-first: a quoted a/ path could itself contain a ` b/` substring.
    """
    quoted = _DIFF_GIT_QUOTED_RE.match(line)
    if quoted:
        return _strip_ab_prefix(_unquote_git_path(quoted.group(1)))
    marker = line.find(" b/")
    if marker == -1:
        return None
    return line[marker + 3:]


def _strip_ab_prefix(path):
    if path.startswith(("a/", "b/")):
        return path[2:]
    return path


def _excerpt_around(raw_line, match):
    """Window of raw_line around the matched span (~40 chars either side).

    Clamped to the line bounds; ellipses mark trimmed sides. The matched
    span is always fully inside the excerpt, so the evidence always shows
    what fired, however far into the line it sits.
    """
    start = max(0, match.start() - _EXCERPT_RADIUS)
    end = min(len(raw_line), match.end() + _EXCERPT_RADIUS)
    excerpt = raw_line[start:end].strip()
    if start > 0:
        excerpt = "..." + excerpt
    if end < len(raw_line):
        excerpt = excerpt + "..."
    return excerpt


def _scan_line(raw_line, commit, path, findings, seen):
    """Match every pattern against one patch line; append deduped findings.

    Every match on the line is reported (finditer, not just the first),
    each with an excerpt built around its own matched span: distinct
    secrets on one line, or on lines sharing a long prefix, can neither
    hide behind each other nor collapse in the dedupe.
    """
    if commit is None or not raw_line.strip():
        return
    for name, regex in PATTERNS:
        for match in regex.finditer(raw_line):
            excerpt = _excerpt_around(raw_line, match)
            key = (name, commit, path, excerpt)
            if key in seen:
                continue
            seen.add(key)
            findings.append(Finding(name, commit, path, excerpt))


def scan_log_text(text):
    """Pure function: `git log -p` text in -> deduped findings out.

    Walks the log line by line, tracking the current commit (from
    `commit <sha>` headers) and current file (from diff --git / --- / +++
    path lines). Only patch-body lines and path lines are pattern-scanned;
    everything else is git metadata or commit-message text (design
    decision 1). Paths are best-effort: the diff --git line sets the path
    first and the ---/+++ lines, which follow every diff --git line,
    correct it. git does NOT quote spaces -- a space filename arrives
    unquoted with one trailing TAB separator (stripped here) -- and paths
    quoted by core.quotePath (non-ASCII) are C-unescaped back into real
    filenames. A path is trusted only from `--- / +++` lines with a/
    b/ /dev/null prefixes, quoted or not (_AB_PATH_LINE_RE /
    _QUOTED_PATH_LINE_RE), so removed content like `-- sql comments`
    cannot poison the FILE column.

    Tripwire (quality-audit fix, 2026-11-07): patch lines with zero commit
    headers means the text is not in the expected --pretty=medium shape
    (e.g. a format.pretty=oneline config leaked past the command-line pin,
    or a future git change altered the shape). Raise ScanError so the run
    exits 2 instead of reporting a false "clean".
    """
    findings = []
    seen = set()
    commit = None
    path = None
    patch_lines = 0
    commit_headers = 0
    for raw in text.split("\n"):
        line = raw.rstrip("\r")
        commit_match = _COMMIT_RE.match(line)
        if commit_match:
            commit_headers += 1
            commit, path = commit_match.group(1), None
            continue
        if line.startswith("diff --git "):
            patch_lines += 1
            path = _path_from_diff_git_line(line)
            _scan_line(line, commit, path, findings, seen)
            continue
        if _AB_PATH_LINE_RE.match(line):
            patch_lines += 1
            # git does not quote spaces: a space filename arrives unquoted
            # with one trailing TAB separator (`+++ b/my file.sql\t`).
            new_path = _strip_ab_prefix(line[4:]).rstrip("\t")
            if new_path and new_path != "/dev/null":
                path = new_path
            _scan_line(line, commit, path, findings, seen)
            continue
        quoted_match = _QUOTED_PATH_LINE_RE.match(line)
        if quoted_match:
            patch_lines += 1
            new_path = _strip_ab_prefix(
                _unquote_git_path(quoted_match.group(1)))
            if new_path and new_path != "/dev/null":
                path = new_path
            _scan_line(line, commit, path, findings, seen)
            continue
        if line[:1] in ("+", "-"):
            patch_lines += 1
            _scan_line(line, commit, path, findings, seen)
            continue
        # Everything else (Author/Date headers, index/mode lines, hunk @@
        # headers, 4-space-indented commit messages) is git metadata or
        # message text: not committed file content, not scanned.
    if patch_lines and not commit_headers:
        raise ScanError(
            "git log output has {} patch line(s) but no 'commit <sha>' "
            "headers; output shape is not the expected --pretty=medium "
            "(check format.pretty / --pretty config or overrides)".format(
                patch_lines))
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
        findings = scan_log_text(log_text)
    except ScanError as exc:
        # Covers both subprocess failures and the scan_log_text tripwire
        # (patch content without commit headers): never a silent "clean".
        print("ERROR: {}".format(exc), file=sys.stderr)
        print("Exiting 2: the scan did NOT run; this is not a clean result.",
              file=sys.stderr)
        return 2
    for finding in findings:
        print("PATTERN {} | COMMIT {} | FILE {} | {}".format(
            finding.pattern, finding.commit, finding.file, finding.excerpt))
    if findings:
        print("{} finding(s); exiting 1.".format(len(findings)), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
