# Spec 06: Calculator

Build a browser calculator as a single HTML file for "LedgerCalc", a quick check-math tool accounting students keep open while studying. Vanilla HTML/CSS/JavaScript only, everything in one `index.html` file. No backend, no frameworks, no external files, no CDN links — it must work offline straight from the file.

## Requirements

- One `index.html` containing all CSS and JavaScript inline. No other files, no libraries, no network requests of any kind.
- Buttons for: digits 0–9, + − × ÷, decimal point, =, C (all clear), ⌫ (backspace), ± (sign toggle), % (percent).
- Full keyboard support: digits, + - * /, Enter (equals), Escape (all clear), Backspace, and "." for decimals.
- The display shows the running expression while it is being typed and the result after =.
- The layout must work at 360px width (phone) with no horizontal scrolling.

## Acceptance criteria (yes or no)

1. Is the entire app one `index.html` file with all CSS and JS inline — no external stylesheets, scripts, CDN links, or imports?
2. Does the source contain no `eval(...)`, no `new Function(...)`, and no other dynamic code execution — the arithmetic is computed by parsing code you wrote yourself?
3. Does operator precedence work correctly, so that `2 + 3 × 4 =` gives `14` (not `20`)?
4. Does `0.1 + 0.2 =` display exactly `0.3`, with no floating-point garbage (like 0.30000000000000004) in any displayed result?
5. Does `5 ÷ 0 =` produce a clear error state (such as "Cannot divide by zero") that C recovers from — not `Infinity`, not a frozen or blank app?
6. Does the % key apply percent-of semantics, so that `200 + 10 % =` gives `220` (10 percent of 200 added to 200) and `50 % =` alone gives `0.5`?
7. Does C reset everything (expression, result, error state), does ⌫ remove only the last character, and does ± flip the sign of the current number?
8. Is there a history tape showing at least the last 3 completed calculations (expression = result), which updates after each press of =?
9. At 360px width, is there no horizontal scrolling, are all buttons visible and tappable, and does Tab move focus through the buttons in reading order with a visible focus indicator?
10. During a normal sequence (type an expression, press =, press C, press ⌫), does the browser console stay free of errors?
