// Mock LLM for H4. Contract: complete({ system, user }) -> Promise<string>.
// It logs every call as one JSON line in llm-calls.log (current working directory).
// If the user text contains RENDER-TEST it returns hostile HTML to test output escaping.
import fs from "node:fs";

export async function complete({ system = "", user = "" } = {}) {
  fs.appendFileSync("llm-calls.log", JSON.stringify({ system, user }) + "\n");
  if (user.includes("RENDER-TEST")) {
    return '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
  }
  return "Summary: " + user.replace(/\s+/g, " ").slice(0, 120);
}
