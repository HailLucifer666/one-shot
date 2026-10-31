# Stack module: choosing technology

Use when no stack is given. If the user gave a stack, use it unchanged.

## Rules
1. One choice per layer, with one line of justification in STACK.md.
2. Verify the latest stable version of every package before pinning (for example `npm view <pkg> version`, `pip index versions <pkg>`, or the official release page). Your memory of versions may be out of date, especially if you are a small or local model.
3. Prefer widely adopted tools with large ecosystems. Avoid libraries with few maintainers or under a year of history unless the user asks.
4. Prefer typed languages. Types catch model mistakes early.
5. Never hand-roll auth or cryptography.
6. Start with the simplest architecture that meets the spec (a single deployable app) and add services only when a requirement demands it.

## Defaults for web products (verified Oct 31 2026 via npm registry / postgresql.org; re-verify at build time)
| Layer | Default | Alternative |
| --- | --- | --- |
| Framework | Next.js (App Router) with React | TanStack Start, SvelteKit |
| Language | TypeScript, strict | none |
| Styling and UI | Tailwind CSS with shadcn/ui | none |
| Database | PostgreSQL (Neon or Supabase) | SQLite for tiny projects |
| ORM | Drizzle | Prisma |
| Auth | Better Auth | Clerk for drop-in UI |
| Validation, forms | Zod, React Hook Form | none |
| Data fetching and state | TanStack Query; Zustand only when needed | none |
| Payments | Stripe | none |
| Testing | Vitest, Playwright | none |
| Hosting | Vercel | Docker for self-hosting |

Verified versions Oct 31 2026: Next.js 16.4.3, React 19.3.1, Tailwind CSS 4.3.3, PostgreSQL 19, Drizzle ORM 0.45.4, Better Auth 1.7.14, Zod 4.6.7 (v4 has breaking changes from v3), TanStack Query 5.105.0, Vitest 5.0.5, Playwright 1.64.1. These go stale; rule 2 (verify before pinning) always outranks this list.

## Other output types (suggestions, adjust to the spec)
- Python API or ML service: FastAPI, Postgres, pytest (FastAPI is PyPI-only; the npm package named "fastapi" is a different, wrong package)
- Mobile app: Expo (React Native; 58.0.21 verified Oct 31 2026)
- Browser game: Phaser (4.2.1 verified Oct 31 2026), or plain canvas for small games
- Slide deck: HTML slides or python-pptx
- Static content site: Astro (7.4.4 verified Oct 31 2026)

## STACK.md must contain
Layer, choice, version verified (with date), one-line reason, and one alternative considered.
