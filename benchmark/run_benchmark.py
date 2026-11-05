#!/usr/bin/env python3
"""Scaffold benchmark runs, send one spec to a model, and summarise results.

  python benchmark/run_benchmark.py init --model glm-5.3-flash --mode baseline
  python benchmark/run_benchmark.py run --model gpt-5.5 --mode baseline --spec 01
  python benchmark/run_benchmark.py summary

`run` sends the fixed grading prompt for one spec through the Respan hosted gateway
(https://api.respan.ai/api) and records the reply and its token usage in the run
folder's run-output.json, so tokens are measured instead of copied from a tool's
display. It needs RESPAN_API_KEY in the environment; the other subcommands work
without it.
"""
import argparse, json, os, re, statistics, sys, time, urllib.error, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).parent
RUNS = ROOT / "runs"
TEMPLATE = {"criteria_passed": None, "follow_up_prompts_needed": None, "tokens_used": None, "notes": ""}

CRITERIA_TOTAL = 10   # every spec carries 10 criteria; single point to change (2026-11-05 audit)

PROMPT_PREFIX = "Build this. Here is the spec:\n\n"   # SCORING.md: the one prompt, verbatim


def setting(name):
    """Value for name from the environment, else from .env beside the repo root."""
    value = os.environ.get(name)
    if value:
        return value
    env_file = ROOT.parent / ".env"
    for line in env_file.read_text().splitlines() if env_file.is_file() else []:
        key, _, raw = line.partition("=")
        if key.strip() == name:
            return raw.strip().strip("\"'") or None
    return None


def gateway_url():
    """Respan hosted gateway chat completions."""
    return "https://api.respan.ai/api/chat/completions"


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


