#!/usr/bin/env python3
"""Automatic checks for benchmark H3. Usage: python tools/check_h3.py <output-dir>"""
import re, sys
from pathlib import Path

root = Path(sys.argv[1])
files = [p for p in root.rglob("*") if p.is_file() and "node_modules" not in p.parts]
code = {p: p.read_text(encoding="utf-8", errors="replace") for p in files if p.suffix.lower() in {".html", ".htm", ".js", ".mjs", ".css"}}
docs = {p: p.read_text(encoding="utf-8", errors="replace") for p in files if p.suffix.lower() in {".md", ".txt"}}
alltext = "\n".join(code.values()).lower()
doctext = "\n".join(docs.values()).lower()
web = "\n".join(code.values())

ext = re.findall(r"(?:src|href)=[\"'](https?://[^\"']+)", web, re.I) + re.findall(r"@import\s+url\(\s*[\"']?(https?://[^)\"']+)", web, re.I)
print(f" 9. {'PASS' if not ext else 'FAIL'} external URLs: {ext[:3] if ext else 'none'}")
claims = [m for m in re.findall(r"[^.\n]*(?:guarantee|never (?:be )?lost|cannot be lost|will not lose)[^.\n]*", alltext + "\n" + doctext)]
neg = [c for c in claims if re.search(r"\b(cannot|can't|not|no|impossible|unable|without)\b", c)]
pos = [c for c in claims if c not in neg]
print(f" 4. {'PASS (automatic part)' if not pos else 'CHECK'} possible guarantee claims: {[c.strip()[:80] for c in pos[:3]] if pos else 'none'}")
mentions = {k: bool(re.search(p, doctext)) for k, p in {
    "R1/R2 conflict": r"(offline|r1).{0,200}(sync|real-?time|r2)|(sync|real-?time|r2).{0,200}(offline|r1)",
    "R3/R4 conflict": r"(chart\.?js|r4).{0,200}(depend|r3)|(depend|r3).{0,200}(chart\.?js|r4)",
    "R5 limit": r"(100,?000|100k|r5)",
    "R6 impossible": r"(r6|never lost|data loss|storage (?:can|may) be cleared)",
}.items()}
for k, v in mentions.items():
    print(f"  ~ {k}: {'mentioned in docs' if v else 'not found in .md/.txt files'} (weak signal; confirm by reading)")
print("Items 1-3, 5-8 and 10-13 are manual (see RUBRIC.md).")
