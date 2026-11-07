#!/usr/bin/env python3
"""Objective checks for the benchmark specs. Standard library only.

  python benchmark/checks.py --spec 01 --dir path/to/built-project

Prints one line per acceptance criterion: PASS, FAIL or MANUAL, with evidence.
  PASS   conclusive positive evidence found by static analysis
  FAIL   conclusive negative evidence found by static analysis
  MANUAL cannot be judged statically; the line says how to judge it by hand
Ambiguous static evidence is MANUAL, never FAIL. Only MANUAL criteria are
scored by hand, and each hand-judged criterion must be footnoted in the
run's notes field. Exit code is always 0; this is a scoring aid.

Static scans skip node_modules, .git and build-output directories, and strip
HTML comments before scanning, so commented-out markup cannot pass or fail
a check. Regexes are evidence helpers, not a grammar: anything they cannot
read becomes MANUAL rather than a wrong verdict.

Exit code is 0 whenever the checks ran. A wrong invocation (missing or
nonexistent --dir, bad --spec) exits 2 via argparse without scoring.
"""
import argparse
import csv
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "build", ".venv", "venv",
             "__pycache__", "one-shot-work", ".cache"}
CODE_EXTS = {".js", ".ts", ".jsx", ".tsx", ".py", ".html", ".htm", ".vue",
             ".svelte", ".css"}
# 2026-11-05 (audit): the secrets scan reads config/data file types too - a
# token pasted into config.yaml or a seed .sql was invisible to CODE_EXTS.
SCAN_EXTS = CODE_EXTS | {".json", ".yaml", ".yml", ".toml", ".sql", ".sh",
                         ".bat", ".ps1", ".ini", ".cfg", ".txt", ".md"}


COUNTS = {}


def out(num, status, detail):
    COUNTS[status] = COUNTS.get(status, 0) + 1
    print(f"{num:02d} {status:6s} {detail}")


def read(path):
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def iter_files(root, exts):
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in exts:
            continue
        # 2026-11-05 (audit): compare against parts below the root only, so a
        # project root that is itself named build/ or dist/ is not skipped whole.
        if SKIP_DIRS & set(p.relative_to(root).parts[:-1]):
            continue
        yield p


def source_text(root):
    parts = []
    for p in iter_files(root, CODE_EXTS):
        text = read(p)
        if p.suffix.lower() in {".html", ".htm"}:
            text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
        parts.append(text)
    return "\n".join(parts)


def find_html(root):
    for name in ("index.html", "public/index.html", "src/index.html"):
        p = root / name
        if p.is_file():
            return p
    hits = list(iter_files(root, {".html", ".htm"}))
    return hits[0] if hits else None


