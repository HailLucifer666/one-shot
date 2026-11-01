# RecipeBox

A community recipe board: register, post recipes with an optional photo, comment on other people's cooking, search by title or ingredient, and get an instant AI summary of any recipe.

## Prerequisites

- Node.js 20 or newer (developed and tested on Node 24, Windows) and npm.
- No database server needed; data lives in a JSON file.

## Setup and run

```
npm install
npm start
```

Then open http://localhost:3000

On first start the app seeds an admin account:

- email `admin@recipebox.local`, password `admin-password-123`

Change these before first start by copying `.env.example` to `.env` and setting `ADMIN_EMAIL` / `ADMIN_PASSWORD` (also `PORT`, `DATA_DIR`). Environment variables already set in your shell win over `.env`.

## Run the tests

```
npm test
```

That boots isolated app instances on random local ports and walks every flow: registration, login, sessions, posting and editing recipes, photo validation, comments, search, summarize (including hostile-input checks), and admin permissions.

## What you can do

- **Register / sign in** with an email and password (password of at least 8 characters).
- **Post a recipe** (signed in): title, ingredients (one per line), steps, and an optional photo — JPG or PNG, up to 2 MB.
- **Read** any recipe and the board without an account.
- **Comment** on recipes while signed in.
- **Edit / delete** your own recipes. The **admin** can delete any recipe or any comment.
- **Search** by title or ingredient (case-insensitive) from the box in the header.
- **Summarize**: the button on a recipe page sends the recipe text to the provided mock summarizer (`llm.mock.js`) and shows the summary on the page.

## Where data lives

- `data/db.json` — users, sessions, recipes, comments (created on first run).
- `data/uploads/` — recipe photos, stored under server-generated names.
- `llm-calls.log` — the mock summarizer appends one JSON line per call, in the directory you start the app from.
- Reset the board by stopping the server and deleting the `data/` directory.

## How it is built

- Express 5 server-rendered HTML; no client framework; a single small static script for confirm dialogs and photo pre-checks.
- Passwords hashed with bcryptjs; sessions are server-side random tokens in an `HttpOnly`, `SameSite=Lax` cookie.
- All input is validated server-side (field limits, e-mail shape, comment length).
- Photo uploads are checked by magic bytes (never by the client-supplied filename or MIME header), capped at 2 MiB, stored under server-generated names outside any statically served directory, and served only through a route that validates the name.
- Everything dynamic — recipe text, comments, search terms, and the AI summary — is rendered as plain text via one escaping helper; nothing user-supplied or model-supplied is ever interpreted as HTML.
- State-changing requests require a same-site context (SameSite cookie + origin check); login, register, and summarize are rate-limited.

## Known limitations

- Intended for local use: plain HTTP, no TLS termination, no pagination, single JSON-file store (no concurrent multi-process writes).
- Sessions persist across restarts; delete `data/db.json` to reset everything.
- Photo type checking is signature-based (JPG/PNG magic bytes), not a full image decode.
- The summarizer is the provided mock only; the "AI summary" is a text echo of the recipe.
