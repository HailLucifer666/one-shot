# Notes App

A small note-taking app: Node.js with **zero external dependencies** (built-in
`http` module only) and a JSON file store, plus a single-page frontend in
`public/`.

## Run

    npm start

The server listens on http://localhost:3000 (override with the `PORT` env
var). No install step is needed — there is nothing to install.

## Test

    npm test

Runs the 12-test suite in `tests/` with the built-in node test runner
(`node --test`). The suite is hermetic: it points `DATA_FILE` at a fresh temp
file per test and binds the server to an ephemeral port.

## Configuration

| Env var     | Default       | Purpose                                            |
| ----------- | ------------- | -------------------------------------------------- |
| `PORT`      | `3000`        | HTTP port                                          |
| `DATA_FILE` | `./data.json` | Path to the JSON store (created on first write)    |

## API

- `GET /api/notes` — list notes grouped by calendar day:
  `[{ "date": "YYYY-MM-DD", "notes": [{ "id", "title", "body", "createdAt" }] }]`.
  Groups are sorted newest-first; notes within a group are newest-first.
- `POST /api/notes` — body `{ "title": "...", "body": "..." }`; both fields
  are required (missing/empty → `400` with a reason). An optional
  `"createdAt"` ISO timestamp lets you backfill/import notes with their
  original time — when omitted, the server uses the current time. Returns
  `201` with the created note (`{ id, title, body, createdAt }`). A
  non-string or unparseable `createdAt` → `400`.
- `DELETE /api/notes/:id` — deletes a note by id. `200` with the deleted
  note, or `404` when no note has that id.
- `GET /api/notes/search?q=...` — substring search over title and body.
  Returns a flat array of matching notes.

The store file has the shape `{ "nextId": <int>, "notes": [...] }` where
`notes` is kept in creation order (oldest first) and ids start at `0`.

## FOR THE SCORER — DO NOT SHARE WITH THE AGENT

The starter ships with exactly 3 seeded bugs. All 12 shipped tests pass on
the buggy code BY DESIGN — the tests only cover happy paths that the bugs do
not touch. The bugs:

1. **Date grouping double-shift — `dayKey()` in `server.js`.** It strips the
   `Z` off the stored UTC ISO string and re-parses the remainder as LOCAL
   time, then takes the UTC date of that shifted instant. On a UTC+5:30
   machine the stored instant is effectively shifted back two offset-widths,
   so any note created before 11:00 local gets yesterday's group key (e.g.
   `createdAt: "2026-11-07T03:30:00.000Z"` = 09:00 IST groups under
   `2026-11-06`), while afternoon notes group correctly. Correct behavior:
   extract the local calendar day of the stored instant (or use the ISO
   string's own date consistently).
2. **Case-sensitive search — `searchNotes()` in `server.js`.** It matches
   with `String.prototype.includes` on the raw strings, so `q=todo` does NOT
   find a note titled "Shopping ToDo list". Correct behavior: case-fold
   (lowercase) both the query and the fields before matching; keep it a
   partial-substring match.
3. **Delete by array index instead of id — DELETE handler in `server.js`.**
   It resolves the note as `store.notes[Number(id)]` and splices that index
   instead of `store.notes.findIndex((n) => n.id === id)`. Because ids start
   at 0 and the store array is creation-ordered and untouched, `notes[id]`
   happens to hit the right note on a fresh store — so deleting the
   first-listed (highest-id) note or id 0 on a fresh store works by accident
   and the happy-path tests pass. After ANY deletion the indices shift, so a
   second delete removes the wrong note or returns 404 for a note that is
   still listed.