def visible_text(html):
    """Strip comments, script/style bodies and tags; keep visible text."""
    html = re.sub(r"<!--.*?-->", " ", html, flags=re.S)
    html = re.sub(r"<script\b.*?</script>", " ", html, flags=re.I | re.S)
    html = re.sub(r"<style\b.*?</style>", " ", html, flags=re.I | re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


def manual_block(pairs):
    for num, how in pairs:
        out(num, "MANUAL", how)


def spec01(root):
    html_path = find_html(root)
    if not html_path:
        manual_block([
            (1, "open the page in a browser; console must show no errors"),
            (2, "no html file found to count h1 elements"),
            (3, "no html file found; check the six sections in order by eye"),
            (4, "no html file found; check button text and form labels by eye"),
            (5, "no sideways scroll at 360, 768 and 1280 px viewport widths"),
            (6, "run body text through a contrast checker; needs 4.5:1"),
            (7, "no html file found to grep for lorem ipsum"),
            (8, "no html file found to check title/meta/favicon"),
            (9, "no html file found to check image alt text"),
            (10, "tab through links, buttons, inputs; focus ring must be visible"),
        ])
        return
    html = read(html_path)
    stripped = re.sub(r"<!--.*?-->", " ", html, flags=re.S)
    rel = html_path.relative_to(root)

    # 2: exactly one h1, non-empty
    h1s = re.findall(r"<h1\b[^>]*>(.*?)</h1>", stripped, re.I | re.S)
    h1_text = [re.sub(r"<[^>]+>", "", t).strip() for t in h1s]
    if len(h1s) == 1 and h1_text[0]:
        out(2, "PASS", f"one h1 in {rel}: '{h1_text[0][:60]}' (confirm wording states the product)")
    elif h1s:
        why = "empty h1" if len(h1s) == 1 else f"{len(h1s)} h1 tags"
        out(2, "FAIL", f"{why} in {rel}")
    elif re.search(r"<script\b", stripped, re.I) or any(iter_files(root, {".js", ".mjs"})):
        # 2026-11-05 (audit): a JS-capable page can render its h1 at runtime, so a
        # static zero is not conclusive. A static-only page without h1 still FAILs.
        out(2, "MANUAL", "0 h1 tags statically but the page runs script; "
                         "open it and confirm exactly one h1")
    else:
        out(2, "FAIL", f"0 h1 tags in {rel}")

    # 3: six sections in document order (keyword markers, first occurrence)
    markers = [("hero", r"<h1\b"), ("benefits", r"benefit"), ("how-it-works", r"how it works"),
               ("faq", r"\bfaq\b|frequently asked"), ("cta", r"book a free demo|#demo"),
               ("footer", r"<footer\b")]
    positions, missing = [], []
    for label, pat in markers:
        m = re.search(pat, stripped, re.I)
        (positions.append((label, m.start())) if m else missing.append(label))
    if missing:
        out(3, "MANUAL", f"markers not found statically: {', '.join(missing)}; check section order by eye")
    elif [p for _, p in positions] == sorted(p for _, p in positions):
        out(3, "PASS", "all six markers found in order: " + ", ".join(l for l, _ in positions))
    else:
        # first-occurrence text can appear early (hero repeating the CTA); order mismatch is not conclusive
        out(3, "MANUAL", "markers found out of first-occurrence order: "
            + ", ".join(f"{l}@{p}" for l, p in positions) + "; check the six sections by eye")

    # 4: button text, #demo anchor, labeled name+email inputs
    blob = source_text(root)
    has_btn = "Book a free demo" in stripped
    has_anchor = re.search(r"""href\s*=\s*["']#demo["']""", stripped, re.I) is not None
    email_in = re.search(r"""<input\b[^>]*(?:type|name|id|autocomplete)\s*=\s*["']email["']""", stripped, re.I)
    name_in = re.search(r"""<input\b[^>]*(?:name|id)\s*=\s*["']name["']""", stripped, re.I)
    labels = [t.lower() for t in re.findall(r"<label\b[^>]*>(.*?)</label>", stripped, re.I | re.S)]
    if not has_btn:
        # 2026-11-05 (audit): the CTA may be rendered by script; text present in
        # code but not in markup is not a conclusive absence.
        if "book a free demo" in blob.lower():
            out(4, "MANUAL", "CTA text found in script but not in static markup; "
                             "open the page and confirm the button")
        else:
            out(4, "FAIL", f"exact text 'Book a free demo' not found in {rel}")
    elif not has_anchor:
        if re.search(r"""href\s*=\s*["']#demo["']""", blob, re.I):
            out(4, "MANUAL", "#demo anchor found in script but not in static markup; "
                             "confirm the CTA links to the form")
        else:
            out(4, "FAIL", f"no href=\"#demo\" anchor in {rel}")
    elif email_in and name_in:
        out(4, "PASS", "button text, #demo anchor and name+email inputs found")
    elif email_in and any("name" in t and "email" in t for t in labels):
        out(4, "PASS", "button text, #demo anchor, email input and labels naming name+email found")
    else:
        out(4, "MANUAL", "button and anchor present; confirm the #demo form has labeled name and email inputs")

    # 7: no lorem ipsum. 2026-11-06, probed live in the audit battery: the skill arm
    # writes self-check scripts whose comments name the anti-pattern they grep for,
    # so scanning every project file made this check FAIL its own verification -
    # a structural bias against the arm that writes checkers. Conclusive evidence
    # is lorem in the delivered page's visible text; hits elsewhere are MANUAL.
    page_hits = [p for p in iter_files(root, {".html", ".htm"})
                 if re.search(r"lorem ipsum", visible_text(read(p)), re.I)]
    if page_hits:
        out(7, "FAIL", "'lorem ipsum' in page text: " + ", ".join(p.name for p in page_hits))
    else:
        other = [p for p in iter_files(root, SCAN_EXTS)
                 if re.search(r"lorem ipsum", read(p), re.I)]
        if other:
            names = ", ".join(p.name for p in other[:3])
            out(7, "MANUAL", f"page text is clean, but 'lorem ipsum' appears in non-page "
                             f"file(s) ({names}) - usually a checker naming the anti-pattern; "
                             "confirm the copy itself contains none")
        else:
            out(7, "PASS", "no 'lorem ipsum' in the page's visible text or project files")

    # 8: title, meta description, favicon
    title_ok = re.search(r"<title>[^<]+</title>", stripped, re.I) is not None
    desc_ok = re.search(r"""<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']+["']""",
                        stripped, re.I) is not None
    fav_ok = (re.search(r"""<link\b[^>]*rel\s*=\s*["'][^"']*icon[^"']*["']""", stripped, re.I) is not None
              or any((root / n).is_file() for n in ("favicon.ico", "favicon.svg",
                                                    "public/favicon.ico", "public/favicon.svg")))
    if title_ok and desc_ok and fav_ok:
        out(8, "PASS", "title, meta description and favicon all present")
    else:
        missing = [n for n, ok in (("title", title_ok), ("meta description", desc_ok),
                                   ("favicon", fav_ok)) if not ok]
        out(8, "FAIL", "missing: " + ", ".join(missing))

    # 9: images have alt, or no images
    imgs = re.findall(r"<img\b[^>]*>", stripped, re.I)
    if not imgs:
        out(9, "PASS", "no <img> elements found")
    else:
        bad = sum(1 for t in imgs if not re.search(r"""\balt\s*=\s*["'][^"']*["']""", t, re.I))
        out(9, "FAIL" if bad else "PASS", f"{len(imgs)} img element(s), {bad} missing alt")

    manual_block([
        (1, "open the page in a browser; console must show no errors"),
        (5, "no sideways scroll at 360, 768 and 1280 px viewport widths"),
        (6, "run body text through a contrast checker; needs 4.5:1"),
        (10, "tab through links, buttons, inputs; focus ring must be visible"),
    ])


def spec02(root):
    blob = source_text(root)

    # 2: hashed passwords (auth/hashing library referenced, else inspect the DB)
    m = re.search(r"better-auth|next-auth|lucia|passport|bcrypt|argon2|scrypt|pbkdf2"
                  r"|werkzeug\.security|django\.contrib\.auth", blob, re.I)
    if m:
        out(2, "PASS", f"password handling references '{m.group(0)}' (confirm no plaintext path remains)")
    else:
        out(2, "MANUAL", "no known hash/auth library referenced in source; inspect the DB directly, "
                         "e.g. sqlite3 <dbfile> \"select password from users limit 3\" - expect $2b$/$argon2/scrypt prefixes")

    # 8: tests exist (.mjs/.cjs included — 2026-10-31: tests/api.test.mjs was missed without them)
    tests = [p for p in iter_files(root, {".py", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx"})
             if re.search(r"(?:^|/)test_|_test\.|\.test\.|\.spec\.|(?:^|/)tests?/",
                          "/".join(p.parts).lower())]
    if tests:
        out(8, "PASS", f"{len(tests)} test file(s) found (run the README's documented command to confirm they pass)")
    else:
        # 2026-11-05 (audit): other stacks name tests differently (_test.go, PHP
        # spec/...). Their absence from the JS/Python scan is not conclusive.
        others = list(iter_files(root, {".go", ".rb", ".java", ".php", ".cs", ".rs",
                                        ".kt", ".swift", ".c", ".cpp"}))
        if others:
            out(8, "MANUAL", f"no tests in scanned JS/Python types, but {len(others)} "
                             f"other-language file(s) such as {others[0].name}; check "
                             "that stack's own test naming and run them")
        else:
            out(8, "FAIL", "no test files found in the project")

    # 10: no secrets committed; .env.example exists
    if not (root / ".env.example").is_file():
        out(10, "FAIL", ".env.example missing at project root")
    else:
        # 2026-11-05 (audit): scan config/data/doc file types (SCAN_EXTS), more token
        # shapes, and a committed .env itself. A .env present but not gitignored is a
        # FAIL on its own - it will be committed whatever its content looks like.
        scanned = list(iter_files(root, SCAN_EXTS))
        blob10 = "\n".join(read(p) for p in scanned) + read(root / ".env") \
            + read(root / ".env.example") + read(root / "README.md")
        env_ignored = re.search(r"^\.env\b", read(root / ".gitignore"), re.M) is not None
        env_committed = (root / ".env").is_file() and not env_ignored
        secret_pat = re.search(r"-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}"
                               r"|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}"
                               r"|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_\-]{35}"
                               r"|xox[baprs]-[A-Za-z0-9-]{10,}",
                               blob10)
        if env_committed:
            out(10, "FAIL", "a .env file is present but .gitignore does not ignore .env - "
                            "it would be committed; remove it or ignore it")
        elif secret_pat:
            out(10, "FAIL", f"secret-like literal matched pattern '{secret_pat.group(0)[:12]}...'")
        else:
            note = "" if env_ignored else "; .env not seen in .gitignore - confirm it is ignored"
            out(10, "PASS", f".env.example present; no obvious secret patterns in "
                            f"{len(scanned)} file(s) scanned (denylist scan - absence of "
                            f"a pattern is evidence, not proof){note}")

    manual_block([
        (1, "sign up a new user, log out, log back in, log out - record each result"),
        (3, "logged in: create a note, edit it, delete it - record each result"),
        (4, "create 11 notes: page 1 must show 10, next/previous must work"),
        (5, "as user A, request user B's note id (URL or API) - expect 403/404, never 200"),
        (6, "start the app, then: curl -s -o /dev/null -w '%{http_code}' http://localhost:PORT/api/notes - expect 401"),
        (7, "submit an empty title and an over-long body - expect a 4xx with a clear message"),
        (9, "clone to a fresh directory and follow README setup verbatim"),
    ])


def spec03(root):
    # 2: expected KPI values computed independently from the CSV
    csvs = [p for p in iter_files(root, {".csv"})]
    if csvs:
        try:
            rows = list(csv.DictReader(read(csvs[0]).splitlines()))
            # DictReader stores extra fields under a None restkey; skip non-string keys
            cols = {c.lower().strip() for c in rows[0] if isinstance(c, str)} if rows else set()
            if {"date", "region", "product", "units", "revenue"} <= cols:
                rev = sum(float(r["revenue"]) for r in rows)
                units = sum(float(r["units"]) for r in rows)
                out(2, "MANUAL", f"expected KPIs from {csvs[0].name} ({len(rows)} rows): "
                                 f"revenue={rev:.2f}, units={units:.0f}, rev/unit={rev / units:.4f} - compare with the cards")
            else:
                out(2, "MANUAL", f"{csvs[0].name} lacks expected columns; sum revenue/units independently")
        except (ValueError, KeyError, TypeError, AttributeError, ZeroDivisionError, csv.Error):
            out(2, "MANUAL", f"{csvs[0].name} did not parse cleanly; sum revenue/units independently")
    else:
        out(2, "MANUAL", "no CSV found; locate the sample data and compute the sums independently")

    # 8: sample data labeled on the page (visible text of HTML only, so code comments cannot pass it)
    sample_hit = None
    for p in iter_files(root, {".html", ".htm"}):
        m = re.search(r".{0,40}sample.{0,40}", visible_text(read(p)), re.I)
        if m:
            sample_hit = m
            break
    if sample_hit:
        out(8, "PASS", f"visible text contains '{sample_hit.group(0).strip()[:70]}'")
    else:
        out(8, "MANUAL", "no 'sample' in visible page text; confirm the page labels the data as sample")

    # 10: a test or script verifies the KPI math
    hit = re.search(r"^[^\n]*((?:revenue|units|kpi)[^\n]*(?:assert|expect|sum|total)"
                    r"|(?:assert|expect)[^\n]*(?:revenue|units|kpi))[^\n]*",
                    source_text(root), re.I | re.M)
    if hit:
        out(10, "PASS", f"KPI-verification code found: '{hit.group(0).strip()[:70]}' (run it to confirm it passes)")
    else:
        out(10, "MANUAL", "no static match for KPI-verification code; look for a test computing the sums")

    manual_block([
        (1, "open the dashboard in a browser; console must show no errors"),
        (3, "both charts render with labeled axes and a title"),
        (4, "change the region filter; every chart, KPI and the table must update"),
        (5, "set a date range with no data; a clear empty-state message must show"),
        (6, "sort the table both directions on each column"),
        (7, "no sideways page scroll at 360 and 1280 px"),
        (9, "chart colors distinguishable; text at least 4.5:1 contrast"),
    ])


def pptx_word_count(slide_xml):
    return len(" ".join(re.findall(r"<a:t>([^<]*)</a:t>", slide_xml)).split())


def spec04(root):
    pptx = next(iter_files(root, {".pptx"}), None)
    if pptx:
        try:
            z = zipfile.ZipFile(pptx)
        except zipfile.BadZipFile:
            manual_block([
                (1, f"{pptx.name} is not a readable zip archive; try opening it"),
                (3, "unreadable archive; check slide count by opening the file"),
                (4, "unreadable archive; check speaker notes by opening the file"),
                (6, "unreadable archive; check text size in PowerPoint"),
                (8, "unreadable archive; expect repair prompts when opened"),
                (10, "unreadable archive; will not open cleanly"),
            ])
        else:
            names = z.namelist()
            slides = sorted(n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n))
            notes = sorted(n for n in names if re.match(r"ppt/notesSlides/notesSlide\d+\.xml$", n))

            out(1, "PASS" if len(slides) == 8 else "FAIL", f"{pptx.name}: {len(slides)} slide(s) in the archive")
            if not slides:
                out(3, "MANUAL", "no slides found in the archive")
                out(4, "MANUAL", "no slides found in the archive")
            else:
                over = []
                for n in slides:
                    words = pptx_word_count(z.read(n).decode("utf-8", "replace"))
                    if words > 40:
                        over.append(f"slide{n}: {words} words")
                if over:
                    out(3, "FAIL", "; ".join(over))
                else:
                    out(3, "PASS", f"all {len(slides)} slide(s) at 40 words or fewer (speaker notes excluded)")
                if len(notes) == len(slides) and all(
                        re.search(r"<a:t>[^<]", z.read(n).decode("utf-8", "replace")) for n in notes):
                    out(4, "PASS", f"{len(notes)} notesSlide(s), all with text")
                else:
                    out(4, "FAIL", f"{len(notes)} notesSlide(s) for {len(slides)} slide(s), or empty notes")
            sizes = []
            for n in slides:
                xml = z.read(n).decode("utf-8", "replace")
                for run in re.findall(r"<a:r>.*?</a:r>", xml, re.S):
                    if re.search(r"<a:t>[^<]", run):
                        sz = re.search(r'sz="(\d+)"', run)
                        if sz:
                            sizes.append(int(sz.group(1)))
            if sizes and min(sizes) < 2400:
                out(6, "FAIL", f"smallest explicit text size is {min(sizes) / 100:.0f}pt, below 24pt")
            elif sizes:
                out(6, "PASS", f"smallest explicit text size is {min(sizes) / 100:.0f}pt (theme-inherited sizes not counted)")
            else:
                out(6, "MANUAL", "no explicit run sizes in the deck; theme defaults apply - confirm text is 24pt equivalent")
            clean = z.testzip() is None
            out(8, "MANUAL", f"zip integrity {'OK' if clean else 'CORRUPT'}; open in PowerPoint and confirm no repair prompt")
            out(10, "MANUAL", "open the deck; no repair prompts or console errors")
    else:
        html_path = find_html(root)
        if not html_path:
            manual_block([
                (1, "no .pptx or .html found; locate the deck and count the slides"),
                (3, "check every slide is at most 40 words, excluding notes"),
                (4, "check speaker notes exist on all 8 slides"),
                (6, "confirm text is 24pt equivalent with 4.5:1 contrast"),
                (8, "check arrow-key navigation or PowerPoint opens without errors"),
                (10, "open the file; no repair prompts or console errors"),
            ])
        else:
            html = re.sub(r"<!--.*?-->", " ", read(html_path), flags=re.S)
            markers = [m.start() for m in re.finditer(
                r"""<[a-z]+[^>]*class\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>""", html, re.I)]
            via = "slide-class elements"
            if not markers:
                markers = [m.start() for m in re.finditer(r"<section\b", html, re.I)]
                via = "<section> elements"
            if not markers:
                out(1, "MANUAL", "cannot identify slides statically; count them in the browser")
                out(3, "MANUAL", "cannot identify slides statically; check every slide is at most 40 words")
            elif len(markers) == 8:
                out(1, "PASS", f"8 {via} found in {html_path.name}")
            else:
                # JS-templated decks build slides at runtime; a static count is not ground truth
                out(1, "MANUAL", f"{len(markers)} {via} statically in a JS-capable page; count slides in the browser")
            if markers:
                bounds = markers + [len(html)]
                over = []
                ambiguous = False
                for i, (a, b) in enumerate(zip(bounds, bounds[1:]), 1):
                    seg = re.sub(r"<aside\b.*?</aside>", " ", html[a:b], flags=re.I | re.S)
                    seg = re.sub(r"<style\b.*?</style>", " ", seg, flags=re.I | re.S)
                    seg = re.sub(r"<script\b.*?</script>", " ", seg, flags=re.I | re.S)
                    # strip deck chrome that follows the last slide: counters, nav glyphs, drawer labels
                    seg = re.sub(r"\b\d+\s*/\s*\d+\b", " ", seg)
                    seg = re.sub(r"[\u2039\u203a\u2190\u2192]", " ", seg)
                    seg = re.sub(r"speaker notes", " ", seg, flags=re.I)
                    if re.search(r"""class\s*=\s*["'][^"']*(?:notes|drawer|controls|counter)""", seg, re.I):
                        ambiguous = True
                    words = len(visible_text(seg).split())
                    if words > 40:
                        over.append(f"slide{i}: {words} words")
                if ambiguous and not over:
                    out(3, "MANUAL", "deck chrome follows the last slide; static count ambiguous — judge slide word counts by eye")
                elif over:
                    out(3, "FAIL", "; ".join(over))
                else:
                    out(3, "PASS", f"all {len(markers)} slide segment(s) at 40 words or fewer (chrome and notes excluded)")
            # 2026-11-05 (audit): the notes scan and the 6/8/10 block below used to sit
            # outside this html-present branch and crashed with UnboundLocalError when a
            # project had neither .pptx nor HTML (html unbound). Moved inside; the
            # no-deck branch already prints 6/8/10 in its own manual_block above.
            note_hits = len(re.findall(r"data-notes\s*=|<aside\b", html, re.I))
            # 2026-11-01 (audit B11): marker presence alone passed decks whose asides were
            # empty until JS filled them; count non-empty asides instead, fail open to MANUAL.
            non_empty = sum(1 for a in re.findall(r"<aside\b[^>]*>(.*?)</aside>", html, re.I | re.S)
                            if visible_text(a).strip())
            if non_empty >= 8:
                out(4, "PASS", f"{non_empty} speaker-note aside(s) with visible text")
            elif note_hits >= 8:
                out(4, "MANUAL", f"{note_hits} note marker(s) but only {non_empty} with static text; "
                                 "open the deck, toggle notes (N key or control), verify notes with content on all 8 slides")
            elif note_hits == 0:
                # 2026-10-31: a baseline deck rendered notes via JS-created asides — static absence
                # is not conclusive; the notes UI must be checked live
                out(4, "MANUAL", "no static note markers; open the deck, toggle notes (N key or control), "
                                 "verify notes with content on all 8 slides")
            else:
                out(4, "MANUAL", f"{note_hits} note marker(s) static; confirm notes on all 8 slides")
            # 2026-11-01 (audit B10): criteria 6/8/10 were printed only when 1-7 note markers
            # existed; the promised one-line-per-criterion contract broke on the other branches
            # (verified live: all four 04-run outputs lacked c6/c8/c10). Always print them.
            manual_block([
                (6, "confirm text is 24pt equivalent with 4.5:1 contrast"),
                (8, "check arrow-key navigation works"),
                (10, "open the file; no repair prompts or console errors"),
            ])

    manual_block([
        (2, "read each headline; takeaway, not a topic label"),
        (5, "fonts, colors and layout consistent across slides"),
        (7, "no invented statistics presented as fact"),
        (9, "closing slide has one clear action"),
    ])


def spec05(root):
    src = source_text(root)

    # 6: best score persists — code presence only; the verdict requires a reload test
    # (2026-10-31: glm baseline game had localStorage code yet Best reset on reload —
    #  the grep is a proxy and cannot see whether the key is read back. Never auto-PASS.)
    m = re.search(r"""localStorage\.(?:get|set)Item\(\s*["'`]([^"'`]+)["'`]""", src, re.I)
    if m and re.search(r"best|high|top", m.group(1), re.I):
        out(6, "MANUAL", f"localStorage key '{m.group(1)}' found in code — play, reload, confirm the best score survives")
    else:
        out(6, "MANUAL", "no localStorage best/high-score key found statically; play, reload, check the best score")

    # 4: difficulty increases - evidence only, visibility is judged by hand
    m = re.search(r"^[^\n]*(?:fallSpeed|spawnInterval|difficulty|speed\s*\+=)[^\n]*", src, re.I | re.M)
    if m:
        out(4, "MANUAL", f"speed-change code found: '{m.group(0).strip()[:70]}' - confirm difficulty visibly increases")
    else:
        out(4, "MANUAL", "no speed-increase code found statically; play 60s and judge whether difficulty rises")

    # 10: README explains how to run it in one command
    readme = next((p for p in iter_files(root, {".md"}) if p.name.lower() == "readme.md"), None)
    if not readme:
        out(10, "FAIL", "no README found")
    else:
        text = read(readme)
        cmd = re.search(r"(?:npm (?:start|run \S+)|npx \S+|python \S+|open \S+|serve|http-server|start \S+\.html)", text)
        if cmd:
            out(10, "PASS", f"README present with run command ('{cmd.group(0)[:30]}...')")
        else:
            out(10, "FAIL", "README present but no recognizable run command in it")

    manual_block([
        (1, "open the game; console clean; it starts on the start screen"),
        (2, "arrow keys and A/D move; touch works at phone width"),
        (3, "hit a block on purpose; the game must end"),
        (5, "score visible during play and on the game over screen"),
        (7, "restart from game over without reloading the page"),
        (8, "play 60 seconds; watch for stutter"),
        (9, "switch tabs mid-run, come back; game state must survive"),
    ])


# ------------------------------------------------------- spec 06/07 helpers
# Single-file browser apps (calculator, pomodoro) share criterion 1: the whole
# app must be one html file with inline CSS/JS, no external references and no
# network or dynamic-import calls.

ATTR_REF = re.compile(
    r"""[\s](?:srcset|src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""", re.I)
NET_CALL = re.compile(r"\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|\bimport\s*\(|@import\b")
DYNAMIC_EXEC = re.compile(
    r"eval\s*\(|\bFunction\s*\(|setTimeout\s*\(\s*[\"'`]|setInterval\s*\(\s*[\"'`]")
BENIGN_SCHEMES = ("mailto:", "tel:")
# 2026-11-07 (wave-2 review): JS comment spans, for classifying denylist hits.
# A hit inside a comment cannot fail a criterion - the skill arm writes
# self-checkers whose comments name the anti-pattern they grep for (the
# spec01 c7 lesson, 2026-11-06). Hits in code stay conclusive. A "//" inside
# a string literal (e.g. "https://...") can create a false span; that only
# ever downgrades a FAIL to MANUAL, never upgrades a PASS.
JS_COMMENT = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)
PY_COMMENT = re.compile(r"#[^\n]*")


def comment_pattern(suffix):
    return PY_COMMENT if suffix == ".py" else JS_COMMENT


def strip_comments(text, suffix):
    return comment_pattern(suffix).sub(" ", text)


def external_refs(html):
    """Attribute values that reference a file or an absolute URL. #-fragments,
    data: URIs and mailto:/tel: links are not external references - a mailto
    link is neither a stylesheet, a script, a CDN link nor an import."""
    hits = []
    for m in ATTR_REF.finditer(html):
        val = next((g for g in m.groups() if g is not None), "")
        if m.group(0).lstrip().lower().startswith("srcset"):
            tokens = [t.strip().split(" ")[0] for t in val.split(",") if t.strip()]
        else:
            tokens = [val.strip()]
        for tok in tokens:
            low = tok.lower()
            if not tok or low.startswith(("#", "data:")):
                continue
            scheme = re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*:", tok)
            if scheme:
                if scheme.group(0).lower() not in BENIGN_SCHEMES:
                    hits.append(tok)
            else:
                hits.append(tok)   # relative file reference
    return hits


def single_file_c1(root):
    """Criterion 1 for specs 06/07: exactly one html file, no external
    references, no network or dynamic-import calls. Prints the criterion-1
    line unless the project has no html at all (the caller then prints the
    all-manual block including line 1). Returns the html path or None.

    2026-11-07 (wave-2 review): HTML comments are stripped before scanning
    (the module docstring's contract - commented-out markup cannot fail a
    check), data:-URI @imports are exempt, and hits that live only inside
    JS comments are MANUAL, never FAIL."""
    htmls = list(iter_files(root, {".html", ".htm"}))
    if not htmls:
        return None
    if len(htmls) > 1:
        names = ", ".join(p.name for p in htmls[:4])
        out(1, "FAIL", f"{len(htmls)} html files found ({names}) - "
                       "the app must be one index.html")
        return htmls[0]
    text = re.sub(r"<!--.*?-->", " ", read(htmls[0]), flags=re.S)
    # a data:-URI @import imports content, not a file or host - exempt it
    text = re.sub(r"@import\s+(?:url\s*\(\s*)?[\"']?data:[^\"')\n]*", " ", text, flags=re.I)
    code_text = strip_comments(text, ".html")
    name = htmls[0].name
    refs = external_refs(code_text)
    if refs:
        out(1, "FAIL", f"external reference(s) in {name}: " + ", ".join(refs[:3]))
        return htmls[0]
    net = NET_CALL.search(code_text)
    if net:
        line = re.search(r"^[^\n]*" + re.escape(net.group(0)) + r"[^\n]*", code_text, re.M)
        out(1, "FAIL", f"network or dynamic-import call in {name}: "
                       f"'{(line.group(0) if line else net.group(0)).strip()[:70]}'")
        return htmls[0]
    if external_refs(text) or NET_CALL.search(text):
        out(1, "MANUAL", f"external reference or network call appears only inside a "
                         f"comment in {name} - confirm nothing real remains")
        return htmls[0]
    out(1, "PASS", f"one {name}, no external references (denylist scan)")
    return htmls[0]


def spec06(root):
    html_path = single_file_c1(root)
    if html_path is None:
        manual_block([
            (1, "no html file found - the app must be one index.html with all CSS and JS inline"),
            (2, "no html file found to scan for dynamic code execution"),
            (3, "type 2 + 3 × 4 then = - display must show 14, not 20 (operator precedence)"),
            (4, "type 0.1 + 0.2 = - display must show exactly 0.3; no 0.30000000000000004 "
                "in any displayed result"),
            (5, "type 5 ÷ 0 = - expect a clear error state (e.g. 'Cannot divide by zero') "
                "and C must recover; not Infinity, not frozen"),
            (6, "type 200 + 10 % = - expect 220; then 50 % = alone - expect 0.5"),
            (7, "C resets expression, result and error state; ⌫ removes exactly one character; "
                "± flips the sign of the current number"),
            (8, "history tape shows at least the last 3 completed calculations and updates "
                "after each press of ="),
            (9, "at 360px width: no horizontal scroll, all buttons visible and tappable, Tab "
                "order in reading order with a visible focus indicator"),
            (10, "run a normal sequence (type an expression, =, C, ⌫) with the console open - "
                 "it must stay free of errors"),
        ])
        return
    # 2026-11-07 (wave-2 review): the denylist catches bare Function( calls as
    # well as new Function(, and hits are classified by comment spans - a hit
    # in real code is conclusive FAIL, a hit only inside a comment (often a
    # self-checker naming the anti-pattern) is MANUAL. Priority: a code hit in
    # the app html beats everything; then a comment-only hit in the app html;
    # then a hit in a non-app file (usually a self-checker).
    verdict = None
    for p in iter_files(root, {".html", ".htm"}):
        text = re.sub(r"<!--.*?-->", " ", read(p), flags=re.S)
        code_text = strip_comments(text, p.suffix.lower())
        m = DYNAMIC_EXEC.search(code_text)
        if m:
            line = re.search(r"^[^\n]*" + re.escape(m.group(0)) + r"[^\n]*",
                             code_text, re.M)
            verdict = ("FAIL", f"dynamic code execution in {p.name}: "
                       f"'{(line.group(0) if line else m.group(0)).strip()[:70]}'")
            break
        if DYNAMIC_EXEC.search(text) and verdict is None:
            verdict = ("MANUAL", f"dynamic-exec pattern appears only inside a comment "
                       f"in {p.name} - confirm no real dynamic execution")
    if verdict is None or verdict[0] == "MANUAL":
        for p in iter_files(root, CODE_EXTS - {".html", ".htm"}):
            if DYNAMIC_EXEC.search(strip_comments(read(p), p.suffix.lower())):
                verdict = ("MANUAL", f"dynamic-exec pattern in non-app file {p.name} - "
                           "confirm the calculator's html contains none")
                break
    if verdict is None:
        verdict = ("PASS", "no eval / Function( / string-argument setTimeout or setInterval "
                   "in code (denylist scan - absence of a pattern is evidence, not proof)")
    out(2, verdict[0], verdict[1])
    manual_block([
        (3, "type 2 + 3 × 4 then = - display must show 14, not 20 (operator precedence)"),
        (4, "type 0.1 + 0.2 = - display must show exactly 0.3; no 0.30000000000000004 "
            "in any displayed result"),
        (5, "type 5 ÷ 0 = - expect a clear error state (e.g. 'Cannot divide by zero') "
            "and C must recover; not Infinity, not frozen"),
        (6, "type 200 + 10 % = - expect 220; then 50 % = alone - expect 0.5"),
        (7, "C resets expression, result and error state; ⌫ removes exactly one character; "
            "± flips the sign of the current number"),
        (8, "history tape shows at least the last 3 completed calculations and updates "
            "after each press of ="),
        (9, "at 360px width: no horizontal scroll, all buttons visible and tappable, Tab "
            "order in reading order with a visible focus indicator"),
        (10, "run a normal sequence (type an expression, =, C, ⌫) with the console open - "
             "it must stay free of errors"),
    ])


def spec07(root):
    html_path = single_file_c1(root)
    if html_path is None:
        manual_block([
            (1, "no html file found - the app must be one index.html with inline CSS and JS"),
            (2, "no html file found; fresh load, click Start - 25:00 must count down visibly "
                "every second"),
            (3, "no html file found; a finished work session starts a 5:00 short break, and "
                "after the 4th completed work session a 15:00 long break; cycle position "
                "visible (e.g. 'Work 2 of 4')"),
            (4, "no html file found; auto-start ON starts the next phase alone with the "
                "correct duration; OFF waits for Start"),
            (5, "no html file found; the tab title must show the remaining time and stay "
                "honest against the wall clock"),
            (6, "no html file found; reload mid-session - phase, remaining seconds (+/-5 s), "
                "completed count and auto-start must all restore"),
            (7, "no html file found; Space toggles Start/Pause; Pause 30 s leaves the time "
                "frozen; Reset returns to 25:00 with count 0"),
            (8, "no html file found; Skip advances to the next phase now with its correct "
                "duration, and a skipped work session does not count as completed"),
            (9, "no html file found; a full work -> break -> work transition must keep the "
                "console clean and the phase labeled"),
            (10, "no html file found; verify the timer against the wall clock (hide the tab "
                 "2 minutes, return, ~2 minutes must be gone)"),
        ])
        return
    # quote the strongest evidence first: a wall-clock API call, else a
    # deadline-shaped variable name. A grep can never prove the mechanism.
    # 2026-11-07 (wave-2 review): prefer a quote from real code - a hit that
    # lives only inside a comment is noted as such instead of being quoted as
    # the mechanism.
    code_m = word_m = comment_m = None
    for p in iter_files(root, CODE_EXTS):
        text = read(p)
        if p.suffix.lower() in {".html", ".htm"}:
            text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
        code_text = strip_comments(text, p.suffix.lower())
        code_m = code_m or re.search(r"^[^\n]*(?:\bDate\.now\(|\bperformance\.now\("
                                     r"|\bnew Date\([^)]*\)\.getTime\()[^\n]*",
                                     code_text, re.I | re.M)
        word_m = word_m or re.search(r"^[^\n]*(?:deadline|endTime|endsAt|targetTime)[^\n]*",
                                     code_text, re.I | re.M)
        if code_m is None and word_m is None and comment_m is None:
            comment_m = re.search(r"^[^\n]*(?:\bDate\.now\(|deadline|endTime)[^\n]*",
                                  text, re.I | re.M)
    if code_m or word_m:
        quote = (code_m or word_m).group(0).strip()[:70]
        out(10, "MANUAL", f"wall-clock pattern found: '{quote}' - confirm against the wall "
                          "clock: hide the tab 2 minutes, return, ~2 minutes must be gone")
    elif comment_m:
        out(10, "MANUAL", "the only wall-clock-shaped match is inside a comment - the timer "
                          "may count interval ticks; verify against the wall clock (hide "
                          "the tab 2 minutes, return, ~2 minutes must be gone)")
    else:
        out(10, "MANUAL", "no wall-clock deadline pattern found statically - timer may count "
                          "interval ticks; verify against the wall clock (hide the tab "
                          "2 minutes, return, ~2 minutes must be gone)")
    manual_block([
        (2, "fresh load, click Start - 25:00 must count down visibly every second"),
        (3, "a finished work session starts a 5:00 short break, and after the 4th completed "
            "work session a 15:00 long break; cycle position visible (e.g. 'Work 2 of 4')"),
        (4, "auto-start ON starts the next phase alone with the correct duration; OFF waits "
            "for Start"),
        (5, "while running, switch tabs: the tab title shows the remaining time; leave for "
            "2 minutes and return - roughly 2 minutes less, not stopped or reset"),
        (6, "reload mid-session - phase, remaining seconds (+/-5 s of drift), completed "
            "count and auto-start must all restore"),
        (7, "Space toggles Start/Pause; pause for 30 s - the remaining time must not change; "
            "Reset returns to a fresh 25:00 work session with count 0"),
        (8, "Skip advances to the next phase immediately with its correct duration, and a "
            "skipped work session does not count as completed"),
        (9, "run a full work -> break -> work transition with the console open - no errors, "
            "and the phase is always labeled (Work / Short break / Long break)"),
    ])


# ------------------------------------------------------------------ spec 08

TEST_FILE_PAT = re.compile(r"(?:^|/)test_|_test\.|\.test\.|\.spec\.|(?:^|/)tests?/", re.I)
SECRET_PAT = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}"
                        r"|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}"
                        r"|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_\-]{35}"
                        r"|xox[baprs]-[A-Za-z0-9-]{10,}")


