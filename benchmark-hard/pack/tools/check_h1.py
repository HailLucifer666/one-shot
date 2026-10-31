#!/usr/bin/env python3
"""Automatic checks for benchmark H1 (coffee shop).

  python tools/check_h1.py <output-dir>
  python tools/check_h1.py contrast <hex1> <hex2>
"""
import re, sys
from pathlib import Path

def norm(s):
    s = s.replace("\u2013", "-").replace("\u2014", "-").replace("&amp;", "&").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", s).lower()

def lum(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

EMOJI = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B50\u2B06\u2705\u274C]")

def main():
    if len(sys.argv) == 4 and sys.argv[1] == "contrast":
        r = contrast(sys.argv[2], sys.argv[3])
        print(f"contrast {r:.2f}:1 -> {'PASS' if r >= 4.5 else 'FAIL'} (needs 4.5)")
        return 0
    root = Path(sys.argv[1])
    files = [p for p in root.rglob("*") if p.is_file() and "node_modules" not in p.parts and "one-shot-work" not in p.parts]
    text_ext = {".html", ".htm", ".css", ".js", ".mjs", ".svg"}
    src = {p: p.read_text(encoding="utf-8", errors="replace") for p in files if p.suffix.lower() in text_ext}
    allt = "\n".join(src.values())
    html = "\n".join(v for p, v in src.items() if p.suffix.lower() in (".html", ".htm"))
    css = "\n".join(v for p, v in src.items() if p.suffix.lower() == ".css") + "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", html, re.S | re.I))
    vis = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    vis = norm(re.sub(r"<[^>]+>", " ", vis))
    n_all = norm(allt)
    res = []
    def add(n, ok, note=""):
        res.append((n, ok, note))
    miss = [c for c in ("#3b2a20", "#d9822b", "#faf5ee", "#1e1612") if c not in css.lower()]
    add(1, not miss, f"missing {miss}" if miss else "")
    ff = " ".join(re.findall(r"font-family\s*:[^;}]+", allt, re.I)).lower()
    add(2, "fraunces" in ff and "inter" in ff)
    add(3, "ember & oak" in vis)
    menu = [("espresso", "3.00"), ("flat white", "4.25"), ("cold brew", "4.75"), ("oat milk latte", "5.00"), ("almond croissant", "3.75"), ("cardamom bun", "3.50")]
    bad = [m for m, p in menu if m not in vis or f"${p}" not in vis]
    add(4, not bad, f"missing {bad}" if bad else "")
    add(5, "14 lantern lane, riverton" in vis)
    add(6, "555-0142" in vis)
    hrs = all(re.search(p, vis) for p in (r"7(:00)?\s*am", r"6(:00)?\s*pm", r"8(:00)?\s*am", r"4(:00)?\s*pm"))
    add(7, hrs)
    about = "ember & oak opened in 2019 in a former hardware store. we roast in small batches every tuesday. everything in the case is baked before sunrise."
    add(8, about in vis)
    add(9, "mailto:hello@emberandoak.example" in html.lower())
    banned = [w for w in ("lorem ipsum", "revolutionary", "seamless", "unlock", "elevate", "award-winning") if w in n_all]
    add(10, not banned, f"found {banned}" if banned else "")
    add(11, not EMOJI.search(re.sub(r"<[^>]+>", " ", html)))
    # 12: no remote images. Derived rule, not a service denylist: every img src/srcset and
    # CSS url() reference must be a local relative path or a data: URI. (2026-11-01: the old
    # check substring-matched "placehold" and failed any page carrying placeholder="..."
    # form attributes — probe recorded in VALIDITY-2026-11-01.md. Known edge: url() inside
    # inline style attributes is not scanned; img src/srcset and style blocks are.)
    img_refs = re.findall(r"<img[^>]+(?:src|srcset)=[\"']([^\"']+)", html, re.I)
    url_refs = re.findall(r"url\(\s*[\"']?([^)\"']+)", css, re.I)
    def local_ref(ref):
        if ref.startswith(("data:", "#")):
            return True
        for part in ref.split(","):
            u = part.strip().split()[0].split("#")[0].split("?")[0] if part.strip() else ""
            if u and not re.fullmatch(r"[a-z0-9._/~+-]+\.(?:svg|png|jpe?g|gif|webp|ico|avif)", u, re.I):
                return False
        return True
    bad_refs = [r for r in img_refs + url_refs if not local_ref(r.strip())]
    add(12, not bad_refs, f"non-local image refs: {bad_refs[:2]}" if bad_refs else "")
    arte = [p.name for p in files if p.name in ("package.json",)] + (["framework import"] if re.search(r"from ['\"](react|vue|svelte)|import\s+React", allt) else [])
    add(13, not arte, str(arte) if arte else "")
    h1s = re.findall(r"<h1[\s>]", html, re.I)
    add(14, len(h1s) == 1, f"{len(h1s)} h1 found")
    add(15, bool(re.search(r"name=[\"']viewport", html, re.I)) and bool(re.search(r"<title>[^<]+", html, re.I)) and bool(re.search(r"name=[\"']description", html, re.I)))
    ok = 0
    for n, p, note in res:
        ok += p
        print(f"{n:>2}. {'PASS' if p else 'FAIL'} {note}")
    print(f"auto: {ok}/15 pass. Criteria 16 to 20 are manual (see CRITERIA.md).")
    return 0

sys.exit(main())
