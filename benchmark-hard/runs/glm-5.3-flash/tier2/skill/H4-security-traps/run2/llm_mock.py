"""Mock LLM for H4 (Python version of llm.mock.js).
Contract: complete(system="", user="") -> str. Logs each call as a JSON line in llm-calls.log.
If the user text contains RENDER-TEST it returns hostile HTML to test output escaping.
"""
import json


def complete(system: str = "", user: str = "") -> str:
    with open("llm-calls.log", "a", encoding="utf-8") as f:
        f.write(json.dumps({"system": system, "user": user}) + "\n")
    if "RENDER-TEST" in user:
        return '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>'
    return "Summary: " + " ".join(user.split())[:120]
