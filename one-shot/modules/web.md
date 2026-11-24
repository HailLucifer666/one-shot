# Web UI Pack (Adversarial Visual & Runtime Traps)

Load for any website, landing page, or frontend UI. Focus on the runtime and visual defects that fail human inspection.

## Mandatory Checks (verify live, never eyeball)

1. **Zero Horizontal Overflow at 360px / 768px / 1280px:**
   - Assert `document.documentElement.scrollWidth <= document.documentElement.clientWidth` at all three widths.
   - Common culprits: fixed-width cards, unbreakable long URLs/tables, negative margins, oversized hero headings.
2. **Computed WCAG AA Contrast (>= 4.5:1 body, >= 3:1 large text):**
   - Compute actual contrast ratios between foreground and background tokens — do not guess. Brand accent colors often fail on white or dark surfaces and need a darkened/lightened text variant.
3. **Zero Dead Clicks & Keyboard Reachability:**
   - Every visible button, link, tab, and form control must either perform a real action or not exist. No `href="#"` stubs or unwired `onClick={() => {}}`.
   - Every input has an explicit `<label>`; interactive elements have visible `:focus-visible` outlines and logical Tab order.
4. **Zero Console & Network Errors:**
   - Exercise the primary user flow (load, interact, submit, empty/error states) and assert 0 `console.error`, 0 uncaught `pageerror`, and 0 failed asset requests (404 images/fonts/scripts).
5. **No Placeholder Slop in Visible DOM:**
   - No `lorem ipsum`, fake stats, unrequested testimonials, emoji-as-icons, or raw unstyled browser defaults.
   - If the user supplied no real copy, mark sample content clearly and log it in `contract.json` `assumptions`.
6. **Semantic & Metadata Minimum:**
   - Exactly one `<h1>`, semantic landmarks (`header`, `main`, `footer`), `<meta name="viewport">`, `<title>`, `<meta name="description">`, `alt` on every `<img>`.
