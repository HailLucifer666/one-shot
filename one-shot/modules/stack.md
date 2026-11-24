# Stack Pack (Live Registry Lookup & Breaking-Change Traps)

Load when choosing dependencies. If the user specified a stack, use it unchanged.

## Rules

1. **Never Trust Memory for Versions — Query the Live Registry:**
   - Before pinning any package, verify the current stable version with a live command (`npm view <pkg> version`, `pip index versions <pkg>`, `cargo search <pkg> --limit 1`) and record the exact version in `one-shot-work/contract.json` `assumptions`.
   - Never copy stale hardcoded version lists from prompt memory.
2. **Major-Version Breaking-Change Trap Check:**
   - Whenever a queried package is on a newer major version than expected (e.g., Tailwind v4 vs v3, Zod v4 vs v3, Next.js App Router vs Pages, ESLint flat config vs `.eslintrc`), inspect its installed README/types or run a quick smoke check before writing code.
   - Check peer dependency compatibility before committing to a combination.
3. **Prefer Boring, Typed, Zero-or-Minimal Dependencies:**
   - Reach for platform/stdlib built-ins first (Node 20 `node:test`/`fetch`, Python stdlib, native SQLite) when the spec does not require a framework.
   - Prefer typed languages (TypeScript strict, typed Python) to catch interface drift before runtime.
   - Never hand-roll auth, session signing, or cryptography.
   - Verify package ecosystem names (e.g., `fastapi` is PyPI-only; the npm package with that name is unrelated).
4. **Simplest Deployable Architecture:**
   - Default to a single deployable process + SQLite/PostgreSQL. Add queues, caches, or microservices only when an explicit requirement demands them.
