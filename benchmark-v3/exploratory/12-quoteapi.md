# Spec 12: QuoteAPI

*EXPLORATORY (authored 2026-11-08, frozen before any run). Hand-scored — no checks.py scorer exists. Baseline arm = the text below verbatim; skill arm = the same text prefixed with `/one-shot ` and the A-01 folder header. Do not edit after runs begin.*

Build "QuoteAPI", a price-quoting HTTP API as a zero-dependency Node.js app: a small server using only Node's built-in `http` module. `node server.js` starts it on localhost. The single endpoint is `POST /quote`. No external packages, no install step, no database.

## The contract

- Request body is JSON: `{"items":[{"price":<number>, "qty":<integer>}, ...], "coupon":"<optional string>"}`.
- `subtotal` = sum of `price × qty` over all items.
- Coupon `SAVE10`: 10% of subtotal, capped at `500.00`.
- Coupon `BULK`: 5% of subtotal, only when the total quantity across items is 10 or more; no cap. (Below 10 total qty, `BULK` behaves as an unknown coupon.)
- The discount rounds HALF UP to 2 decimals. Half up means `2.345 → 2.35` — never banker's/half-even rounding (`2.345 → 2.34` is wrong).
- `tax` = 18% of (subtotal − discount), rounded half up to 2 decimals.
- `total` = subtotal − discount + tax, at exactly 2 decimals.
- A successful response is exactly four keys, all numbers with 2 decimals, no extra keys: `{"subtotal":…,"discount":…,"tax":…,"total":…}`.
- Errors are `400` with exactly one key: `{"error":"<key>"}`. The keys, exactly:
  - `bad_json` — the body is not parseable JSON.
  - `empty_items` — `items` is missing or an empty array.
  - `negative_qty` — any `price` is negative, or any `qty` is not a positive integer (0, negative, or fractional).
  - `unknown_coupon` — `coupon` is a string but neither `SAVE10` nor `BULK`.
  - `multiple_coupons` — `coupon` is an array, or a string containing more than one coupon name.
- Any unknown path returns `404` with exactly `{"error":"not_found"}`.

## Worked examples (the contract — responses must match these exactly)

1. `{"items":[{"price":100.00,"qty":2}]}` → `{"subtotal":200.00,"discount":0.00,"tax":36.00,"total":236.00}`
2. `{"items":[{"price":19.99,"qty":3},{"price":5.01,"qty":1}]}` → `{"subtotal":64.98,"discount":0.00,"tax":11.70,"total":76.68}`
3. `{"items":[{"price":23.45,"qty":1}],"coupon":"SAVE10"}` → `{"subtotal":23.45,"discount":2.35,"tax":3.80,"total":24.90}` — 10% of 23.45 is 2.345, which is `2.35` half UP; half-even would give 2.34 and is wrong.
4. `{"items":[{"price":3000.00,"qty":2}],"coupon":"SAVE10"}` → `{"subtotal":6000.00,"discount":500.00,"tax":990.00,"total":6490.00}` — 10% of 6000 is 600.00, capped at `500.00`.
5. `{"items":[{"price":12.00,"qty":40}],"coupon":"BULK"}` → `{"subtotal":480.00,"discount":24.00,"tax":82.08,"total":538.08}`

## Requirements

- Zero external dependencies; `node server.js` starts the API on localhost.
- The cent math must be exact — integer cents or an equivalent method; the five worked examples must come out with no floating-point drift.
- A test suite of at least 6 tests using Node's built-in test runner (`node --test`), covering the worked examples and the error keys.
- `README.md` documents the start command, the test command, and the discount/tax rules.

## Acceptance criteria (yes or no)

1. Does the app run with `node server.js` using only Node built-in modules, with `POST /quote` reachable?
2. Do worked examples 1 and 2 return status `200` with the exact four-key JSON shown? (save the curl outputs in the run folder)
3. Does worked example 3 return the exact JSON — `discount` `2.35`, not `2.34`? (save the curl output)
4. Does worked example 4 return the exact JSON — `discount` capped at `500.00`? (save the curl output)
5. Does worked example 5 return the exact JSON for `BULK`? (save the curl output)
6. Do all five error keys return `400` with exactly `{"error":"<key>"}`, and does an unknown path return `404` with exactly `{"error":"not_found"}`? (save the curl outputs)
7. Does every successful response carry exactly the four keys — no extras, none missing, all numbers at 2 decimals?
8. Does the test suite contain at least 6 `node:test` tests and pass via the README's test command? (save the test output)
9. Does `README.md` document the start command, the test command, and the discount/tax rules?
10. Does `"coupon":"SAVE10 BULK"` (two names in one string) return `multiple_coupons`, does `"coupon":["SAVE10","BULK"]` also return `multiple_coupons`, and does a `qty` of `0` return `negative_qty` — with the console staying clean throughout? (save the curl outputs)
