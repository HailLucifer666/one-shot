# Intake question sets

Ask only what the provided files do not already answer. One round, batched. For anything the user
does not answer, apply the stated default, log it in ASSUMPTIONS.md, and continue. If no user is
reachable, do not ask: apply the defaults, record them in BLOCKERS.md, and surface them at the top
of the final report.

## Website or landing page
1. Business name and what it offers, in one line. (default: a plain placeholder name, marked as such)
2. Sections wanted. (default: hero, features or menu, about, contact)
3. Colors, fonts or existing brand assets. (default: one accent color chosen to fit the business)
4. Real content: prices, address, hours, text. (default: clearly marked sample content, listed in ASSUMPTIONS.md)
5. Where it will live. (default: static files that open by double-click and work on any static host)

## App, API or backend
1. Who uses it, and the one job it must do first. (default: single user, no roles)
2. Data: the entities and the fields that matter. (default: derived from the requested features)
3. Auth needed? (default: none for a local tool; email and password when several users exist)
4. Where it runs. (default: one process, SQLite or in-memory storage)
5. What done looks like. (default: the spec's acceptance criteria, all met)

## Full stack
Ask the app set, plus:
6. Hosting target. (default: one host, a single deployable)

## Slide deck or document
1. Audience, and the one action to take afterwards. (default: internal briefing, no follow-up action)
2. Length. (default: 8 slides, or 2 pages for a document)
3. Real facts or a framework to fill later. (default: framework with clearly marked placeholders, listed in ASSUMPTIONS.md)

## Game
1. The core loop in one sentence. (default: the simplest loop that satisfies the spec)
2. Keyboard, touch, or both. (default: both)
3. Art style. (default: simple shapes, no external assets)

## Media or anything else
Ask: audience, format, length, where it will be used. (default: taken from the spec's acceptance criteria)