def call_gateway(model, prompt, key):
    """Send the prompt to the gateway; return (reply text, usage, gateway request id)."""
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(gateway_url(), data=body, method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
        request_id = resp.headers.get("x-request-id") or resp.headers.get("x-respan-request-id")
    choices = payload.get("choices") or []
    if not choices:
        raise ValueError(f"gateway reply has no choices: {json.dumps(payload)[:300]}")
    return choices[0].get("message", {}).get("content") or "", payload.get("usage") or {}, request_id


def run(model, mode, spec_id):
    """Run one spec through the gateway and write its run-output.json events."""
    key = setting("RESPAN_API_KEY")
    if not key:
        print("RESPAN_API_KEY is not set, so nothing was sent. Export it, or add it to .env "
              "(see .env.example), then run this again.", file=sys.stderr)
        return 2
    spec = next(iter(sorted((ROOT / "specs").glob(f"{spec_id}-*.md"))), None)
    if spec is None:
        print(f"no spec file for --spec {spec_id} under {ROOT / 'specs'}", file=sys.stderr)
        return 2
    prompt = PROMPT_PREFIX + spec.read_text()
    if mode == "skill":
        prompt = "/one-shot " + prompt
    try:
        text, usage, request_id = call_gateway(model, prompt, key)
    except (urllib.error.URLError, ValueError, json.JSONDecodeError) as e:
        print(f"gateway call failed: {e}", file=sys.stderr)
        return 1
    tokens = {"input": usage.get("prompt_tokens", 0), "output": usage.get("completion_tokens", 0)}
    # Same JSONL event shape the scoring pre-pass reads: part.usage sums into tokens_used.
    event = {"type": "text", "timestamp": int(time.time() * 1000), "sessionID": f"ses_{uuid.uuid4().hex}",
             "part": {"type": "text", "model": model, "mode": mode, "spec": spec.stem, "text": text,
                      "usage": tokens, "gateway_request_id": request_id, "gateway_url": gateway_url()}}
    out_dir = RUNS / model / mode / spec.stem
    n = 1
    while (out_dir / f"run{n}" / "run-output.json").exists():
        n += 1
    out = out_dir / f"run{n}" / "run-output.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(event) + "\n")
    print(f"{out.relative_to(RUNS)}: {len(text.split())} words, "
          f"{tokens['input'] + tokens['output']} tokens, gateway request {request_id or 'unknown'}")
    return 0


def mark_complete(model, mode, spec_id, run_n, runs_dir=None):
    """Write the run-complete.json sentinel for one scored run.

    2026-11-05 (audit): nothing in the repo used to write this file - the tool
    that made the vendored sentinels was a throwaway pre-pass - so the
    documented flow (init -> run -> fill RESULT.json -> summary) printed an
    empty table with no explanation. Refuses to mark an unscored run: the
    sentinel means 'this run finished and was scored', not 'call it done'.
    Returns (path, None) on success or (None, reason).
    """
    root = Path(runs_dir) if runs_dir else RUNS
    d = root / model / mode / spec_id / f"run{run_n}"
    res = d / "RESULT.json"
    if not res.is_file():
        return None, f"no RESULT.json in {d} - nothing to mark complete"
    try:
        data = json.loads(res.read_text())
    except (json.JSONDecodeError, OSError) as e:
        return None, f"RESULT.json does not parse: {e}"
    if data.get("criteria_passed") is None:
        return None, f"RESULT.json in {d} is not scored yet (criteria_passed is null)"
    out = d / "run-complete.json"
    out.write_text(json.dumps(
        {"run": f"{model}/{mode}/{spec_id}/run{run_n}",
         "ended": time.strftime("%Y-%m-%d"), "exit": "completed"}, indent=2) + "\n")
    return out, None


def summary(runs_dir=None):
    root = Path(runs_dir) if runs_dir else RUNS
    rows, skipped, warned = {}, [], []
    for res in sorted(root.glob("*/*/*/*/RESULT.json")):
        label = "/".join(res.parts[-5:-1])
        try:
            data = json.loads(res.read_text())
        except (json.JSONDecodeError, OSError) as e:
            skipped.append(f"{label}: unreadable RESULT.json ({e.__class__.__name__})")
            continue
        if data.get("criteria_passed") is None:
            continue   # scaffolded but unscored: the normal in-progress state
        # 2026-11-01 (audit B9): the sentinel gate lived only in the throwaway scoring
        # pre-pass; this summary happily counted a scored-but-unsentineled run (probed
        # with a fake row that had no run-complete.json anywhere). Gate here too.
        # 2026-11-05 (audit): a skipped run used to vanish silently - which is exactly
        # what the documented flow produces. Every skip is now reported by name.
        sentinel = res.parent / "run-complete.json"
        if not sentinel.is_file():
            skipped.append(f"{label}: no run-complete.json (mark with `run_benchmark.py complete`)")
            continue
        try:
            exit_state = json.loads(sentinel.read_text()).get("exit")
        except (json.JSONDecodeError, OSError) as e:
            skipped.append(f"{label}: unreadable run-complete.json ({e.__class__.__name__})")
            continue
        if exit_state != "completed":
            skipped.append(f"{label}: sentinel exit is {exit_state!r}, not 'completed'")
            continue
        if not isinstance(data["criteria_passed"], (int, float)):
            skipped.append(f"{label}: criteria_passed is {data['criteria_passed']!r}, expected a number")
            continue
        fu = data.get("follow_up_prompts_needed")
        if fu is not None and not re.fullmatch(r">?\d+(\.\d+)?", str(fu)):
            skipped.append(f"{label}: follow_up_prompts_needed is {fu!r}, expected a number or '>X'")
            continue
        if data.get("tokens_used") is not None and not isinstance(data["tokens_used"], (int, float)):
            # junk token display must not erase valid criteria data: count the row,
            # exclude the value from the token mean, and say so
            warned.append(f"{label}: tokens_used is {data['tokens_used']!r} - "
                          "row counted, excluded from the token mean")
        rows.setdefault((res.parts[-5], res.parts[-4]), []).append(data)
    print("| Model | Mode | Runs | First-run pass rate | Mean criteria | Median follow-ups | Mean tokens |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for (model, mode), runs in sorted(rows.items()):
        n = len(runs)
        perfect = sum(1 for r in runs if r["criteria_passed"] == CRITERIA_TOTAL
                      and (r["follow_up_prompts_needed"] or 0) == 0)
        mean_c = statistics.mean(r["criteria_passed"] for r in runs)
        # ">X" lower bounds (SCORING.md) count as X; the median is footnoted when any entry is a lower bound
        fu_raw = [r["follow_up_prompts_needed"] for r in runs if r["follow_up_prompts_needed"] is not None]
        fu = [float(str(v).lstrip(">")) for v in fu_raw]
        censored = any(str(v).startswith(">") for v in fu_raw)
        tok = [r["tokens_used"] for r in runs if isinstance(r.get("tokens_used"), (int, float))]
        med = f"{statistics.median(fu):g}" + ("+" if censored else "") if fu else "n/a"
        print(f"| {model} | {mode} | {n} | {perfect}/{n} | {mean_c:.1f} | {med} | "
              f"{round(statistics.mean(tok)) if tok else 'n/a'} |")
    if skipped:
        print(f"\nskipped {len(skipped)} scored run(s) - not counted:")
        for s in skipped:
            print(f"  - {s}")
    if warned:
        print(f"\n{len(warned)} row(s) counted with caveats:")
        for s in warned:
            print(f"  - {s}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("init")
    a.add_argument("--model", required=True)
    a.add_argument("--mode", choices=["baseline", "skill"], required=True)
    a.add_argument("--repeats", type=int, default=2)
    r = sub.add_parser("run")
    r.add_argument("--model", required=True)
    r.add_argument("--mode", choices=["baseline", "skill"], required=True)
    r.add_argument("--spec", required=True, help="spec number, e.g. 01")
    s = sub.add_parser("summary")
    s.add_argument("--runs-dir", default=None, help="alternate run tree (default benchmark/runs)")
    c = sub.add_parser("complete", help="write the run-complete.json sentinel for a scored run")
    c.add_argument("--model", required=True)
    c.add_argument("--mode", choices=["baseline", "skill"], required=True)
    c.add_argument("--spec", required=True, help="spec number, e.g. 01")
    c.add_argument("--run", required=True, type=int, help="run number, e.g. 1")
    c.add_argument("--runs-dir", default=None)
    args = p.parse_args()
    if args.cmd == "init":
        init(args.model, args.mode, args.repeats)
    elif args.cmd == "run":
        sys.exit(run(args.model, args.mode, args.spec))
    elif args.cmd == "complete":
        path, err = mark_complete(args.model, args.mode, args.spec, args.run, args.runs_dir)
        if err:
            print(err, file=sys.stderr)
            sys.exit(1)
        print(f"marked complete: {path}")
    else:
        summary(args.runs_dir)
