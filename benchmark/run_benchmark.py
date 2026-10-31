#!/usr/bin/env python3
"""Scaffold benchmark runs and summarise results.

  python benchmark/run_benchmark.py init --model glm-5.3-flash --mode baseline
  python benchmark/run_benchmark.py summary
"""
import argparse, json, statistics
from pathlib import Path

ROOT = Path(__file__).parent
RUNS = ROOT / "runs"
TEMPLATE = {"criteria_passed": None, "follow_up_prompts_needed": None, "tokens_used": None, "notes": ""}


def init(model, mode, repeats):
    for spec in sorted((ROOT / "specs").glob("*.md")):
        for n in range(1, repeats + 1):
            d = RUNS / model / mode / spec.stem / f"run{n}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "SPEC.md").write_text(spec.read_text())
            res = d / "RESULT.json"
            if not res.exists():
                res.write_text(json.dumps(TEMPLATE, indent=2))
    print(f"Created run folders under {RUNS / model / mode}")


def summary(runs_dir=None):
    root = Path(runs_dir) if runs_dir else RUNS
    rows = {}
    for res in root.glob("*/*/*/*/RESULT.json"):
        model, mode = res.parts[-5], res.parts[-4]
        data = json.loads(res.read_text())
        if data["criteria_passed"] is None:
            continue
        rows.setdefault((model, mode), []).append(data)
    print("| Model | Mode | Runs | First-run pass rate | Mean criteria | Median follow-ups | Mean tokens |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for (model, mode), runs in sorted(rows.items()):
        n = len(runs)
        perfect = sum(1 for r in runs if r["criteria_passed"] == 10 and (r["follow_up_prompts_needed"] or 0) == 0)
        mean_c = statistics.mean(r["criteria_passed"] for r in runs)
        # ">X" lower bounds (SCORING.md) count as X; the median is footnoted when any entry is a lower bound
        fu_raw = [r["follow_up_prompts_needed"] for r in runs if r["follow_up_prompts_needed"] is not None]
        fu = [float(str(v).lstrip(">")) for v in fu_raw]
        censored = any(str(v).startswith(">") for v in fu_raw)
        tok = [r["tokens_used"] for r in runs if r["tokens_used"] is not None]
        med = f"{statistics.median(fu):g}" + ("+" if censored else "") if fu else "n/a"
        print(f"| {model} | {mode} | {n} | {perfect}/{n} | {mean_c:.1f} | {med} | "
              f"{round(statistics.mean(tok)) if tok else 'n/a'} |")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("init")
    a.add_argument("--model", required=True)
    a.add_argument("--mode", choices=["baseline", "skill"], required=True)
    a.add_argument("--repeats", type=int, default=2)
    s = sub.add_parser("summary")
    s.add_argument("--runs-dir", default=None, help="alternate run tree (default benchmark/runs)")
    args = p.parse_args()
    if args.cmd == "init":
        init(args.model, args.mode, args.repeats)
    else:
        summary(args.runs_dir)
