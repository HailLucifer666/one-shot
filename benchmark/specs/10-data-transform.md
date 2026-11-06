# Spec 10: Data transform

Write a Python 3 command-line tool, `transform.py` — standard library only, no pip installs — that reads a messy expenses CSV and writes a strict JSON report. The input file `expenses.csv` is given at the bottom of this spec. Save it exactly as-is (UTF-8), next to your script.

## Requirements

- Usage: `python transform.py expenses.csv report.json`. On success: exit code 0 and `report.json` written. On a missing or unreadable input file: exit code 2 with a clear message on stderr naming the file.
- The CSV contains duplicate ids, mixed currencies with symbols and thousand separators, three date formats, empty fields, and invalid rows. The report must never silently invent data it does not have.
- `report.json` schema — exactly these keys, nothing more:
  - `totals_by_currency`: object mapping `"USD"` / `"EUR"` / `"INR"` → total amount as a number rounded to 2 decimals. Currencies are never summed together.
  - `rows_by_currency`: object mapping currency → count of valid rows.
  - `skipped_duplicates`: array of `{"row": <n>, "id": "<id>"}` — later rows repeating an already-seen id, numbered with header = row 1.
  - `invalid_rows`: array of `{"row": <n>, "reason": "<specific reason>"}` — rows that cannot be parsed.
  - `date_range`: `{"min": "YYYY-MM-DD", "max": "YYYY-MM-DD"}` across valid rows only.
- Amount formats: `$1,200.50` (USD), `₹45,000` (INR, Indian grouping), `1.234,56 €` (EUR, European decimal comma, symbol after the amount). Date formats: `2026-01-05`, `05/01/2026` (always DD/MM/YYYY), and `Jan 5, 2026`.
- A row is invalid if the id, amount, currency, or date is missing or unparseable (impossible dates like 2026-02-30 are invalid, not rolled over).

## Acceptance criteria (yes or no)

1. Is the tool a single `transform.py` using only the Python standard library — no pip installs, no third-party imports?
2. Does `python transform.py expenses.csv report.json` exit 0 and write `report.json`, and does a missing input file exit non-zero with a stderr message naming the file?
3. Are `totals_by_currency` correct for this exact CSV — exactly the keys USD, EUR, INR, each rounded to 2 decimals, never summed across currencies?
4. Are both duplicate-id rows skipped and listed in `skipped_duplicates` with their correct row numbers?
5. Are all invalid rows excluded from the totals and listed in `invalid_rows`, each with its row number and a specific reason — none silently dropped, none counted as valid?
6. Are all valid dates normalized to ISO 8601 (YYYY-MM-DD), with `05/01/2026` read as DD/MM (5 January) and `Jan 5, 2026` read correctly?
7. Are symbol-and-separator amounts parsed correctly — `$1,200.50` → 1200.5, `₹45,000` → 45000, `1.234,56 €` → 1234.56, `2.500,00 €` → 2500?
8. Does `report.json` contain exactly the five specified keys — nothing extra, nothing missing?
9. Does `rows_by_currency` disclose the count of valid rows per currency, and does each total equal the sum of exactly those rows?
10. Is the parsing built from explicit, readable rules (decimal-comma handling, currency-symbol mapping, date-format detection, impossible-date rejection) rather than one fragile regex?

## The input file: expenses.csv

```csv
id,date,amount,currency,description
E001,2026-01-05,"$1,200.50",USD,Conference tickets
E002,05/01/2026,"₹45,000",INR,Team offsite venue
E003,"Jan 5, 2026","1.234,56 €",EUR,Equipment deposit
E001,2026-01-07,"$300",USD,Duplicate id — skip me
E004,2026-01-08,"$99.99",USD,Books
E005,2026-01-09,"₹12,500.75",INR,Travel advance
E006,2026-01-10,"2.500,00 €",EUR,Venue catering
E007,2026-01-11,,USD,Amount is missing
E008,2026-01-12,"$150",GBP,Currency is unknown
E009,,"€780,25",EUR,Date is missing
E010,13/01/2026,"$1,000",USD,Workshop day
E010,2026-01-14,"$1,000",USD,Duplicate id — skip me too
E011,2026-01-15,"abc",USD,Amount is not a number
E012,2026-02-30,"$50",USD,Date is impossible
E013,"Jan 20, 2026","₹8,000",INR,Farewell gifts
```
