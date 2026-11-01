# Ember & Oak — coffee shop website

A single-page, zero-dependency website for Ember & Oak, the coffeehouse on
Lantern Lane in Riverton. Plain HTML, CSS and a little progressive-enhancement
JavaScript — no build step, no packages, nothing to install.

All business content (name, menu, prices, address, phone, email, hours, about
copy) comes from the owner sheet dated 2026-11-01.

## Open it

Double-click `index.html`. That is the whole setup — it works from the file
system, with or without internet (Google Fonts fall back to Georgia/system
fonts offline).

To serve it like a host would (optional):

```
python -m http.server 8080
# or: npx serve .
```

then open http://localhost:8080.

## Test it

Requires Node 18+ (no packages to install):

```
node tests/smoke.test.mjs
```

The suite serves the folder over a local HTTP server and checks: the page and
every internal asset respond, nav anchors match real ids, the six owner-sheet
menu items appear with their exact prices, the exact address, phone, email
link and hours strings are present, the about text matches the sheet word for
word, the four brand hex colors appear in the CSS, Fraunces and Inter are
named in font-family declarations, meta/OG/favicon are present, the JS parses,
and every declared text/background color pair meets WCAG AA (4.5:1) by
computed ratio.

## Deploy it

Copy the folder to any static host — GitHub Pages, Netlify, Cloudflare Pages —
as-is. There is nothing to build. `index.html` must sit at the root.

## Structure

```
index.html            the whole page (hero, about, menu, visit, footer)
css/styles.css        design tokens + all styling (colors in one :root block)
js/main.js            optional: closes the mobile menu, reveal-on-scroll, year
assets/favicon.svg    cup icon
tests/smoke.test.mjs  dependency-free acceptance test (node:test)
```

## Where the content lives

All of it is in `index.html`, sourced from the owner sheet — update text only
from the sheet:

- **Shop name** "Ember & Oak" — `<title>`, meta tags, header brand, about
  copy, footer (find-and-replace).
- **Menu** — the `#menu` section: Espresso $3.00, Flat White $4.25, Cold Brew
  $4.75, Oat Milk Latte $5.00, Almond Croissant $3.75, Cardamom Bun $3.50.
- **About copy** — the `#about` section, word for word from the sheet.
- **Address** "14 Lantern Lane, Riverton" and the directions link — `#visit`.
- **Phone** 555-0142 — header "Call for pickup" button, `#visit`, footer.
- **Email** hello@emberandoak.example — `#visit`, footer.
- **Hours** — Monday to Friday 7:00 am to 6:00 pm; Saturday and Sunday
  8:00 am to 4:00 pm — the table in `#visit`.

Colors are CSS variables at the top of `css/styles.css` (`#1E1612`,
`#3B2A20`, `#D9822B`, `#FAF5EE`); the smoke test re-checks text contrast
automatically if you change them. The typefaces (Fraunces for display,
Inter for body) load from Google Fonts.

## Notes

- The mobile menu is a pure-CSS checkbox toggle: navigation works with
  JavaScript disabled. `js/main.js` only closes the menu after a tap, adds
  reveal-on-scroll (skipped when the OS asks for reduced motion) and sets the
  footer year.
- Descriptive lines outside the sheet (hero headline, section headings,
  feature blurbs) restate only facts from the sheet; change them freely.