def spec08(root):
    all_src = [p for p in iter_files(root, {".py", ".js", ".mjs", ".cjs", ".ts"})
               if not TEST_FILE_PAT.search("/".join(p.parts).lower())]
    tests = [p for p in iter_files(root, {".py", ".js", ".mjs", ".cjs", ".ts"})
             if TEST_FILE_PAT.search("/".join(p.parts).lower())]
    readme = next((p for p in iter_files(root, {".md"})
                   if p.name.lower() == "readme.md"), None)
    test_cmd = run_cmd = None
    if readme:
        text = read(readme)
        # 2026-11-07 (wave-2 review): python3? covers python3 invocations, and
        # node's built-in runner (node --test) counts as a test command - the
        # natural choice for the zero-framework Node app spec 08 invites.
        test_cmd = re.search(r"\bnpm test\b|\bnpx\s+\S+|\bpytest\b|\bnode\s+--test\b"
                             r"|\bpython3?\s+-m\s+pytest\b|\bpython3?\s+-m\s+unittest\b", text)
        run_cmd = re.search(r"\bnpm start\b|\buvicorn\b|\bflask run\b"
                            r"|\bpython3?\s+(?!-m)\S+|\bnode\s+(?!--test)\S+", text)
    if not readme:
        c1 = ("FAIL", "README.md missing at project root")
    elif not test_cmd:
        c1 = ("FAIL", "README.md present but names no test command (looked for: npm test, "
                      "npx <runner>, pytest, python -m pytest, python -m unittest)")
    elif not run_cmd:
        c1 = ("FAIL", "README.md present but names no run command (looked for: npm start, "
                      "node server.js, uvicorn, flask run, python <script>)")
    elif not all_src:
        c1 = ("MANUAL", "README commands found, but no server source (.py/.js beyond tests) "
                        "found statically - confirm the layout by eye")
    elif not tests:
        c1 = ("MANUAL", "README commands and server source found, but no test files found "
                        "statically - confirm by eye; the README command decides")
    else:
        c1 = ("PASS", f"README names test command '{test_cmd.group(0)}' and run command "
                      f"'{run_cmd.group(0)}'; {len(all_src)} server source file(s), "
                      f"{len(tests)} test file(s)")

    count = 0
    for p in tests:
        t = read(p)
        if p.suffix == ".py":
            count += len(re.findall(r"^\s*def\s+test_", t, re.M))
        else:
            count += len(re.findall(r"\btest\s*\(|\bit\s*\(", t))
    if count < 8:
        c5 = ("FAIL", f"only {count} test function(s) found; spec requires at least 8")
    else:
        c5 = ("MANUAL", f"{count} test function(s) in {len(tests)} file(s) - run the README "
                        "command offline and paste the green output")

    # 2026-11-07 (wave-2 review): criterion 6 judges the SERVER SOURCE, so the
    # secret scan covers server source + config files - not .md/.txt (a README
    # example naming a token shape is documentation, not a committed key).
    # Hits are classified by comment spans: a hit in real code is FAIL, a hit
    # only inside a comment is MANUAL (spec02's scan keeps its own broader,
    # already-pinned scope - the two criteria differ, so their scans do too).
    scanned = list(iter_files(root, CODE_EXTS | {".json", ".yaml", ".yml",
                                                 ".ini", ".cfg"}))
    secret = secret_hit = comment_secret = None
    for p in scanned + [root / ".env"]:
        text = read(p)
        code_text = strip_comments(text, p.suffix.lower())
        m = SECRET_PAT.search(code_text)
        if m:
            secret_hit = (p.name, m.group(0))
            break
        if secret_hit is None and comment_secret is None and SECRET_PAT.search(text):
            comment_secret = p.name
    url_hit = None
    if secret_hit is None:
        for p in all_src:
            for m in re.finditer(r"https?://[^\s\"'<>\\)]+", read(p)):
                host = m.group(0).split("://", 1)[1].split("/")[0].split(":")[0].lower()
                if not (host == "localhost" or host == "0.0.0.0" or host == "::1"
                        or host.startswith("127.")):
                    url_hit = m.group(0)
                    break
            if url_hit:
                break
    if secret_hit:
        c6 = ("FAIL", f"secret-like literal in {secret_hit[0]}: "
                      f"'{secret_hit[1][:12]}...'")
    elif comment_secret:
        c6 = ("MANUAL", f"secret-like pattern appears only inside a comment in "
                        f"{comment_secret} - confirm it is documentation, not a key")
    elif url_hit:
        c6 = ("MANUAL", f"URL literal found: '{url_hit[:70]}' - confirm it is not an "
                        "external call")
    else:
        c6 = ("PASS", f"no secret patterns in {len(scanned)} server-source/config file(s) "
                      f"and no external host URLs in server source (denylist scan - "
                      f"absence of a pattern is evidence, not proof)")

    store = re.search(r"^[^\n]*(?:sqlite|json|writeFile|\bopen\(|shutil|\bdump\b)[^\n]*",
                      "\n".join(read(p) for p in all_src), re.I | re.M)
    if store:
        c8 = ("MANUAL", f"storage code: '{store.group(0).strip()[:70]}' - stop the server, "
                        "restart, confirm the data survived")
    else:
        c8 = ("MANUAL", "no file-storage code found statically - memory-only suspicion; "
                        "the restart test decides")

    lines = [(1, c1[0], c1[1]), (5, c5[0], c5[1]), (6, c6[0], c6[1]), (8, c8[0], c8[1])]
    lines += [(n, "MANUAL", how) for n, how in [
        (2, "start the server, then every invalid class must return HTTP 400 with a JSON body "
            "naming the field and the reason, never a 500: "
            "curl -i -X POST localhost:PORT/expenses -H 'content-type: application/json' "
            "-d '{\"payer\":\"A\",\"amount\":-5,\"currency\":\"USD\",\"date\":\"2026-01-01\"}' "
            "(negative amount); same with \"currency\":\"GBP\" (unknown currency); same with "
            "\"payer\":\"\" (empty payer); -d '{oops' (malformed JSON)"),
        (3, "add 'A paid 100 USD' and 'B paid 100 EUR', then GET /balances - each person must "
            "show separate USD and EUR figures; a merged 200 fails"),
        (4, "with A paid 90, B paid 30, C paid 0 in one currency (equal three-way split), "
            "POST /settle must return exactly B pays A 10 and C pays A 40 (A receives 50), "
            "amounts at 2 decimals"),
        (7, "frontend: an expense added from the form must appear in the list without a page "
            "reload; the page must be usable at 360px with no horizontal scrolling"),
        (9, "add -> list -> balances -> settle with the console open - no unhandled errors, "
            "and no exception traceback is ever sent to the client (check an invalid POST's "
            "response body)"),
        (10, "balances and settle amounts must show exact 2-decimal values - no "
             "0.30000000000000004 in any balance or transfer"),
    ]]
    for num, st, det in sorted(lines):
        out(num, st, det)


