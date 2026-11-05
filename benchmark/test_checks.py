#!/usr/bin/env python3
"""Calibration rig for benchmark/checks.py (HANDOFF P0 4.2). Standard library only.

  python -I benchmark/test_checks.py

Every test builds a minimal synthetic project, runs the real checks.py spec
function in-process, and pins one criterion's verdict. A change to checks.py
that flips any verdict without a matching, documented reason goes red here.

The file's own contract (checks.py docstring): PASS = conclusive positive
static evidence, FAIL = conclusive negative evidence, ambiguous = MANUAL,
never a guess. Tests marked KNOWN-DEFECT assert that contract against
behavior the code does not have yet; they carry @unittest.expectedFailure
and turn into ordinary green guards when the fix removes the marker.

MUTATION PROBES (a guard is only trusted after breaking it - record date,
the exact mutation, and which test went red). Driver: _probe/mutation_driver.py
outside the repo; it applies each mutation, verifies it applied, runs this
suite, and restores.

Pass 1, 2026-11-05, against pre-fix checks.py (all caught, all green before
any fix, each by exactly the tests listed):
  M1 h1 count ==1 loosened to >=1            -> test_two_h1_fails
  M2 lorem pattern broken                    -> test_lorem_fails (+ later also
                                                test_lorem_under_root_named_build_fails)
  M3 sk- token pattern dropped               -> test_secret_literal_fails +
                                                test_dummy_key_in_test_..._sharp_edge
  M4 test-file regex narrowed                -> test_mjs_tests_counted
  M5 empty-aside MANUAL branch disabled      -> test_html_empty_asides_goes_manual
  M6 best-score key words broken             -> test_best_score_never_autopasses
  M7 KPI revenue sum swapped to units        -> test_kpi_manual_with_computed_sums +
                                                test_formatted_numbers_go_manual
  M8 word cap 40->400 (both deck branches)   -> test_pptx_overlong_slide_fails +
                                                test_html_deck_word_cap_fails
  M9 notes-must-match-slides disabled        -> test_pptx_missing_notes_fails
  M10 24pt floor lowered to 12pt             -> test_pptx_small_text_fails
Constant reds during pass 1 (both were the spec04 UnboundLocalError on a
project with no deck file - FIXED 2026-11-05 by moving the notes scan inside
the html-present branch): test_no_deck_at_all_goes_manual,
test_b10_contract_pptx_and_html_and_empty.

Pass 2, 2026-11-05, against the FIXED file - attacking the guards this audit
added (16/16 caught; never trust a new guard until breaking it goes red):
  M3b sk- pattern dropped (post-fix text)    -> test_secret_literal_fails + dummy-key test
  M11 JS-capable h1 branch disabled          -> test_spa_h1_is_manual_not_fail
  M12 other-language detection disabled      -> test_go_stack_tests_are_manual_not_fail
  M13 committed-.env check disabled          -> test_committed_env_not_ignored_fails
  M14 yaml/yml dropped from SCAN_EXTS        -> test_secret_in_yaml_fails
  M15 below-root-only skip reverted          -> test_lorem_under_root_named_build_fails
  M16 CTA-in-script MANUAL branch disabled   -> test_spa_button_is_manual_not_fail
"""
import contextlib
import importlib.util
import io
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

BENCH = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("checks", BENCH / "checks.py")
checks = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(checks)

LINE = re.compile(r"^(\d\d) (PASS|FAIL|MANUAL) (.*)$")


class FixtureTest(unittest.TestCase):
    def project(self, files, sub=None):
        """Write {relpath: content} into a temp dir (optionally a subdir of it)."""
        tmp = tempfile.mkdtemp(prefix="checks-fixture-")
        self.addCleanup(shutil.rmtree, tmp, True)
        root = Path(tmp) / sub if sub else Path(tmp)
        root.mkdir(parents=True, exist_ok=True)
        for rel, content in files.items():
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, bytes):
                p.write_bytes(content)
            else:
                p.write_text(content, encoding="utf-8")
        return root

    def run_checks(self, spec_id, files, sub=None):
        root = self.project(files, sub)
        checks.COUNTS.clear()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            checks.SPECS[spec_id](root)
        res = {}
        for line in buf.getvalue().splitlines():
            m = LINE.match(line)
            if m:
                res[int(m.group(1))] = (m.group(2), m.group(3).strip())
        return res

    def assertVerdict(self, res, num, status, contains=None):
        self.assertIn(num, res, f"c{num:02d} missing from output: {sorted(res)}")
        got, detail = res[num]
        self.assertEqual(got, status,
                         f"c{num:02d}: expected {status}, got {got} ({detail})")
        if contains:
            self.assertIn(contains, detail)

    def assertTenPrinted(self, res):
        """The one-line-per-criterion contract (audit B10 generalised)."""
        self.assertEqual(sorted(res), list(range(1, 11)),
                         f"expected criteria 1..10, got {sorted(res)}")


