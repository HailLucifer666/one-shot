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

Pass 3, 2026-11-07, against the wave-2 scorers (specs 06-10) - one decisive
check per scorer, all five caught, all five green again after revert (driver:
probe script in the system temp dir, outside the repo; it verified each
mutation applied and restored checks.py byte-exact):
  M06 new Function pattern broken            -> Spec06.test_new_function_fails
  M07 Date.now token dropped from the        -> Spec07.test_clean_timer_quotes_wall_clock_line
     spec07 wall-clock scan
  M08 sk- token dropped from spec08's        -> Spec08.test_secret_key_fails
     secret pattern
  M09 spec09 sha comparison forced True      -> Spec09.test_tampered_page_fails
  M10 spec10 golden USD total 2300.49->2300.50 -> Spec10.test_golden_report_all_pass
     (test_golden_recomputed_independently stayed green through M10 by design:
     it pins the golden from literals, not from checks.py's constants.)
Also caught by the CLI smoke, not a mutation: the spec 06/10 criterion text
contains U+232B/U+20B9 which cp1252 cannot encode - the CLI crashed mid-run
(6 of 10 lines, exit 1). main() now reconfigures stdout to backslashreplace;
pinned deterministically by Cli.test_non_ascii_output_never_crashes_the_cli.

Pass 4, 2026-11-07, attacking the wave-2 review-fix guards themselves (9 runs,
all caught, all green after revert; same temp-dir driver, byte-exact restore):
  W1 comment classification disabled         -> Spec06.test_dynamic_exec_only_in_comment_goes_manual
     (strip_comments returns text unchanged)  + Spec08.test_comment_only_secret_goes_manual
  W2 bare-Function pattern reverted to       -> Spec06.test_bare_function_call_fails
     new\s+Function only
  W3 @import dropped from NET_CALL           -> Spec06.test_css_import_fails
  W4 multi-import parsed first-name-only     -> Spec10.test_multi_import_caught
  W5 c7 self-auth fallback to the run's      -> Spec09.test_pristine_unreachable_c7_manual
     own manifest restored (the exact hole
     the reviewer probed live)
  W6 golden tolerance back to 0.005          -> Spec10.test_unrounded_total_fails
  W7 python3? reverted to python? in the     -> Spec08.test_python3_readme_passes
     spec08 README run-command regex
  W8 data.json exempted by NAME at any       -> Spec09.test_nested_data_json_fails_unlisted
     depth instead of root-only

Pass 5, 2026-11-07, attacking the wave-2 RE-REVIEW fix guards (N1-N6) - all
caught, all green after revert, checks.py byte-restored each time:
  V1 data:-URI @import strip tail widened    -> Spec06.test_bare_data_import_cannot_eat_a_real_reference
     back past a raw space
  V2 semicolon-chained statement split       -> Spec10.test_semicolon_chained_import_caught
     removed (import csv; import requests)
  V3 earliest-quote-by-position reverted     -> Spec10.test_mixed_quote_string_import_caught
     to fixed for-order
  V4 loopback allowance back to 127. prefix  -> Spec08.test_loopback_prefix_hostname_is_a_hit
  V5 #-comment formats dropped from          -> Spec08.test_config_comment_secret_goes_manual
     comment_pattern (config secret FAILs)
  V6 c6 counter back on raw text             -> Spec09.test_commented_out_tests_not_counted
     (commented-out test() lines inflate)
Probe-harness note for the next editor: unittest writes OK/FAILED to stderr,
not stdout - a red-detector that reads only stdout reports every mutation
"NOT RED" (this cost one wasted probe run on 2026-11-07 before the fix).

Pass 6, 2026-11-07, attacking the SCORE-READY-round hardening (X1/X4, the
reviewer's non-blocking follow-ups, closed before the final gate):
  X1 single-line string mask disabled        -> Spec10.test_semicolon_inside_string_is_not_a_statement
     (no-op assignment; "; import x" in a       + Spec10.test_hash_inside_string_does_not_eat_a_real_import
     string manufactured a fake statement)
  X4 comment-secret fallback moved back      -> Spec08.test_html_comment_secret_goes_manual
     onto the HTML-comment-stripped text
     (a token in an HTML comment vanished
     to a silent PASS)
Probe-quality note: the first X1 mutation replaced the mask with a constant
string, which destroyed EVERY line equally - no test could distinguish it
("NOT RED" run recorded here so the shape is not repeated). A mutation must
change only the guarded behavior; the second attempt was a true no-op.
"""
import contextlib
import csv
import datetime
import importlib.util
import io
import json
import os
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
        self.assertVerdict(res, 7, "FAIL", "in page text")

    def test_lorem_in_comment_only_is_manual(self):
        # commented-out placeholder text is not visible content: not conclusive
        res = self.run_checks("01", {"index.html": "<!-- lorem ipsum -->"})
        self.assertVerdict(res, 7, "MANUAL", "non-page file(s)")

    def test_lorem_only_in_a_checker_script_is_manual(self):
        # 2026-11-06 battery probe: the skill arm's self-check scripts name the
        # anti-pattern they grep for; that must not FAIL the page
        res = self.run_checks("01", {"index.html": "<p>Fresh office copy.</p>",
                                     "scripts/check.js": "// AC 7: no lorem ipsum\n"})
        self.assertVerdict(res, 7, "MANUAL", "check.js")

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

    def test_lorem_under_root_named_build_is_seen(self):
        # FIXED 2026-11-05: iter_files compares dirs below the root only. The lorem
        # sits in a script, so the page is clean and the verdict is MANUAL with the
        # location named - but a whole-root skip would print a vacuous PASS instead.
        res = self.run_checks("01", {
            "index.html": "<h1>x</h1>",
            "app.js": "lorem ipsum",
        }, sub="build")
        self.assertVerdict(res, 7, "MANUAL", "app.js")

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


# ---------------------------------------------------------------- spec 06

CALC_HTML = """<!doctype html>
<html>
<head><meta charset="utf-8"><title>LedgerCalc</title>
<style>button { min-width: 48px; }</style>
</head>
<body>
<div id="display">0</div>
<div id="history"></div>
<button data-key="7">7</button><button data-key="+">+</button>
<button data-key="=">=</button><button data-key="C">C</button>
<button id="back">&#9003;</button><button id="sign">&plusmn;</button>
<script>
"use strict";
let expr = "";
function press(k) { expr += k; render(); }
function equals() { display.textContent = evaluate(expr); }
function evaluate(e) { return parseTokens(e); }
function parseTokens(e) { return 0; }
document.addEventListener("keydown", (ev) => { if (ev.key === "Enter") equals(); });
</script>
</body>
</html>
"""


class Spec06(FixtureTest):
    def test_clean_app_pass_and_manual_evidence(self):
        res = self.run_checks("06", {"index.html": CALC_HTML})
        self.assertTenPrinted(res)
        self.assertVerdict(res, 1, "PASS", "no external references (denylist scan)")
        self.assertVerdict(res, 2, "PASS", "denylist scan")
        self.assertVerdict(res, 3, "MANUAL", "show 14, not 20")
        self.assertVerdict(res, 4, "MANUAL", "0.30000000000000004")
        self.assertVerdict(res, 5, "MANUAL", "5 ÷ 0")
        self.assertVerdict(res, 6, "MANUAL", "220")
        self.assertVerdict(res, 7, "MANUAL", "flips the sign")
        self.assertVerdict(res, 8, "MANUAL", "history tape")
        self.assertVerdict(res, 9, "MANUAL", "360px")
        self.assertVerdict(res, 10, "MANUAL", "console")

    def test_new_function_fails(self):
        html = CALC_HTML.replace("function parseTokens(e) { return 0; }",
                                 "function parseTokens(e) { return new Function('return 2 + 2')(); }")
        res = self.run_checks("06", {"index.html": html})
        self.assertVerdict(res, 2, "FAIL", "new Function")

    def test_eval_fails(self):
        html = CALC_HTML.replace("function parseTokens(e) { return 0; }",
                                 "function parseTokens(e) { return eval(e); }")
        res = self.run_checks("06", {"index.html": html})
        self.assertVerdict(res, 2, "FAIL", "eval(")

    def test_external_script_fails(self):
        html = CALC_HTML.replace("<script>", '<script src="app.js">')
        res = self.run_checks("06", {"index.html": html, "app.js": "press('1');"})
        self.assertVerdict(res, 1, "FAIL", "app.js")

    def test_second_html_fails(self):
        res = self.run_checks("06", {"index.html": CALC_HTML, "about.html": "<p>hi</p>"})
        self.assertVerdict(res, 1, "FAIL", "2 html files")

    def test_no_html_all_manual(self):
        res = self.run_checks("06", {"README.md": "x"})
        self.assertTenPrinted(res)
        for n in range(1, 11):
            self.assertVerdict(res, n, "MANUAL")

    # --- 2026-11-07 wave-2 review fixes (findings 1-3, 5) ---

    def test_bare_function_call_fails(self):
        # bare Function("...")() is dynamic code execution without `new`
        html = CALC_HTML.replace("function parseTokens(e) { return 0; }",
                                 'function parseTokens(e) { return Function("return 2 + 2")(); }')
        res = self.run_checks("06", {"index.html": html})
        self.assertVerdict(res, 2, "FAIL", "Function(")

    def test_dynamic_exec_only_in_comment_goes_manual(self):
        # a self-checker's comment naming the anti-pattern must not FAIL (the
        # spec01 c7 arm-bias lesson); it is evidence, not execution
        html = CALC_HTML.replace("function parseTokens(e) { return 0; }",
                                 "// no eval() or Function() here - hand-parsed\n"
                                 "function parseTokens(e) { return 0; }")
        res = self.run_checks("06", {"index.html": html})
        self.assertVerdict(res, 2, "MANUAL", "only inside a comment")

    def test_commented_out_cdn_does_not_fail_c1(self):
        # the module docstring's contract: commented-out markup cannot fail a check
        html = CALC_HTML.replace(
            "<head>",
            '<head><!-- old layout: <link rel="stylesheet" href="https://cdn.example/x.css"> -->')
        res = self.run_checks("06", {"index.html": html})
        self.assertVerdict(res, 1, "PASS", "no external references")

    def test_js_comment_reference_goes_manual_c1(self):
        # a commented-out <link> inside a script block: dead markup in a JS
        # comment is evidence (MANUAL), never a conclusive FAIL
        html = CALC_HTML.replace(
            "<style>",
            '<script>/* old fallback: <link href="https://cdn.example/x.css"> */</script>'
            "<style>")
        res = self.run_checks("06", {"index.html": html})
        self.assertVerdict(res, 1, "MANUAL", "only inside a comment")

    def test_css_import_fails(self):
        html = CALC_HTML.replace("<style>", '<style>@import url("theme.css");')
        res = self.run_checks("06", {"index.html": html})
        self.assertVerdict(res, 1, "FAIL", "@import")

    def test_css_import_data_uri_passes(self):
        html = CALC_HTML.replace("<style>", '<style>@import url("data:text/css,body{}");')
        res = self.run_checks("06", {"index.html": html})
        self.assertVerdict(res, 1, "PASS", "no external references")

    def test_bare_data_import_cannot_eat_a_real_reference(self):
        # 2026-11-07 wave-2 re-review (N1): the data:-URI exemption stops at a
        # raw space - a bare form must not swallow an external ref on the line
        html = CALC_HTML.replace(
            "<style>",
            '<style>@import data:text/css,body{} <link rel=stylesheet href=https://evil.com/x.css>')
        res = self.run_checks("06", {"index.html": html})
        self.assertVerdict(res, 1, "FAIL", "external reference")


# ---------------------------------------------------------------- spec 07

POMO_TAIL = """<script>
"use strict";
const WORK = 25 * 60;
let remaining = WORK;
let endsAt = null;
function tick() {
  remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
  render();
}
setInterval(tick, 250);
</script>
"""

POMO_HTML = """<!doctype html>
<html>
<head><meta charset="utf-8"><title>Tempo</title>
<style>#time { font-size: 3rem; }</style></head>
<body>
<div id="time">25:00</div><div id="phase">Work 1 of 4</div>
<button id="start">Start</button><button id="pause">Pause</button>
<button id="reset">Reset</button><button id="skip">Skip</button>
""" + POMO_TAIL + """</body>
</html>
"""


class Spec07(FixtureTest):
    def test_clean_timer_quotes_wall_clock_line(self):
        res = self.run_checks("07", {"index.html": POMO_HTML})
        self.assertTenPrinted(res)
        self.assertVerdict(res, 1, "PASS", "no external references (denylist scan)")
        self.assertVerdict(res, 10, "MANUAL", "Date.now()")
        self.assertIn("wall clock", res[10][1])

    def test_ticks_only_never_autopasses_and_names_suspicion(self):
        html = POMO_HTML.replace(POMO_TAIL, """<script>
"use strict";
let remaining = 1500;
setInterval(() => { remaining -= 1; render(); }, 1000);
</script>
""")
        res = self.run_checks("07", {"index.html": html})
        self.assertVerdict(res, 10, "MANUAL", "may count interval ticks")
        self.assertNotEqual(res[10][0], "PASS")

    def test_external_script_fails(self):
        html = POMO_HTML.replace("<script>", '<script src="timer.js">')
        res = self.run_checks("07", {"index.html": html, "timer.js": "tick();"})
        self.assertVerdict(res, 1, "FAIL", "timer.js")

    def test_comment_only_wall_clock_is_flagged(self):
        # 2026-11-07 wave-2 review (finding 12): a comment naming Date.now must
        # not be quoted as the mechanism - the verdict says so instead
        tail = POMO_TAIL.replace(
            "remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));",
            "remaining = remaining - 1;")
        tail = tail.replace("let endsAt = null;",
                            "// no Date.now(), no deadline here - interval ticks only\n")
        self.assertNotEqual(tail, POMO_TAIL)  # mutations applied
        html = POMO_HTML.replace(POMO_TAIL, tail)
        res = self.run_checks("07", {"index.html": html})
        self.assertTenPrinted(res)
        self.assertVerdict(res, 10, "MANUAL", "inside a comment")
        self.assertNotIn("wall-clock pattern found: '//", res[10][1])


# ---------------------------------------------------------------- spec 08

SPLIT_APP = '''#!/usr/bin/env python3
"""SplitBird - tiny expense-splitting API."""
import json
import sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer

DB = sqlite3.connect("splitbird.db")

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_error(400, "malformed JSON")
            return
        if body.get("amount", 0) < 0:
            self.send_error(400, "amount must be positive")
            return
        self.send_response(201)
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
'''

SPLIT_TESTS = "\n".join(
    f"def test_{name}():\n    assert True\n" for name in
    ("add_expense", "list_expenses", "balances", "settle",
     "negative_amount_rejected", "unknown_currency_rejected",
     "empty_payer_rejected", "malformed_json_rejected")) + "\n"

SPLIT_README = """# SplitBird

## Test

    python -m pytest

## Run

    python app.py
"""


class Spec08(FixtureTest):
    FULL = {"app.py": SPLIT_APP, "tests/test_api.py": SPLIT_TESTS,
            "README.md": SPLIT_README}

    def test_full_layout(self):
        res = self.run_checks("08", self.FULL)
        self.assertTenPrinted(res)
        self.assertVerdict(res, 1, "PASS", "run command")
        self.assertVerdict(res, 5, "MANUAL", "8 test function(s) in 1 file(s)")
        self.assertVerdict(res, 6, "PASS", "denylist scan")
        self.assertVerdict(res, 8, "MANUAL", "storage code")
        self.assertVerdict(res, 4, "MANUAL", "B pays A 10")
        self.assertIn("C pays A 40", res[4][1])
        self.assertVerdict(res, 3, "MANUAL", "separate USD and EUR figures")
        self.assertVerdict(res, 10, "MANUAL", "0.30000000000000004")

    def test_three_tests_fails(self):
        three = "\n".join(f"def test_{n}():\n    assert True\n" for n in ("a", "b", "c"))
        files = dict(self.FULL)
        files["tests/test_api.py"] = three
        res = self.run_checks("08", files)
        self.assertVerdict(res, 5, "FAIL", "only 3 test function(s) found; spec requires at least 8")

    def test_secret_key_fails(self):
        files = dict(self.FULL)
        files["app.py"] = SPLIT_APP + 'API_KEY = "sk-abcdefghijklmnopqrstuvwx"\n'
        res = self.run_checks("08", files)
        self.assertVerdict(res, 6, "FAIL", "secret-like literal")

    def test_external_url_goes_manual(self):
        files = dict(self.FULL)
        files["app.py"] = SPLIT_APP + 'WEBHOOK = "https://api.external.example/v1"\n'
        res = self.run_checks("08", files)
        self.assertVerdict(res, 6, "MANUAL", "URL literal found")

    def test_readme_without_commands_fails(self):
        files = dict(self.FULL)
        files["README.md"] = "# SplitBird\n\nSee the docs folder for usage.\n"
        res = self.run_checks("08", files)
        self.assertVerdict(res, 1, "FAIL", "names no test command")

    def test_no_readme_fails(self):
        files = dict(self.FULL)
        del files["README.md"]
        res = self.run_checks("08", files)
        self.assertVerdict(res, 1, "FAIL", "README.md missing")

    # --- 2026-11-07 wave-2 review fixes (findings 6, 11, 15) ---

    def test_python3_readme_passes(self):
        files = dict(self.FULL)
        files["README.md"] = "# SplitBird\nTest: `python3 -m pytest`\nRun: `python3 app.py`\n"
        res = self.run_checks("08", files)
        self.assertVerdict(res, 1, "PASS", "run command")

    def test_node_test_readme_passes(self):
        files = dict(self.FULL)
        files["README.md"] = "# SplitBird\nTest: `node --test tests/`\nRun: `npm start`\n"
        res = self.run_checks("08", files)
        self.assertVerdict(res, 1, "PASS", "run command")

    def test_readme_secret_is_not_a_fail(self):
        # criterion 6 judges the server source; a README naming the token
        # shape is documentation, not a committed key
        files = dict(self.FULL)
        files["README.md"] = SPLIT_README + \
            "\n(never commit something like sk-abcdefghijklmnopqrstuvwx)\n"
        res = self.run_checks("08", files)
        self.assertVerdict(res, 6, "PASS", "denylist scan")

    def test_comment_only_secret_goes_manual(self):
        files = dict(self.FULL)
        files["app.py"] = SPLIT_APP + \
            "# never hardcode something like sk-abcdefghijklmnopqrstuvwx\n"
        res = self.run_checks("08", files)
        self.assertVerdict(res, 6, "MANUAL", "only inside a comment")

    def test_localhost_subdomain_is_a_hit(self):
        files = dict(self.FULL)
        files["app.py"] = SPLIT_APP + 'CALLBACK = "http://localhost.evil.com/x"\n'
        res = self.run_checks("08", files)
        self.assertVerdict(res, 6, "MANUAL", "URL literal found")

    def test_loopback_prefix_hostname_is_a_hit(self):
        # 2026-11-07 wave-2 re-review (N4): 127.0.0.1.evil.com is not a loopback
        files = dict(self.FULL)
        files["app.py"] = SPLIT_APP + 'CALLBACK = "http://127.0.0.1.evil.com/x"\n'
        res = self.run_checks("08", files)
        self.assertVerdict(res, 6, "MANUAL", "URL literal found")

    def test_config_comment_secret_goes_manual(self):
        # 2026-11-07 wave-2 re-review (N5): yaml/ini/env comments are #-comment
        # formats the c6 scan covers - a documented token there is MANUAL
        files = dict(self.FULL)
        files["config.yaml"] = "# docs: the token shape is ghp_" + "a" * 36 + "\n"
        res = self.run_checks("08", files)
        self.assertVerdict(res, 6, "MANUAL", "only inside a comment")

    def test_html_comment_secret_goes_manual(self):
        # 2026-11-07 wave-2 re-review (X4): a token inside an HTML comment used
        # to vanish with the strip to a silent PASS - the fallback scans raw
        files = dict(self.FULL)
        files["index.html"] = "<!-- old example key: sk-" + "a" * 24 + " -->\n<p>x</p>"
        res = self.run_checks("08", files)
        self.assertVerdict(res, 6, "MANUAL", "only inside a comment")


# ---------------------------------------------------------------- spec 09

STARTER = BENCH.parent / "benchmark-v3" / "starters" / "09-notes-app"


class Spec09(FixtureTest):
    def starter(self):
        """Byte copies of the real starter - the manifest's recorded hashes hold."""
        return {p.relative_to(STARTER).as_posix(): p.read_bytes()
                for p in sorted(STARTER.rglob("*")) if p.is_file()}

    def test_pristine_copy_passes_integrity(self):
        files = self.starter()
        files["data.json"] = b'{"nextId": 0, "notes": []}\n'
        res = self.run_checks("09", files)
        self.assertTenPrinted(res)
        self.assertVerdict(res, 2, "PASS",
                           "7/7 manifest files byte-identical (whitelist: server.js, "
                           "tests/notes.test.js, NOTES.md)")
        self.assertVerdict(res, 7, "PASS", "package.json byte-identical")
        self.assertVerdict(res, 6, "FAIL", "12 test() call(s)")
        self.assertVerdict(res, 8, "FAIL", "NOTES.md missing - the spec requires it")
        self.assertVerdict(res, 3, "MANUAL", "Bug A (dates)")
        self.assertVerdict(res, 4, "MANUAL", "Shopping ToDo list")
        self.assertVerdict(res, 5, "MANUAL", "Bug C (delete)")
        for n in (1, 9, 10):
            self.assertVerdict(res, n, "MANUAL")

    def test_tampered_page_fails(self):
        files = self.starter()
        files["public/index.html"] += b"<!-- tampered -->\n"
        res = self.run_checks("09", files)
        self.assertVerdict(res, 2, "FAIL", "public/index.html sha mismatch")
        self.assertVerdict(res, 7, "PASS", "package.json byte-identical")

    def test_deleted_listed_file_fails(self):
        files = self.starter()
        del files["public/styles.css"]
        res = self.run_checks("09", files)
        self.assertVerdict(res, 2, "FAIL", "manifest-listed file missing: public/styles.css")

    def test_stray_file_fails(self):
        files = self.starter()
        files["new-file.txt"] = b"stray\n"
        res = self.run_checks("09", files)
        self.assertVerdict(res, 2, "FAIL", "unlisted file(s) present: new-file.txt")

    def test_edited_manifest_fails_tamper_guard(self):
        files = self.starter()
        files["manifest.json"] = files["manifest.json"].replace(b"2b2a96f8", b"2b2a96f9", 1)
        self.assertIn(b"2b2a96f9", files["manifest.json"])  # mutation applied
        res = self.run_checks("09", files)
        self.assertVerdict(res, 2, "FAIL", "manifest.json was edited - the tamper guard itself")
        # c7 still verifies through the PRISTINE manifest, not the edited one
        self.assertVerdict(res, 7, "PASS", "package.json byte-identical")

    def test_whitelisted_change_still_passes(self):
        files = self.starter()
        files["server.js"] += b"\n// fixed the dayKey shift\n"
        res = self.run_checks("09", files)
        self.assertVerdict(res, 2, "PASS", "7/7 manifest files byte-identical")

    def test_fifteen_tests_go_manual(self):
        files = self.starter()
        files["tests/notes.test.js"] += (b'\ntest("regression A", () => {});\n'
                                         b'test("regression B", () => {});\n'
                                         b'test("regression C", () => {});\n')
        res = self.run_checks("09", files)
        self.assertVerdict(res, 6, "MANUAL", "15 test() calls counted")
        self.assertVerdict(res, 2, "PASS")

    def test_test_only_counts_as_tests(self):
        # 2026-11-07 wave-2 review (finding 13): test.only( is a test
        # definition; the count must stay factual even when the suite is defective
        files = self.starter()
        files["tests/notes.test.js"] += (b'test.only("regression A", () => {});\n'
                                         b'test.only("regression B", () => {});\n'
                                         b'test.only("regression C", () => {});\n')
        res = self.run_checks("09", files)
        self.assertVerdict(res, 6, "MANUAL", "15 test() calls counted")

    def test_pristine_unreachable_c7_manual(self):
        # 2026-11-07 wave-2 review (finding 7): an unreachable pristine manifest
        # must leave c7 MANUAL - the run's own manifest must never authenticate
        # an edit of package.json (self-auth PASS probed live by the reviewer)
        files = self.starter()
        saved = checks.PRISTINE_STARTER
        checks.PRISTINE_STARTER = BENCH / "definitely-not-here"
        try:
            res = self.run_checks("09", files)
        finally:
            checks.PRISTINE_STARTER = saved
        self.assertVerdict(res, 7, "MANUAL", "no trusted manifest")

    def test_nested_data_json_fails_unlisted(self):
        # 2026-11-07 wave-2 review (finding 9): only the ROOT data.json is
        # runtime state; a nested same-named file is an unlisted file
        files = self.starter()
        files["sub/data.json"] = b"{}\n"
        res = self.run_checks("09", files)
        self.assertVerdict(res, 2, "FAIL", "unlisted file(s) present: sub/data.json")

    def test_commented_out_tests_not_counted(self):
        # 2026-11-07 wave-2 re-review (N6): a commented-out test() line must
        # not inflate the count - 12 real + 3 commented = FAIL at 12, not MANUAL
        files = self.starter()
        files["tests/notes.test.js"] += (b'// test("fake regression A", () => {});\n'
                                         b'// test("fake regression B", () => {});\n'
                                         b'// test("fake regression C", () => {});\n')
        res = self.run_checks("09", files)
        self.assertVerdict(res, 6, "FAIL", "12 test() call(s)")

    def test_missing_test_file_fails(self):
        files = self.starter()
        del files["tests/notes.test.js"]
        res = self.run_checks("09", files)
        self.assertVerdict(res, 6, "FAIL", "tests/notes.test.js missing")

    def test_missing_notes_md_fails(self):
        res = self.run_checks("09", self.starter())
        self.assertVerdict(res, 8, "FAIL", "NOTES.md missing - the spec requires it")

    def test_notes_sections_go_manual(self):
        files = self.starter()
        files["NOTES.md"] = ("# Notes\n\n## Bug A\nfile: server.js\n"
                             "## Bug B\nroot cause\n## Bug C\nfix\n").encode("utf-8")
        res = self.run_checks("09", files)
        self.assertVerdict(res, 8, "MANUAL", "Bug A/B/C found")
        self.assertVerdict(res, 2, "PASS")

    def test_pristine_unreachable_goes_manual(self):
        files = self.starter()
        saved = checks.PRISTINE_STARTER
        checks.PRISTINE_STARTER = BENCH / "definitely-not-here"
        try:
            res = self.run_checks("09", files)
        finally:
            checks.PRISTINE_STARTER = saved
        self.assertVerdict(res, 2, "MANUAL", "pristine starter")


# ---------------------------------------------------------------- spec 10

FIXTURE = BENCH / "specs" / "fixtures" / "10-expenses.csv"

GOLDEN_REPORT = {
    "totals_by_currency": {"USD": 2300.49, "EUR": 3734.56, "INR": 65500.75},
    "rows_by_currency": {"USD": 3, "EUR": 2, "INR": 3},
    "skipped_duplicates": [{"row": 5, "id": "E001"}, {"row": 13, "id": "E010"}],
    "invalid_rows": [
        {"row": 9, "reason": "amount missing"},
        {"row": 10, "reason": "unknown currency GBP"},
        {"row": 11, "reason": "date missing"},
        {"row": 14, "reason": "amount not a number"},
        {"row": 15, "reason": "impossible date 2026-02-30"},
    ],
    "date_range": {"min": "2026-01-05", "max": "2026-01-20"},
}

TRANSFORM_PY = '''#!/usr/bin/env python3
"""Expenses CSV -> JSON report. Standard library only."""
import csv
import json
import sys


def main(argv):
    if len(argv) != 3:
        print("usage: transform.py <in.csv> <out.json>", file=sys.stderr)
        return 2
    src, dst = argv[1], argv[2]
    try:
        handle = open(src, newline="", encoding="utf-8")
    except OSError as exc:
        print(f"cannot read {src}: {exc}", file=sys.stderr)
        return 2
    with handle:
        rows = list(csv.DictReader(handle))
    report = {"totals_by_currency": {}, "rows_by_currency": {},
              "skipped_duplicates": [], "invalid_rows": [], "date_range": {}}
    with open(dst, "w", encoding="utf-8") as out:
        json.dump(report, out, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
'''


def _recompute_golden(text):
    """Independent reference parse of the spec-10 CSV: the documented rules
    (decimal-comma EUR, $ and rupee prefixes, DD/MM and month-name dates,
    duplicate ids skipped, missing or unparseable fields invalid). Shares no
    code with checks.py's golden constants."""
    months = {m: i + 1 for i, m in enumerate(
        "jan feb mar apr may jun jul aug sep oct nov dec".split())}

    def amount(raw):
        raw = (raw or "").strip()
        if raw.startswith("$"):
            return round(float(raw[1:].replace(",", "")), 2)
        if raw.startswith("₹"):
            return round(float(raw[1:].replace(",", "")), 2)
        if raw.endswith("€"):
            body = raw[:-1].strip().replace(".", "").replace(",", ".")
            return round(float(body), 2)
        raise ValueError("unknown amount format: " + raw)

    def when(raw):
        raw = (raw or "").strip()
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", raw)
        if m:
            y, mo, d = (int(x) for x in m.groups())
        else:
            m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", raw)
            if m:
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            else:
                m = re.fullmatch(r"([A-Za-z]{3}) (\d{1,2}), (\d{4})", raw)
                if not m:
                    return None
                mo, d, y = months[m.group(1).lower()], int(m.group(2)), int(m.group(3))
        try:
            return datetime.date(y, mo, d).isoformat()
        except ValueError:
            return None

    totals, counts, skipped, invalid, seen, days = {}, {}, [], [], set(), []
    for i, row in enumerate(csv.DictReader(text.splitlines())):
        n = i + 2   # header is row 1
        rid = (row["id"] or "").strip()
        if rid in seen:
            skipped.append((n, rid))
            continue
        if not rid:
            invalid.append((n, "missing id"))
            continue
        seen.add(rid)
        try:
            value = amount(row["amount"])
        except (ValueError, AttributeError):
            invalid.append((n, "amount missing or unparseable"))
            continue
        cur = (row["currency"] or "").strip()
        if cur not in ("USD", "EUR", "INR"):
            invalid.append((n, "currency missing or unknown"))
            continue
        day = when(row["date"])
        if day is None:
            invalid.append((n, "date missing or impossible"))
            continue
        totals[cur] = round(totals.get(cur, 0.0) + value, 2)
        counts[cur] = counts.get(cur, 0) + 1
        days.append(day)
    return totals, counts, skipped, invalid, (min(days), max(days))


class Spec10(FixtureTest):
    def golden_files(self, overrides=None):
        files = {"transform.py": TRANSFORM_PY,
                 "expenses.csv": FIXTURE.read_bytes(),
                 "report.json": json.dumps(GOLDEN_REPORT, indent=2)}
        if overrides:
            files.update(overrides)
        return files

    def test_golden_report_all_pass(self):
        res = self.run_checks("10", self.golden_files())
        self.assertTenPrinted(res)
        self.assertVerdict(res, 1, "PASS", "all imports stdlib")
        self.assertVerdict(res, 2, "MANUAL", "expect exit 0")
        self.assertVerdict(res, 3, "PASS", "2300.49")
        self.assertVerdict(res, 4, "PASS", "rows 5 (E001), 13 (E010)")
        self.assertVerdict(res, 5, "PASS", "rows 9, 10, 11, 14, 15 all listed with reasons")
        self.assertVerdict(res, 6, "PASS", "min 2026-01-05, max 2026-01-20")
        self.assertVerdict(res, 7, "PASS", "totals match the golden")
        self.assertVerdict(res, 8, "PASS", "exactly the five specified keys")
        self.assertVerdict(res, 9, "PASS", "USD 3, EUR 2, INR 3")
        self.assertVerdict(res, 10, "MANUAL", "explicit rules")

    def test_wrong_total_fails_with_both_numbers(self):
        report = json.loads(json.dumps(GOLDEN_REPORT))
        report["totals_by_currency"]["USD"] = 2300.5
        res = self.run_checks("10", self.golden_files({"report.json": json.dumps(report)}))
        self.assertVerdict(res, 3, "FAIL", "USD total 2300.5 != golden 2300.49")
        self.assertVerdict(res, 7, "MANUAL", "which amount format misparsed")
        self.assertVerdict(res, 9, "PASS", "USD 3, EUR 2, INR 3")

    def test_missing_report_all_manual(self):
        files = self.golden_files()
        del files["report.json"]
        res = self.run_checks("10", files)
        self.assertVerdict(res, 3, "MANUAL", "no report.json found in the run folder")
        for n in (4, 5, 6, 7, 8, 9):
            self.assertVerdict(res, n, "MANUAL")
        self.assertVerdict(res, 10, "MANUAL")

    def test_csv_mutated_goes_manual(self):
        mutated = FIXTURE.read_bytes().replace(b"99.99", b"95.99")
        self.assertNotEqual(mutated, FIXTURE.read_bytes())  # mutation applied
        res = self.run_checks("10", self.golden_files({"expenses.csv": mutated}))
        self.assertVerdict(res, 3, "MANUAL", "differs from the spec fixture")

    def test_third_party_import_fails(self):
        files = self.golden_files()
        files["transform.py"] = TRANSFORM_PY.replace("import csv",
                                                     "import pandas as pd\nimport csv")
        res = self.run_checks("10", files)
        self.assertVerdict(res, 1, "FAIL", "non-stdlib import: pandas")

    def test_extra_key_fails(self):
        report = json.loads(json.dumps(GOLDEN_REPORT))
        report["extra_key"] = 1
        res = self.run_checks("10", self.golden_files({"report.json": json.dumps(report)}))
        self.assertVerdict(res, 8, "FAIL", "extra: extra_key")

    def test_unparseable_report_goes_manual(self):
        res = self.run_checks("10", self.golden_files({"report.json": "{oops"}))
        self.assertVerdict(res, 3, "MANUAL", "does not parse as JSON")

    def test_second_py_file_fails(self):
        res = self.run_checks("10", self.golden_files({"helper.py": "X = 1\n"}))
        self.assertVerdict(res, 1, "FAIL", "more than one .py file")

    def test_fixture_matches_spec_block(self):
        # two routes, one answer: the fixture on disk and the CSV fenced inside
        # the spec markdown must never drift. CRLF-tolerant on both sides (the
        # fixture path is not -text in .gitattributes, so autocrlf may translate
        # it on a fresh clone; the golden answers are identical either way).
        spec = (BENCH / "specs" / "10-data-transform.md").read_text(encoding="utf-8")
        m = re.search(r"```csv\n(.*?)```", spec, re.S)
        self.assertIsNotNone(m, "no ```csv fence in spec 10")
        self.assertEqual(FIXTURE.read_bytes().replace(b"\r\n", b"\n"),
                         m.group(1).encode("utf-8").replace(b"\r\n", b"\n"))

    def test_golden_recomputed_independently(self):
        # third route: parse the fixture with csv + the documented rules, then
        # pin the numbers as literals here - a wrong constant in checks.py goes
        # red against this, because nothing below is derived from checks.py.
        totals, counts, skipped, invalid, days = _recompute_golden(
            FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(totals, {"USD": 2300.49, "EUR": 3734.56, "INR": 65500.75})
        self.assertEqual(counts, {"USD": 3, "EUR": 2, "INR": 3})
        self.assertEqual(skipped, [(5, "E001"), (13, "E010")])
        self.assertEqual([r for r, _ in invalid], [9, 10, 11, 14, 15])
        self.assertEqual(days, ("2026-01-05", "2026-01-20"))
        # and the scorer must judge from exactly these numbers:
        self.assertEqual(checks.SPEC10_GOLDEN_TOTALS, totals)
        self.assertEqual(checks.SPEC10_GOLDEN_ROWS, counts)
        self.assertEqual(checks.SPEC10_GOLDEN_SKIPPED, dict(skipped))
        self.assertEqual(checks.SPEC10_GOLDEN_INVALID, {r for r, _ in invalid})
        self.assertEqual(checks.SPEC10_GOLDEN_RANGE, days)

    # --- 2026-11-07 wave-2 review fixes (findings 4, 10, 14) ---

    def test_multi_import_caught(self):
        # import csv, requests used to pass with only csv seen
        files = self.golden_files()
        files["transform.py"] = TRANSFORM_PY.replace("import csv", "import csv, requests")
        res = self.run_checks("10", files)
        self.assertVerdict(res, 1, "FAIL", "non-stdlib import: requests")

    def test_semicolon_chained_import_caught(self):
        # 2026-11-07 wave-2 re-review (N2): import csv; import requests is two
        # statements - the second used to escape
        files = self.golden_files()
        files["transform.py"] = TRANSFORM_PY.replace("import csv",
                                                     "import csv; import requests")
        res = self.run_checks("10", files)
        self.assertVerdict(res, 1, "FAIL", "non-stdlib import: requests")

    def test_mixed_quote_string_import_caught(self):
        # 2026-11-07 wave-2 re-review (N3): an unpaired """ inside a ''' string
        # must not truncate the line before the real closer and hide imports
        files = self.golden_files()
        files["transform.py"] = TRANSFORM_PY.replace(
            "import csv", "x = '''a \"\"\"b'''\nimport requests\nimport csv")
        res = self.run_checks("10", files)
        self.assertVerdict(res, 1, "FAIL", "non-stdlib import: requests")

    def test_semicolon_inside_string_is_not_a_statement(self):
        # 2026-11-07 wave-2 re-review (X1): '; import x' inside a string
        # literal must not manufacture a fake import statement
        files = self.golden_files()
        files["transform.py"] = TRANSFORM_PY.replace(
            "import csv", 'import csv\nprint("step 1; import requests next")')
        res = self.run_checks("10", files)
        self.assertVerdict(res, 1, "PASS", "all imports stdlib")

    def test_hash_inside_string_does_not_eat_a_real_import(self):
        # (X3): PY_COMMENT used to eat from the # inside a string through a
        # real "; import requests" that followed on the same line
        files = self.golden_files()
        files["transform.py"] = TRANSFORM_PY.replace(
            "import csv", 'import csv\nmsg = "use # carefully"; import requests')
        res = self.run_checks("10", files)
        self.assertVerdict(res, 1, "FAIL", "non-stdlib import: requests")

    def test_import_mention_in_docstring_passes(self):
        # a docstring mentioning an import is not an import
        files = self.golden_files()
        files["transform.py"] = (
            '"""Report tool.\n\nimport requests would be a third-party\n'
            'dependency - this tool is stdlib only.\n"""\nimport csv\nimport json\nimport sys\n')
        res = self.run_checks("10", files)
        self.assertVerdict(res, 1, "PASS", "all imports stdlib")

    def test_unrounded_total_fails(self):
        # 0.005 tolerance admitted a total that is not rounded to 2 decimals
        report = json.loads(json.dumps(GOLDEN_REPORT))
        report["totals_by_currency"]["USD"] = 2300.485
        res = self.run_checks("10", self.golden_files({"report.json": json.dumps(report)}))
        self.assertVerdict(res, 3, "FAIL", "USD total 2300.485 != golden 2300.49")

    def test_duplicate_skip_entries_fail(self):
        # last-wins on a duplicate row number used to hide a garbage entry
        report = json.loads(json.dumps(GOLDEN_REPORT))
        report["skipped_duplicates"] = [{"row": 5, "id": "E999"}, {"row": 5, "id": "E001"},
                                        {"row": 13, "id": "E010"}]
        res = self.run_checks("10", self.golden_files({"report.json": json.dumps(report)}))
        self.assertVerdict(res, 4, "FAIL", "duplicate row numbers")

    def test_duplicate_invalid_entries_fail(self):
        report = json.loads(json.dumps(GOLDEN_REPORT))
        report["invalid_rows"] = GOLDEN_REPORT["invalid_rows"] + [{"row": 9, "reason": "dup"}]
        res = self.run_checks("10", self.golden_files({"report.json": json.dumps(report)}))
        self.assertVerdict(res, 5, "FAIL", "duplicate row numbers")


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
        # 2026-11-07: was "--spec 09" until the v3 pack registered specs 06-10,
        # which made 09 a valid scorer. The probe moved to an unregistered id;
        # the contract it pins is unchanged: an unknown spec id exits 2.
        done = self.run_cli("--spec", "11", "--dir", ".")
        self.assertEqual(done.returncode, 2)

    def test_missing_dir_exits_2(self):
        done = self.run_cli("--spec", "01", "--dir", "Z:/definitely/not/here")
        self.assertEqual(done.returncode, 2)

    def test_non_ascii_output_never_crashes_the_cli(self):
        # 2026-11-07 (v3 smoke): the spec 06/10 criterion text contains U+232B
        # (backspace glyph) and U+20B9 (rupee sign), which the Windows console
        # codec (cp1252) cannot encode - the scorer used to crash mid-run with
        # UnicodeEncodeError, printing 6 of 10 lines and exiting 1. main() now
        # reconfigures stdout/stderr to backslashreplace; pinned here with a
        # forced cp1252 child stdout so the test is deterministic on any box.
        tmp = tempfile.mkdtemp(prefix="checks-cli-")
        self.addCleanup(shutil.rmtree, tmp, True)
        Path(tmp, "index.html").write_text(CALC_HTML, encoding="utf-8")
        done = subprocess.run(
            [sys.executable, "-I", str(BENCH / "checks.py"), "--spec", "06", "--dir", tmp],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            env=dict(os.environ, PYTHONIOENCODING="cp1252"))
        self.assertEqual(done.returncode, 0, done.stderr)
        nums = [int(line[:2]) for line in done.stdout.splitlines() if line[:2].isdigit()]
        self.assertEqual(sorted(nums), list(range(1, 11)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