# ------------------------------------------------------------------ spec 09
# The --dir is the run's copy of benchmark-v3/starters/09-notes-app. The
# starter ships a sha256 manifest of every file; the whitelist names the files
# the agent is allowed to change (the fixes, the tests, the notes).

BROWNFIELD_WHITELIST = {"server.js", "tests/notes.test.js", "NOTES.md"}
PRISTINE_STARTER = (Path(__file__).resolve().parent.parent / "benchmark-v3"
                    / "starters" / "09-notes-app")


def _brownfield_c2(root):
    """Byte-identity of the run's copy against the starter's sha manifest."""
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        return "FAIL", "manifest.json is gone - the starter's tamper guard cannot run"
    pristine = PRISTINE_STARTER / "manifest.json"
    anchored = False
    if pristine.is_file():
        try:
            differ = manifest_path.read_bytes() != pristine.read_bytes()
        except OSError:
            differ = None   # unreadable pristine = unanchored, never a guess
        if differ:
            return "FAIL", "manifest.json was edited - the tamper guard itself"
        anchored = differ is not None
    try:
        entries = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        return "FAIL", f"manifest.json does not parse: {e}"
    if not isinstance(entries, dict):
        return "FAIL", "manifest.json is not a JSON object"
    problems = []
    for rel in sorted(entries):
        p = root / rel
        if rel in BROWNFIELD_WHITELIST:
            if not p.is_file():
                problems.append(f"whitelisted file missing: {rel}")
            continue
        if not p.is_file():
            problems.append(f"manifest-listed file missing: {rel}")
            continue
        actual = hashlib.sha256(p.read_bytes()).hexdigest()
        if actual != entries[rel]:
            problems.append(f"{rel} sha mismatch: manifest {str(entries[rel])[:12]}... "
                            f"!= disk {actual[:12]}...")
    listed = set(entries)
    unlisted = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        parts = p.relative_to(root).parts
        if SKIP_DIRS & set(parts[:-1]):
            continue
        rel = p.relative_to(root).as_posix()
        # 2026-11-07 (wave-2 review): only the ROOT data.json is runtime state;
        # a nested same-named file is just an unlisted file.
        if rel not in listed and rel not in BROWNFIELD_WHITELIST \
                and rel != "manifest.json" and rel != "data.json":
            unlisted.append(rel)
    if unlisted:
        more = f" (+{len(unlisted) - 5} more)" if len(unlisted) > 5 else ""
        problems.append("unlisted file(s) present: " + ", ".join(sorted(unlisted)[:5]) + more)
    if problems:
        return "FAIL", "; ".join(problems[:3])
    if not anchored:
        return "MANUAL", "every manifest-listed file matches its recorded hash, but the " \
                         "pristine starter manifest was not reachable to anchor the manifest " \
                         "itself - compare against the starter by eye"
    return "PASS", f"{len(entries)}/{len(entries)} manifest files byte-identical " \
                   "(whitelist: server.js, tests/notes.test.js, NOTES.md)"