# ---------------------------------------------------------------- spec 01

LANDING = {
    "index.html": """<!doctype html>
<html><head><title>FocusDesk - desk booking</title>
<meta name="description" content="Book desks.">
<link rel="icon" href="/favicon.svg"></head>
<body>
<h1>FocusDesk</h1>
<section id="hero">Desk booking for teams.</section>
<section>Benefits of hot desking every day.</section>
<h2>How it works</h2>
<p>FAQ: frequently asked questions live here.</p>
<a href="#demo">Book a free demo</a>
<form action="#demo"><label>name <input name="name"></label>
<label>email <input type="email"></label></form>
<footer>Contact us.</footer>
</body></html>"""
}


class Spec01(FixtureTest):
    def test_pass_fixture(self):
        res = self.run_checks("01", LANDING)
        self.assertTenPrinted(res)
        self.assertVerdict(res, 2, "PASS", "one h1")
        self.assertVerdict(res, 3, "PASS", "all six markers found in order")
        self.assertVerdict(res, 4, "PASS", "name+email inputs found")
        self.assertVerdict(res, 7, "PASS", "no 'lorem ipsum'")
        self.assertVerdict(res, 8, "PASS", "title, meta description and favicon")
        self.assertVerdict(res, 9, "PASS", "no <img> elements")
        for n in (1, 5, 6, 10):
            self.assertVerdict(res, n, "MANUAL")

    def test_two_h1_fails(self):
        res = self.run_checks("01", {"index.html": "<h1>a</h1><h1>b</h1>"})
        self.assertVerdict(res, 2, "FAIL", "2 h1 tags")

    def test_empty_h1_fails(self):
        res = self.run_checks("01", {"index.html": "<h1></h1>"})
        self.assertVerdict(res, 2, "FAIL", "empty h1")

    def test_missing_button_fails(self):
        res = self.run_checks("01", {"index.html": "<h1>x</h1><a href=\"#demo\">go</a>"})
        self.assertVerdict(res, 4, "FAIL", "'Book a free demo' not found")

    def test_missing_anchor_fails(self):
        res = self.run_checks("01", {"index.html": "<h1>x</h1><a>Book a free demo</a>"})
        self.assertVerdict(res, 4, "FAIL", 'no href="#demo" anchor')

    def test_marker_missing_goes_manual(self):
        res = self.run_checks("01", {"index.html": "<h1>x</h1><footer>f</footer>"})
        self.assertVerdict(res, 3, "MANUAL", "markers not found statically")

    def test_marker_order_ambiguity_goes_manual(self):
        # hero text repeats the CTA before the real CTA section: not conclusive
        res = self.run_checks("01", {"index.html": (
            "<h1>Book a free demo today</h1><section>benefits</section>"
            "<p>how it works</p><p>FAQ</p><a href=\"#demo\">Book a free demo</a>"
            "<footer>f</footer>")})
        self.assertVerdict(res, 3, "MANUAL", "out of first-occurrence order")

    def test_lorem_fails(self):
        res = self.run_checks("01", {"index.html": "<p>lorem ipsum dolor</p>"})
        self.assertVerdict(res, 7, "FAIL", "'lorem ipsum' found")

    def test_missing_favicon_fails(self):
        res = self.run_checks("01", {"index.html": "<title>t</title>"
                                     "<meta name=\"description\" content=\"d\">"})
        self.assertVerdict(res, 8, "FAIL", "missing: favicon")

    def test_img_without_alt_fails(self):
        res = self.run_checks("01", {"index.html": "<img src=\"a.png\">"})

        self.assertVerdict(res, 9, "FAIL", "1 missing alt")

    def test_html_in_public_subdir_found(self):
        files = {"public/index.html": LANDING["index.html"]}
        res = self.run_checks("01", files)
        self.assertVerdict(res, 2, "PASS", "public")

    def test_html_comments_are_stripped(self):
        files = {"index.html": LANDING["index.html"].replace(
            "<h1>FocusDesk</h1>", "<!-- <h1>old</h1> -->\n<h1>FocusDesk</h1>")}
        res = self.run_checks("01", files)
        self.assertVerdict(res, 2, "PASS", "one h1")

    def test_node_modules_skipped(self):
        files = dict(LANDING)
        files["node_modules/pkg/app.js"] = "lorem ipsum"
        res = self.run_checks("01", files)
        self.assertVerdict(res, 7, "PASS")

    def test_build_dir_skipped(self):
        files = dict(LANDING)
        files["build/old.js"] = "lorem ipsum"
        res = self.run_checks("01", files)
        self.assertVerdict(res, 7, "PASS", "no 'lorem ipsum'")

    def test_spa_h1_is_manual_not_fail(self):
        # FIXED 2026-11-05: JS-capable pages go MANUAL; static pages still FAIL
        # (see test_static_page_without_h1_fails).
        res = self.run_checks("01", {
            "index.html": '<div id="root"></div><script src="app.js"></script>',
            "app.js": "document.body.innerHTML = '<h1>FocusDesk</h1>';",
        })
        self.assertVerdict(res, 2, "MANUAL")

    def test_static_page_without_h1_fails(self):
        res = self.run_checks("01", {"index.html": "<p>plain static page</p>"})
        self.assertVerdict(res, 2, "FAIL", "0 h1 tags")

    def test_spa_button_is_manual_not_fail(self):
        # FIXED 2026-11-05: CTA text present in script but not markup -> MANUAL
        res = self.run_checks("01", {
            "index.html": '<div id="root"></div><script src="app.js"></script>',
            "app.js": "el.innerHTML = '<a href=\"#demo\">Book a free demo</a>';",
        })
        self.assertVerdict(res, 4, "MANUAL")

    def test_lorem_under_root_named_build_fails(self):
        # FIXED 2026-11-05: iter_files compares dirs below the root only
        res = self.run_checks("01", {
            "index.html": "<h1>x</h1>",
            "app.js": "lorem ipsum",
        }, sub="build")
        self.assertVerdict(res, 7, "FAIL", "'lorem ipsum' found")

    def test_spa_title_missing_fails_documents_sharp_edge(self):
        # OPEN QUESTION for the audit: a JS-set document.title makes this FAIL
        # non-conclusive; pinned here so the decision is visible, not silent.
        res = self.run_checks("01", {"index.html": '<div id="root"></div>'})
        self.assertVerdict(res, 8, "FAIL", "missing: title")


