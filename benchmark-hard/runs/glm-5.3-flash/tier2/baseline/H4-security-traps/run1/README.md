# RecipeBox

A community recipe board. Anyone can browse and search recipes; signed-in
members can post recipes (with an optional photo), comment, edit and delete
their own posts, and generate an AI summary of any recipe. An admin can
delete any recipe or comment.

## Stack

- Node.js (>= 18) with Express 5 and multer 2
- Storage: a JSON file (`data/db.json`) - no database server needed
- AI: the provided mock (`llm.mock.js`), called via `complete({ system, user })`.
  No other AI libraries or network calls are used.

## Run it

```bash
npm install
npm start          # serves http://localhost:3000
```

Then open http://localhost:3000 in a browser.

## Test it

```bash
npm test           # unit + integration tests (32 tests)
```

The suite boots the real app on an ephemeral port with throwaway data
directories and exercises the full HTTP surface.

## Accounts

- Register through the UI (email + password of at least 8 characters).
- On first start the app seeds an admin account:

  | email                   | password            |
  |-------------------------|---------------------|
  | `admin@recipebox.local` | `admin-password-123`|

  Override with `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment variables before
  the first start. The seed only runs while no admin exists.

## What you can do

| Action                          | Who                         |
|---------------------------------|-----------------------------|
| Browse / search recipes         | everyone                    |
| Post a recipe (title, ingredients, steps, optional JPG/PNG photo up to 2 MB) | signed-in users |
| Comment on a recipe             | signed-in users             |
| Edit a recipe                   | its owner                   |
| Delete a recipe                 | its owner or an admin       |
| Delete a comment                | its author or an admin      |
| Summarize a recipe (AI)         | signed-in users             |

Search (the box in the header, or `GET /api/recipes?q=...`) matches recipe titles
and ingredient lists, case-insensitively.

## HTTP API

| Method & path                       | Auth | Notes |
|-------------------------------------|------|-------|
| `POST /api/auth/register`           | -    | `{ email, password, displayName? }` |
| `POST /api/auth/login`              | -    | `{ email, password }` |
| `POST /api/auth/logout`             | yes  | |
| `GET /api/auth/me`                  | -    | current user or `null` |
| `GET /api/recipes?q=term`           | -    | list + search |
| `GET /api/recipes/:id`              | -    | detail incl. comments |
| `POST /api/recipes`                 | yes  | multipart form: `title`, `ingredients`, `steps`, optional `photo`; JSON without a photo also works |
| `PUT /api/recipes/:id`              | owner| same fields; omitted fields keep their values |
| `DELETE /api/recipes/:id`           | owner or admin | also removes the recipe's comments and photo |
| `POST /api/recipes/:id/summary`     | yes  | returns `{ summary }` from the mock |
| `POST /api/recipes/:id/comments`    | yes  | `{ body }` |
| `DELETE /api/comments/:id`          | author or admin | |

Sessions are carried in a `sid` cookie (HttpOnly, SameSite=Lax); passwords are
stored as salted scrypt hashes. Every state-changing request must also send
the `csrf` cookie's value in an `X-CSRF-Token` header (the browser UI does
this automatically; the cookie is issued on the first API GET, e.g.
`GET /api/auth/me`). Example with curl:

```bash
curl -c jar.txt http://localhost:3000/api/auth/me          # issues csrf cookie
curl -b jar.txt -c jar.txt -H "X-CSRF-Token: $(grep csrf jar.txt | awk '{print $7}')" \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@recipebox.local","password":"admin-password-123"}' \
     http://localhost:3000/api/auth/login
```

## Behavior notes

- Photos are validated by their actual bytes (JPEG/PNG magic numbers), not by
  filename or claimed content type; renamed scripts or SVGs are rejected.
  Stored photos keep server-generated random names and are served with
  `X-Content-Type-Options: nosniff`.
- All user-provided text (recipes, comments, and the AI summary) is rendered
  as plain text in the browser; pages are served with a strict
  `Content-Security-Policy` (`script-src 'self'`, no inline scripts).
- Ownership and admin rights are decided on the server for every request;
  roles cannot be set through the API by clients.
- Repeated failed sign-ins from one address are throttled for 15 minutes.

## Files and data

- `data/db.json` - users, sessions, recipes, comments (created at runtime)
- `uploads/` - stored photos (created at runtime)
- `llm-calls.log` - written by the provided mock for every summarize call
- `PORT`, `DATA_DIR`, `UPLOAD_DIR` environment variables move things around;
  defaults suit `npm start` from the project directory.