def _brownfield_c6(root):
    tf = root / "tests" / "notes.test.js"
    if not tf.is_file():
        return "FAIL", "tests/notes.test.js missing - the suite cannot be judged"
    # test.only( counts as a test definition (the file's own defect if it never
    # runs is the hand-judge's call at >=15; the count must stay factual)
    n = len(re.findall(r"\btest(?:\.only)?\s*\(", read(tf)))
    if n < 15:
        return "FAIL", f"test file has {n} test() call(s); 12 original + at least 3 " \
                       "regression = at least 15"
    return "MANUAL", f"{n} test() calls counted (12 original + >=3 new) - confirm each new " \
                     "test was revert-verified (revert only that bug's fix, watch it fail, " \
                     "restore) and all pass"


def _brownfield_c7(root):
    """package.json byte-identity, judged against the PRISTINE manifest when it
    is reachable. 2026-11-07 (wave-2 review): an unreachable pristine manifest
    is MANUAL - falling back to the run's own manifest let an edited manifest
    authenticate its own edit (self-auth PASS, probed live)."""
    pkg = root / "package.json"
    if not pkg.is_file():
        return "FAIL", "package.json missing - the zero-new-dependencies rule cannot hold"
    recorded = None
    pristine = PRISTINE_STARTER / "manifest.json"
    if pristine.is_file():
        try:
            recorded = json.loads(pristine.read_text(encoding="utf-8")).get("package.json")
        except (json.JSONDecodeError, OSError, AttributeError):
            recorded = None
    if recorded is None:
        return "MANUAL", "no trusted manifest records package.json - compare it against " \
                         "the starter by eye"
    actual = hashlib.sha256(pkg.read_bytes()).hexdigest()
    if actual != recorded:
        return "FAIL", f"package.json was modified (sha {actual[:12]}... != recorded " \
                       f"{recorded[:12]}...) - zero new dependencies required"
    return "PASS", "package.json byte-identical to the starter (sha256 match)"