# ---------------------------------------------------------------- spec 02

CRUD = {
    "app.py": "from werkzeug.security import generate_password_hash\n",
    "tests/test_api.py": "def test_signup(): pass\n",
    ".env.example": "DATABASE_URL=\n",
    ".gitignore": ".env\n",
}


class Spec02(FixtureTest):
    def test_pass_fixture(self):
        res = self.run_checks("02", CRUD)
        self.assertTenPrinted(res)
        self.assertVerdict(res, 2, "PASS", "werkzeug.security")
        self.assertVerdict(res, 8, "PASS", "test file(s) found")
        self.assertVerdict(res, 10, "PASS", ".env.example present")
        for n in (1, 3, 4, 5, 6, 7, 9):
            self.assertVerdict(res, n, "MANUAL")

    def test_mjs_tests_counted(self):
        # 2026-10-31 lesson: tests/api.test.mjs was missed without .mjs
        files = dict(CRUD)
        del files["tests/test_api.py"]
        files["tests/api.test.mjs"] = "test('x', () => {})\n"
        res = self.run_checks("02", files)
        self.assertVerdict(res, 8, "PASS")

    def test_no_tests_fails(self):
        files = {"app.py": "x = 1\n", ".env.example": "A=\n"}
        res = self.run_checks("02", files)
        self.assertVerdict(res, 8, "FAIL", "no test files found")

    def test_no_env_example_fails(self):
        res = self.run_checks("02", {"app.py": "x = 1\n"})
        self.assertVerdict(res, 10, "FAIL", ".env.example missing")

    def test_secret_literal_fails(self):
        files = dict(CRUD)
        files["app.py"] = "KEY = 'sk-abcdefghijklmnopqrstuvwx'\n"
        res = self.run_checks("02", files)
        self.assertVerdict(res, 10, "FAIL", "secret-like literal")

    def test_dummy_key_in_test_still_fails_documents_sharp_edge(self):
        # OPEN QUESTION: a placeholder key inside a test trips the same FAIL.
        # Pinned so the bias is visible; the audit decides whether to refine.
        files = dict(CRUD)
        files["tests/test_api.py"] = "KEY = 'sk-test1234567890abcdefghij'\n"
        res = self.run_checks("02", files)
        self.assertVerdict(res, 10, "FAIL", "secret-like literal")

    def test_no_auth_lib_goes_manual(self):
        files = dict(CRUD)
        files["app.py"] = "password = input()\n"
        res = self.run_checks("02", files)
        self.assertVerdict(res, 2, "MANUAL", "no known hash/auth library")

    def test_gitignore_note_appended(self):
        files = dict(CRUD)
        files[".gitignore"] = "node_modules\n"
        res = self.run_checks("02", files)
        self.assertVerdict(res, 10, "PASS", ".env not seen in .gitignore")

    def test_secret_in_yaml_fails(self):
        # FIXED 2026-11-05: SCAN_EXTS covers yaml/sql/json/config file types
        files = dict(CRUD)
        files["config.yaml"] = "aws_access_key_id: AKIAABCDEFGHIJKLMNOP\n"
        res = self.run_checks("02", files)
        self.assertVerdict(res, 10, "FAIL", "secret-like literal")

    def test_committed_env_not_ignored_fails(self):
        # FIXED 2026-11-05: a .env present but not gitignored fails on its own
        files = dict(CRUD)
        files[".env"] = "RESPAN_API_KEY=sk-live-abcdefghijklmnopqrstuvwxyz\n"
        del files[".gitignore"]
        res = self.run_checks("02", files)
        self.assertVerdict(res, 10, "FAIL", ".env file is present")

    def test_env_ignored_still_passes(self):
        files = dict(CRUD)
        files[".env"] = "RESPAN_API_KEY=sk-live-abcdefghijklmnopqrstuvwxyz\n"
        res = self.run_checks("02", files)
        self.assertVerdict(res, 10, "PASS")

    def test_go_stack_tests_are_manual_not_fail(self):
        # FIXED 2026-11-05: other-language files make the absence non-conclusive
        res = self.run_checks("02", {"main.go": "package main\n",
                                     "main_test.go": "package main\n"})
        self.assertVerdict(res, 8, "MANUAL", "other-language file(s)")


