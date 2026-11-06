# Spec 08: Expense splitter

Build a tiny expense-splitting app for a group trip, called "SplitBird". Two parts: a small API server and a one-page frontend it serves. Node.js (built-in `http` or Express) or Python (FastAPI/Flask) — your choice. Data lives in a local SQLite database or a JSON file. No authentication, no external database, no network calls to anything outside the app.

## Requirements

- API endpoints:
  - `POST /expenses` — body `{ "payer": "<name>", "amount": <number>, "currency": "USD" | "EUR" | "INR", "description": "<text>", "date": "YYYY-MM-DD" }`. Invalid input returns HTTP 400 with a JSON body naming the field and the reason — never a 500.
  - `GET /expenses` — all expenses, newest first.
  - `GET /balances` — per-person totals **per currency** (currencies are never merged).
  - `POST /settle` — the minimal set of transfers that settles all debts, **per currency**, amounts rounded to 2 decimals.
- One static page served by the server: the expense list, the balances, and a form to add an expense (no page reload on submit).
- At least 8 automated API tests, all passing with one command (`npm test` or `pytest`), with no internet access and no API keys.
- `README.md` gives the exact commands to install (if anything), test, and run.

## Acceptance criteria (yes or no)

1. Does the server, the frontend, and the test suite exist, and does `README.md` give the exact commands to run the tests and start the server?
2. Do all four endpoints respond as specified, with invalid input (negative amount, unknown currency, empty payer, malformed JSON) returning HTTP 400 with a reason in the body — never a 500?
3. Are balances computed per currency? Adding "A paid 100 USD" and "B paid 100 EUR" must produce separate USD and EUR figures — never a combined 200.
4. With A paid 90, B paid 30, C paid 0 (equal three-way split, one currency), does `POST /settle` return exactly the minimal transfers — A receives 30, B pays A 10, C pays A 20 (or an equivalent minimal set) — with 2-decimal amounts?
5. Are there at least 8 automated API tests, all green via the README command, and do they pass with no internet connection and no API keys?
6. Does the server source contain no calls to external hosts, no hardcoded API keys, and no tokens?
7. Does the frontend form add an expense that appears in the list immediately without a page reload, and is the page usable at 360px width with no horizontal scrolling?
8. Does the data survive a full server stop and restart — expenses added before the restart are still there afterward?
9. Does every error path respond with a useful message (no unhandled exception trace sent to the client), and does the server console stay free of unhandled errors during a normal add → list → balances → settle flow?
10. Are amounts handled as exact decimals throughout — no floating-point drift (like 0.30000000000000004) visible in any balance or transfer?