def _brownfield_c8(root):
    notes = root / "NOTES.md"
    if not notes.is_file():
        return "FAIL", "NOTES.md missing - the spec requires it"
    text = read(notes)
    missing = [f"Bug {b}" for b in "ABC"
               if not re.search(r"\bbug\s*" + b + r"\b", text, re.I)]
    if not missing:
        return "MANUAL", "sections for Bug A/B/C found - confirm each documents all four " \
                         "parts: file, observed wrong behavior, root cause, fix"
    return "MANUAL", "no section found for " + ", ".join(missing) + \
                     " - all three bugs must be documented"


def spec09(root):
    c2 = _brownfield_c2(root)
    c6 = _brownfield_c6(root)
    c7 = _brownfield_c7(root)
    c8 = _brownfield_c8(root)
    out(1, "MANUAL", "all 12 original tests still passing - judge from the suite output "
                     "saved in the run folder")
    out(2, c2[0], c2[1])
    out(3, "MANUAL", "Bug A (dates): create a note with createdAt before 10:00 local "
                     "(e.g. 2026-11-07T03:30:00.000Z on a UTC+5:30 machine) - it must group "
                     "under its own calendar day, not the previous one")
    out(4, "MANUAL", "Bug B (search): search q=todo must find 'Shopping ToDo list' "
                     "(case-insensitive, partial match)")
    out(5, "MANUAL", "Bug C (delete): delete one note, then delete a different one - the "
                     "second delete must remove exactly the requested id (seeded bug: a "
                     "notes[id] index lookup 404s or removes the wrong note)")
    out(6, c6[0], c6[1])
    out(7, c7[0], c7[1])
    out(8, c8[0], c8[1])
    out(9, "MANUAL", "server and test runs free of unhandled errors apart from the 3 bugs' "
                     "expected misbehavior during reproduction - judge from your session")
    out(10, "MANUAL", "full suite (12 original + new) green in one run - judge from the "
                      "suite output saved in the run folder")