# ---------------------------------------------------------------- spec 03

CSV_ROWS = "date,region,product,units,revenue\n2026-01-01,North,Widget,2,10.00\n2026-01-02,South,Gadget,3,5.50\n"


class Spec03(FixtureTest):
    def test_kpi_manual_with_computed_sums(self):
        res = self.run_checks("03", {"data.csv": CSV_ROWS, "index.html": "<p>x</p>"})
        self.assertVerdict(res, 2, "MANUAL", "revenue=15.50, units=5, rev/unit=3.1000")

    def test_bom_csv_goes_manual(self):
        res = self.run_checks("03", {"data.csv": "\ufeff" + CSV_ROWS})
        self.assertVerdict(res, 2, "MANUAL", "lacks expected columns")

    def test_formatted_numbers_go_manual(self):
        res = self.run_checks("03", {"data.csv": "date,region,product,units,revenue\n"
                                                 "2026-01-01,N,W,2,\"1,234.56\"\n"})
        self.assertVerdict(res, 2, "MANUAL", "did not parse cleanly")

    def test_zero_units_goes_manual(self):
        res = self.run_checks("03", {"data.csv": "date,region,product,units,revenue\n"
                                                 "2026-01-01,N,W,0,10.00\n"})
        self.assertVerdict(res, 2, "MANUAL", "did not parse cleanly")

    def test_sample_label_pass(self):
        res = self.run_checks("03", {"index.html": "<p>Sample data: generated</p>"})
        self.assertVerdict(res, 8, "PASS", "Sample data")

    def test_sample_label_in_comment_is_not_visible(self):
        res = self.run_checks("03", {"index.html": "<!-- sample data -->"})
        self.assertVerdict(res, 8, "MANUAL", "no 'sample' in visible page text")

    def test_kpi_test_found(self):
        res = self.run_checks("03", {"app.js": "const total = units.reduce(add);\n"
                                               "assert(total === expectedRevenue);\n"})
        self.assertVerdict(res, 10, "PASS", "KPI-verification code found")

    def test_no_csv_goes_manual(self):
        res = self.run_checks("03", {"index.html": "<p>x</p>"})
        self.assertVerdict(res, 2, "MANUAL", "no CSV found")


