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
import argparse, json, os, statistics, sys, time, urllib.error, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).parent
RUNS = ROOT / "runs"
TEMPLATE = {"criteria_passed": None, "follow_up_prompts_needed": None, "tokens_used": None, "notes": ""}

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


def summary(runs_dir=None):
    root = Path(runs_dir) if runs_dir else RUNS
    rows = {}
    for res in root.glob("*/*/*/*/RESULT.json"):
        model, mode = res.parts[-5], res.parts[-4]
        data = json.loads(res.read_text())
        if data["criteria_passed"] is None:
            continue
        # 2026-11-01 (audit B9): the sentinel gate lived only in the throwaway scoring
        # pre-pass; this summary happily counted a scored-but-unsentineled run (probed
        # with a fake row that had no run-complete.json anywhere). Gate here too.
        sentinel = res.parent / "run-complete.json"
        if not sentinel.is_file():
            continue
        if json.loads(sentinel.read_text()).get("exit") != "completed":
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
    r = sub.add_parser("run")
    r.add_argument("--model", required=True)
    r.add_argument("--mode", choices=["baseline", "skill"], required=True)
    r.add_argument("--spec", required=True, help="spec number, e.g. 01")
    s = sub.add_parser("summary")
    s.add_argument("--runs-dir", default=None, help="alternate run tree (default benchmark/runs)")
    args = p.parse_args()
    if args.cmd == "init":
        init(args.model, args.mode, args.repeats)
    elif args.cmd == "run":
        sys.exit(run(args.model, args.mode, args.spec))
    else:
        summary(args.runs_dir)
