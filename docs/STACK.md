# Stack

## For this repo
| Layer | Choice | Why |
| --- | --- | --- |
| Skill format | SKILL.md with YAML frontmatter plus markdown modules | Loads on demand; test in your own harness |
| Scripts | Bash installer; Python for benchmark and validation | Small, no build step |
| CI | GitHub Actions | Validates frontmatter, size and references |

## Default for projects the skill builds (re-verify at build time)
Next.js with React, TypeScript strict, Tailwind with shadcn/ui, PostgreSQL (Neon or Supabase), Drizzle, Better Auth, Zod with React Hook Form, TanStack Query, Stripe, Vitest and Playwright, Vercel.

Versions verified Oct 31 2026 via npm registry / postgresql.org: Next.js 16.4.3, React 19.3.1, Tailwind CSS 4.3.3, PostgreSQL 19, Drizzle ORM 0.45.4, Better Auth 1.7.14, Zod 4.6.7 (v4 has breaking changes from v3), TanStack Query 5.105.0, Vitest 5.0.5, Playwright 1.64.1, Astro 7.4.4, Expo 58.0.21, Phaser 4.2.1. FastAPI is PyPI-only: the npm package named "fastapi" (0.0.8) is a different, wrong package.

No stack is guaranteed future-proof; these are the most widely adopted picks found. The skill's rule to verify versions at build time is the product; this table is a snapshot.