# ---------------------------------------------------------------- spec 04

def pptx_bytes(slides=8, words=10, notes=8, sz=2400):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for i in range(1, slides + 1):
            z.writestr(f"ppt/slides/slide{i}.xml",
                       f'<p:sld><p:txBody><a:r><a:rPr sz="{sz}"/>'
                       f'<a:t>{"word " * words}</a:t></a:r></p:txBody></p:sld>')
        for i in range(1, notes + 1):
            z.writestr(f"ppt/notesSlides/notesSlide{i}.xml",
                       "<p:notes><a:t>Note text here.</a:t></p:notes>")
    return buf.getvalue()


def html_deck(sections=8, words=10, aside="<aside>Note {}</aside>", extra=""):
    body = ""
    for i in range(1, sections + 1):
        body += (f'<section class="slide"><h2>Headline {i}</h2>'
                 f"<p>{'word ' * words}</p>{aside.format(i) if aside else ''}</section>")
    return "<html><head><title>t</title></head><body>" + body + extra + "</body></html>"


class Spec04(FixtureTest):
    def test_pptx_pass_fixture(self):
        res = self.run_checks("04", {"deck.pptx": pptx_bytes()})
        self.assertTenPrinted(res)
        self.assertVerdict(res, 1, "PASS", "8 slide(s)")
        self.assertVerdict(res, 3, "PASS", "40 words or fewer")
        self.assertVerdict(res, 4, "PASS", "8 notesSlide(s)")
        self.assertVerdict(res, 6, "PASS", "24pt")
        self.assertVerdict(res, 8, "MANUAL", "zip integrity OK")

    def test_pptx_seven_slides_fails(self):
        res = self.run_checks("04", {"deck.pptx": pptx_bytes(slides=7)})
        self.assertVerdict(res, 1, "FAIL", "7 slide(s)")

    def test_pptx_overlong_slide_fails(self):
        res = self.run_checks("04", {"deck.pptx": pptx_bytes(words=45)})
        self.assertVerdict(res, 3, "FAIL", "45 words")

    def test_pptx_missing_notes_fails(self):
        res = self.run_checks("04", {"deck.pptx": pptx_bytes(notes=7)})
        self.assertVerdict(res, 4, "FAIL", "7 notesSlide(s) for 8 slide(s)")

    def test_pptx_small_text_fails(self):
        res = self.run_checks("04", {"deck.pptx": pptx_bytes(sz=1800)})
        self.assertVerdict(res, 6, "FAIL", "below 24pt")

    def test_pptx_corrupt_goes_manual(self):
        res = self.run_checks("04", {"deck.pptx": b"not a zip archive"})
        self.assertVerdict(res, 1, "MANUAL", "not a readable zip archive")

    def test_html_deck_pass(self):
        res = self.run_checks("04", {"index.html": html_deck()})
        self.assertVerdict(res, 1, "PASS", "8 slide-class elements")
        self.assertVerdict(res, 3, "PASS", "40 words or fewer")
        self.assertVerdict(res, 4, "PASS", "8 speaker-note aside(s)")

    def test_html_deck_word_cap_fails(self):
        res = self.run_checks("04", {"index.html": html_deck(sections=3, words=45)})
        self.assertVerdict(res, 3, "FAIL", "words")

    def test_html_deck_chrome_ambiguous_goes_manual(self):
        # d3d5c14: deck chrome (counters, nav glyphs) follows the last slide
        res = self.run_checks("04", {"index.html": html_deck(extra='<div class="counter">1 / 8</div>')})
        self.assertVerdict(res, 3, "MANUAL", "deck chrome")

    def test_html_js_notes_goes_manual(self):
        # 2026-10-31: baseline deck rendered notes via JS-created asides
        res = self.run_checks("04", {"index.html": html_deck(aside=None)})
        self.assertVerdict(res, 4, "MANUAL", "no static note markers")

    def test_html_empty_asides_goes_manual(self):
        # audit B11: marker presence alone passed decks whose asides were empty
        res = self.run_checks("04", {"index.html": html_deck(aside="<aside></aside>")})
        self.assertVerdict(res, 4, "MANUAL", "only 0 with static text")

    def test_html_nine_sections_goes_manual(self):
        # plain <section> elements (no slide class) exercise the fallback counter
        body = "".join(f"<section><p>{'word ' * 5}</p></section>" for _ in range(9))
        res = self.run_checks("04", {"index.html": f"<html><body>{body}</body></html>"})
        self.assertVerdict(res, 1, "MANUAL", "9 <section> elements")

    def test_html_no_markers_goes_manual(self):
        res = self.run_checks("04", {"index.html": "<div>one</div><div>two</div>"})
        self.assertVerdict(res, 1, "MANUAL", "cannot identify slides statically")
        self.assertVerdict(res, 3, "MANUAL")

    def test_no_deck_at_all_goes_manual(self):
        res = self.run_checks("04", {"notes.txt": "nothing here"})
        self.assertVerdict(res, 1, "MANUAL", "no .pptx or .html found")

    def test_b10_contract_pptx_and_html_and_empty(self):
        for files in ({"deck.pptx": pptx_bytes()}, {"index.html": html_deck()},
                      {"notes.txt": "x"}):
            with self.subTest(files=sorted(files)):
                res = self.run_checks("04", files)
                self.assertTenPrinted(res)


