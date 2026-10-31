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
import re
import zipfile
from pathlib import Path

SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "build", ".venv", "venv",
             "__pycache__", "one-shot-work", ".cache"}
CODE_EXTS = {".js", ".ts", ".jsx", ".tsx", ".py", ".html", ".htm", ".vue",
             ".svelte", ".css"}


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
        if SKIP_DIRS & set(p.parts):
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
    else:
        why = "empty h1" if len(h1s) == 1 else f"{len(h1s)} h1 tags"
        out(2, "FAIL", f"{why} in {rel}")

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
    has_btn = "Book a free demo" in stripped
    has_anchor = re.search(r"""href\s*=\s*["']#demo["']""", stripped, re.I) is not None
    email_in = re.search(r"""<input\b[^>]*(?:type|name|id|autocomplete)\s*=\s*["']email["']""", stripped, re.I)
    name_in = re.search(r"""<input\b[^>]*(?:name|id)\s*=\s*["']name["']""", stripped, re.I)
    labels = [t.lower() for t in re.findall(r"<label\b[^>]*>(.*?)</label>", stripped, re.I | re.S)]
    if not has_btn:
        out(4, "FAIL", f"exact text 'Book a free demo' not found in {rel}")
    elif not has_anchor:
        out(4, "FAIL", f"no href=\"#demo\" anchor in {rel}")
    elif email_in and name_in:
        out(4, "PASS", "button text, #demo anchor and name+email inputs found")
    elif email_in and any("name" in t and "email" in t for t in labels):
        out(4, "PASS", "button text, #demo anchor, email input and labels naming name+email found")
    else:
        out(4, "MANUAL", "button and anchor present; confirm the #demo form has labeled name and email inputs")

    # 7: no lorem ipsum (static scan of all scanned text files)
    blob = source_text(root)
    if re.search(r"lorem ipsum", blob, re.I):
        out(7, "FAIL", "'lorem ipsum' found in project files")
    else:
        out(7, "PASS", "no 'lorem ipsum' in static scan of project files")

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
    n_files = sum(1 for _ in iter_files(root, CODE_EXTS))

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
        out(8, "FAIL", "no test files found in the project")

    # 10: no secrets committed; .env.example exists
    if not (root / ".env.example").is_file():
        out(10, "FAIL", ".env.example missing at project root")
    else:
        secret_pat = re.search(r"-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}"
                               r"|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}",
                               blob + read(root / ".env.example") + read(root / "README.md"))
        if secret_pat:
            out(10, "FAIL", f"secret-like literal matched pattern '{secret_pat.group(0)[:12]}...'")
        else:
            gitignore = read(root / ".gitignore")
            note = "" if re.search(r"^\.env\b", gitignore, re.M) else "; .env not seen in .gitignore - confirm it is ignored"
            out(10, "PASS", f".env.example present; no obvious secret patterns in {n_files} file(s) scanned{note}")

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
                    if re.search(r"class\s*=\s*["'][^"']*(?:notes|drawer|controls|counter)", seg, re.I):
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
            note_hits = len(re.findall(r"data-notes\s*=|<aside\b", html, re.I))
            if note_hits >= 8:
                out(4, "PASS", f"{note_hits} speaker-note marker(s) found")
            elif note_hits == 0:
                out(4, "FAIL", "no speaker-note markers found (data-notes attributes or aside elements)")
            else:
                out(4, "MANUAL", f"{note_hits} note marker(s) static; confirm notes on all 8 slides")
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


SPECS = {"01": spec01, "02": spec02, "03": spec03, "04": spec04, "05": spec05}


def main():
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