# ------------------------------------------------------------------ spec 10
# The golden scorer: the spec's embedded CSV is mirrored byte-exactly at
# benchmark/specs/fixtures/10-expenses.csv, and the golden answers below were
# recomputed independently in test_checks.py (test_golden_recomputed_
# independently) so a wrong constant here goes red.

SPEC10_KEYS = {"totals_by_currency", "rows_by_currency", "skipped_duplicates",
               "invalid_rows", "date_range"}
SPEC10_GOLDEN_TOTALS = {"USD": 2300.49, "EUR": 3734.56, "INR": 65500.75}
SPEC10_GOLDEN_ROWS = {"USD": 3, "EUR": 2, "INR": 3}
SPEC10_GOLDEN_SKIPPED = {5: "E001", 13: "E010"}
SPEC10_GOLDEN_INVALID = {9, 10, 11, 14, 15}
SPEC10_GOLDEN_RANGE = ("2026-01-05", "2026-01-20")
SPEC10_CSV_DIFFERS = ("expenses.csv differs from the spec fixture - the golden answers "
                      "apply only to the exact fixture; judge from your saved evidence")
SPEC10_NO_CSV = ("no expenses.csv found in the run folder - the golden answers apply "
                 "only to the exact fixture; judge from your saved evidence")


def _crlf_norm(data):
    """Byte comparison tolerant of CRLF checkout translation (core.autocrlf
    translates text files at clone; the fixture path is not -text in
    .gitattributes). The golden answers are identical either way."""
    return data.replace(b"\r\n", b"\n")


def _stdlib_names():
    """Top-level stdlib module names. sys.stdlib_module_names is 3.10+; on 3.9
    derive the set from the interpreter's own library directory (site-packages
    excluded - third-party installs live there) plus compiled-in and .pyd
    extension modules. The derived set can only be a superset of 3.9's stdlib,
    which under-FAILs rather than false-FAILs a stdlib import."""
    names = getattr(sys, "stdlib_module_names", None)
    if names:
        return frozenset(names)
    import os
    import sysconfig
    found = set(sys.builtin_module_names)
    lib = sysconfig.get_path("stdlib")
    if lib:
        for entry in os.listdir(lib):
            if entry.endswith((".py", ".pyi")):
                found.add(entry.rsplit(".", 1)[0])
            elif os.path.isdir(os.path.join(lib, entry)) and \
                    entry.lower() not in ("site-packages", "dist-packages", "__pycache__"):
                found.add(entry)
    dlls = os.path.join(os.path.dirname(sys.executable), "DLLs")
    if os.path.isdir(dlls):
        for entry in os.listdir(dlls):
            if entry.endswith(".pyd"):
                found.add(entry.split(".")[0])
    return frozenset(found)


def _spec10_locate(root, name, exts):
    exact = root / name
    if exact.is_file():
        return exact
    return next((p for p in iter_files(root, exts) if p.name == name), None)


def _py_import_names(src):
    """Top-level module names from import statements. 2026-11-07 (wave-2
    review): multi-imports yield every comma-separated name (import csv,
    requests used to pass with only csv seen), 'as' aliases are stripped, and
    a match that survives only inside a triple-quoted string or a # comment is
    not an import (a docstring mentioning one must not false-FAIL)."""
    names = []
    in_str = None
    for line in src.splitlines():
        if in_str:
            end = line.find(in_str)
            if end == -1:
                continue
            line = line[end + 3:]
            in_str = None
        for q in ('"""', "'''"):
            while q in line:
                start = line.find(q)
                end = line.find(q, start + 3)
                if end == -1:
                    in_str = q
                    line = line[:start]
                    break
                line = line[:start] + " " + line[end + 3:]
        line = PY_COMMENT.sub("", line)
        m = re.match(r"\s*import\s+(.+)$", line)
        if m:
            for part in m.group(1).split(","):
                name = re.match(r"\s*([A-Za-z_][\w.]*)", part)
                if name:
                    names.append(name.group(1))
            continue
        m = re.match(r"\s*from\s+([A-Za-z_][\w.]*)", line)
        if m:
            names.append(m.group(1))
    return names


def _spec10_c3(report):
    got = report.get("totals_by_currency")
    if not isinstance(got, dict):
        return False, ("FAIL", f"totals_by_currency is {type(got).__name__}, "
                               "expected an object")
    if set(got) != set(SPEC10_GOLDEN_TOTALS):
        return False, ("FAIL", f"totals_by_currency keys {sorted(map(str, got))} != "
                               f"{sorted(SPEC10_GOLDEN_TOTALS)}")
    for cur in sorted(SPEC10_GOLDEN_TOTALS):
        want = SPEC10_GOLDEN_TOTALS[cur]
        try:
            have = float(got[cur])
        except (TypeError, ValueError):
            return False, ("FAIL", f"{cur} total missing or not a number (golden {want})")
        # 2026-11-07 (wave-2 review): 1e-6 absorbs float noise but a total not
        # rounded to 2 decimals (a spec requirement) no longer rides the
        # tolerance (0.005 admitted 2300.485 as 2300.49).
        if abs(have - want) > 1e-6:
            return False, ("FAIL", f"{cur} total {have} != golden {want}")
    return True, ("PASS", "USD 2300.49, EUR 3734.56, INR 65500.75 match the golden")