# ---------------------------------------------------------------- spec 05

class Spec05(FixtureTest):
    def test_readme_run_command_pass(self):
        res = self.run_checks("05", {"index.html": "<h1>game</h1>",
                                     "README.md": "# Dodge\n\nnpm start\n"})
        self.assertVerdict(res, 10, "PASS", "run command")

    def test_no_readme_fails(self):
        res = self.run_checks("05", {"index.html": "<h1>game</h1>"})
        self.assertVerdict(res, 10, "FAIL", "no README found")

    def test_readme_without_command_fails(self):
        res = self.run_checks("05", {"index.html": "<h1>game</h1>",
                                     "README.md": "# Dodge\n\nDouble-click the file.\n"})
        self.assertVerdict(res, 10, "FAIL", "no recognizable run command")

    def test_best_score_never_autopasses(self):
        # 2026-10-31: glm baseline had localStorage code yet Best reset on reload
        res = self.run_checks("05", {"game.js": "localStorage.setItem('bestScore', s);\n"
                                                "localStorage.getItem('bestScore');\n"})
        self.assertVerdict(res, 6, "MANUAL", "localStorage key 'bestScore'")

    def test_no_localstorage_goes_manual(self):
        res = self.run_checks("05", {"game.js": "score = 0;\n"})
        self.assertVerdict(res, 6, "MANUAL", "no localStorage best/high-score key")

    def test_difficulty_evidence_goes_manual(self):
        res = self.run_checks("05", {"game.js": "fallSpeed += 0.01;\n"})
        self.assertVerdict(res, 4, "MANUAL", "speed-change code found")

    def test_pass_fixture_prints_all_ten(self):
        res = self.run_checks("05", {"index.html": "<h1>game</h1>",
                                     "game.js": "fallSpeed += 0.01;\n",
                                     "README.md": "npm start\n"})
        self.assertTenPrinted(res)


# ---------------------------------------------------------------- CLI

class Cli(unittest.TestCase):
    def run_cli(self, *argv):
        return subprocess.run(
            [sys.executable, "-I", str(BENCH / "checks.py"), *argv],
            capture_output=True, text=True)

    def test_valid_invocation_exits_0(self):
        tmp = tempfile.mkdtemp(prefix="checks-cli-")
        self.addCleanup(shutil.rmtree, tmp, True)
        Path(tmp, "index.html").write_text(LANDING["index.html"], encoding="utf-8")
        done = self.run_cli("--spec", "01", "--dir", tmp)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("summary:", done.stdout)

    def test_bad_spec_exits_2(self):
        done = self.run_cli("--spec", "09", "--dir", ".")
        self.assertEqual(done.returncode, 2)

    def test_missing_dir_exits_2(self):
        done = self.run_cli("--spec", "01", "--dir", "Z:/definitely/not/here")
        self.assertEqual(done.returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
