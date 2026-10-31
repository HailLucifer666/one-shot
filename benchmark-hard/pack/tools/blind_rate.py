#!/usr/bin/env python3
"""Blind A/B rating of screenshots, skill vs baseline.

  Put screenshots at shots/<spec>/baseline.png and shots/<spec>/skill.png
  python tools/blind_rate.py prep --shots shots --out blind
      -> blind/<spec>_A.png, blind/<spec>_B.png, blind/rating.csv, and blind_key.json (keep private)
  Give the blind/ folder to 3 or more raters; each fills a copy of rating.csv (rename: rating_alex.csv ...).
  python tools/blind_rate.py summary --key blind_key.json --ratings blind/rating*.csv
"""
import argparse, csv, glob, json, random, shutil, statistics
from pathlib import Path

IMG = {".png", ".jpg", ".jpeg", ".webp"}


def prep(shots, out, seed):
    rng = random.Random(seed)
    shots, out = Path(shots), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    key = {}
    for spec in sorted(p for p in shots.iterdir() if p.is_dir()):
        found = {p.stem: p for p in spec.iterdir() if p.suffix.lower() in IMG}
        if set(found) != {"baseline", "skill"}:
            print(f"skip {spec.name}: needs baseline and skill images, found {sorted(found)}")
            continue
        arms = ["baseline", "skill"]
        rng.shuffle(arms)
        key[spec.name] = {"A": arms[0], "B": arms[1]}
        for label, arm in zip("AB", arms):
            src = found[arm]
            shutil.copy(src, out / f"{spec.name}_{label}{src.suffix.lower()}")
    keyfile = out.parent / "blind_key.json"
    keyfile.write_text(json.dumps(key, indent=2))
    with open(out / "rating.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["spec", "winner (A, B or tie)", "score_A (1-5)", "score_B (1-5)", "rater"])
        for spec in key:
            w.writerow([spec, "", "", "", ""])
    print(f"Prepared {len(key)} specs in {out}. Key saved to {keyfile}; do not share it with raters.")
    print("Score guide: 1 = generic AI template, 3 = fine but forgettable, 5 = looks designed for this business.")


def summary(keyfile, patterns):
    key = json.loads(Path(keyfile).read_text(encoding="utf-8"))
    wins = {"baseline": 0, "skill": 0, "tie": 0}
    scores = {"baseline": [], "skill": []}
    files = sorted({f for p in patterns for f in glob.glob(p)})
    rows = 0
    for fn in files:
        with open(fn, newline="") as f:
            for r in csv.reader(f):
                if not r or r[0] == "spec" or r[0] not in key or len(r) < 4:
                    continue
                spec, win, sa, sb = r[0], r[1].strip().upper(), r[2].strip(), r[3].strip()
                if not win:
                    continue
                rows += 1
                m = key[spec]
                if win == "TIE":
                    wins["tie"] += 1
                elif win in ("A", "B"):
                    wins[m[win]] += 1
                for lab, s in (("A", sa), ("B", sb)):
                    if s:
                        scores[m[lab]].append(float(s))
    print(f"{rows} ratings from {len(files)} file(s)")
    print(f"Wins: skill {wins['skill']}, baseline {wins['baseline']}, tie {wins['tie']}")
    for arm in ("baseline", "skill"):
        v = scores[arm]
        print(f"Mean score {arm}: {statistics.mean(v):.2f} (n={len(v)})" if v else f"Mean score {arm}: n/a")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("prep")
    a.add_argument("--shots", required=True)
    a.add_argument("--out", default="blind")
    a.add_argument("--seed", type=int, default=None)
    b = sub.add_parser("summary")
    b.add_argument("--key", required=True)
    b.add_argument("--ratings", nargs="+", required=True)
    args = ap.parse_args()
    prep(args.shots, args.out, args.seed) if args.cmd == "prep" else summary(args.key, args.ratings)