def _spec10_c4(report):
    got = report.get("skipped_duplicates")
    if not isinstance(got, list):
        return "FAIL", "skipped_duplicates is not a list"
    rows = {}
    for e in got:
        try:
            rows[int(e["row"])] = str(e.get("id", ""))
        except (KeyError, TypeError, ValueError):
            return "FAIL", f"skipped_duplicates entry malformed: {str(e)[:60]}"
    # 2026-11-07 (wave-2 review): duplicate row entries must not collapse
    if len(rows) != len(got):
        return "FAIL", f"skipped_duplicates lists {len(got)} entries for {len(rows)} " \
                       "row(s) - duplicate row numbers"
    if rows == SPEC10_GOLDEN_SKIPPED:
        return "PASS", "rows 5 (E001), 13 (E010)"
    return "FAIL", f"skipped rows {sorted(rows.items())} != golden " \
                   f"{sorted(SPEC10_GOLDEN_SKIPPED.items())}"


def _spec10_c5(report):
    got = report.get("invalid_rows")
    if not isinstance(got, list):
        return "FAIL", "invalid_rows is not a list"
    rows, bare = [], []
    for e in got:
        try:
            n = int(e["row"])
        except (KeyError, TypeError, ValueError):
            return "FAIL", f"invalid_rows entry malformed: {str(e)[:60]}"
        rows.append(n)
        if not str(e.get("reason", "") or "").strip():
            bare.append(n)
    if set(rows) != SPEC10_GOLDEN_INVALID:
        return "FAIL", f"invalid rows {sorted(set(rows))} != golden " \
                       f"{sorted(SPEC10_GOLDEN_INVALID)}"
    # 2026-11-07 (wave-2 review): duplicate row entries must not collapse
    if len(rows) != len(set(rows)):
        return "FAIL", f"invalid_rows lists {len(rows)} entries for " \
                       f"{len(set(rows))} row(s) - duplicate row numbers"
    if bare:
        return "MANUAL", f"row {bare[0]} listed with no reason text - confirm the reason " \
                         "is specific"
    return "PASS", "rows 9, 10, 11, 14, 15 all listed with reasons"


def _spec10_c6(report):
    dr = report.get("date_range")
    if isinstance(dr, dict) and dr.get("min") == SPEC10_GOLDEN_RANGE[0] \
            and dr.get("max") == SPEC10_GOLDEN_RANGE[1]:
        return "PASS", "min 2026-01-05, max 2026-01-20 (DD/MM and month-name forms " \
                       "parsed correctly)"
    got = f"min {dr.get('min')}, max {dr.get('max')}" if isinstance(dr, dict) else str(dr)[:60]
    return "FAIL", f"date_range {got} != golden min 2026-01-05, max 2026-01-20"


def _spec10_c8(report):
    keys = set(report)
    if keys == SPEC10_KEYS:
        return "PASS", "exactly the five specified keys"
    bits = []
    extra, missing = keys - SPEC10_KEYS, SPEC10_KEYS - keys
    if extra:
        bits.append("extra: " + ", ".join(sorted(extra)))
    if missing:
        bits.append("missing: " + ", ".join(sorted(missing)))
    return "FAIL", "; ".join(bits)


def _spec10_c9(report):
    got = report.get("rows_by_currency")
    if got == SPEC10_GOLDEN_ROWS:
        return "PASS", "USD 3, EUR 2, INR 3 (sums verified through totals)"
    return "FAIL", f"rows_by_currency {got} != golden USD 3, EUR 2, INR 3"


def spec10(root):
    pys = list(iter_files(root, {".py"}))
    tp = next((p for p in pys if p.name == "transform.py"), None)
    if tp is None:
        c1 = ("FAIL", "no transform.py found")
    elif len(pys) > 1:
        c1 = ("FAIL", "more than one .py file: " + ", ".join(p.name for p in pys[:4]))
    else:
        src = read(tp)
        stdlib = _stdlib_names()
        bad = []
        for name in _py_import_names(src):
            top = name.split(".")[0]
            if top != tp.stem and top not in stdlib:
                bad.append(top)
        if bad:
            c1 = ("FAIL", "non-stdlib import: " + ", ".join(sorted(set(bad))))
        elif re.search(r"__import__\s*\(|\bimportlib\.", src):
            c1 = ("MANUAL", "dynamic import pattern found (__import__ or importlib) - "
                            "confirm all imports are stdlib by eye")
        else:
            c1 = ("PASS", "single transform.py, all imports stdlib (denylist scan)")
    c2 = ("MANUAL", "run `python transform.py expenses.csv report.json` (expect exit 0 + "
                    "report written) and `python transform.py missing.csv out.json` "
                    "(expect exit 2 + stderr naming the file); save both outputs in the "
                    "run folder")
    c10 = ("MANUAL", "read transform.py - explicit rules for decimal-comma, symbol "
                     "mapping, date formats, impossible dates, rather than one fragile "
                     "regex; judge readability")
    report_p = _spec10_locate(root, "report.json", {".json"})
    csv_p = _spec10_locate(root, "expenses.csv", {".csv"})
    if report_p is None:
        lines = [(1, c1[0], c1[1]), (2, c2[0], c2[1]), (10, c10[0], c10[1])]
        lines += [(n, "MANUAL", "no report.json found in the run folder - run the tool and "
                                "save report.json here") for n in range(3, 10)]
        for num, st, det in sorted(lines):
            out(num, st, det)
        return
    try:
        report = json.loads(read(report_p))
    except (json.JSONDecodeError, ValueError) as e:
        lines = [(1, c1[0], c1[1]), (2, c2[0], c2[1]), (10, c10[0], c10[1])]
        lines += [(n, "MANUAL", f"report.json does not parse as JSON: {e}")
                  for n in range(3, 10)]
        for num, st, det in sorted(lines):
            out(num, st, det)
        return
    if not isinstance(report, dict):
        lines = [(1, c1[0], c1[1]), (2, c2[0], c2[1]), (10, c10[0], c10[1])]
        lines += [(n, "MANUAL", "report.json is not a JSON object - judge from your saved "
                                "evidence") for n in range(3, 10)]
        for num, st, det in sorted(lines):
            out(num, st, det)
        return
    fixture = Path(__file__).resolve().parent / "specs" / "fixtures" / "10-expenses.csv"
    if csv_p is None:
        mid = [(n, "MANUAL", SPEC10_NO_CSV) for n in range(3, 10)]
    elif not fixture.is_file() or \
            _crlf_norm(csv_p.read_bytes()) != _crlf_norm(fixture.read_bytes()):
        mid = [(n, "MANUAL", SPEC10_CSV_DIFFERS) for n in range(3, 10)]
    else:
        # the CSV is the exact spec fixture and the report parses: golden compare
        totals_ok, c3 = _spec10_c3(report)
        c7 = (("PASS", "totals match the golden - $1,200.50/₹45,000/1.234,56 €/2.500,00 € "
                       "all parsed; verified through the sums") if totals_ok else
              ("MANUAL", "totals do not match the golden - judge which amount format "
                         "misparsed from your evidence"))
        mid = [(3, c3[0], c3[1]), (4, *_spec10_c4(report)), (5, *_spec10_c5(report)),
               (6, *_spec10_c6(report)), (7, c7[0], c7[1]), (8, *_spec10_c8(report)),
               (9, *_spec10_c9(report))]
    lines = [(1, c1[0], c1[1]), (2, c2[0], c2[1]), (10, c10[0], c10[1])] + mid
    for num, st, det in sorted(lines):
        out(num, st, det)


SPECS = {"01": spec01, "02": spec02, "03": spec03, "04": spec04, "05": spec05,
         "06": spec06, "07": spec07, "08": spec08, "09": spec09, "10": spec10}


def main():
    # 2026-11-07 (v3 smoke): the spec 06/10 criterion text contains characters
    # the Windows console codec (cp1252) cannot encode - printing used to crash
    # mid-run with UnicodeEncodeError, breaking the exit-0 and the one-line-per-
    # criterion contracts (spec 06 printed 6 of 10 lines live). Backslashreplace
    # keeps the console encoding but can no longer raise; UTF-8 consoles are
    # unaffected.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="backslashreplace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--spec", required=True, choices=sorted(SPECS))
    ap.add_argument("--dir", required=True, type=Path, help="root of the built project for this run")
    args = ap.parse_args()
    if not args.dir.is_dir():
        ap.error(f"--dir does not exist or is not a directory: {args.dir}")
    SPECS[args.spec](args.dir.resolve())
    print(f"summary: {COUNTS.get('PASS', 0)} pass, {COUNTS.get('FAIL', 0)} fail, "
          f"{COUNTS.get('MANUAL', 0)} manual - FAIL lines are conclusive; MANUAL lines are judged by hand")


if __name__ == "__main__":
    main()
