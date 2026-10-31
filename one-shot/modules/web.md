# Web module: websites and landing pages

Load for any site, landing page, marketing page or UI-heavy output. Design decisions come before code.

## Process
1. Write the page goal in one sentence and the one action a visitor should take.
2. Define design tokens first, in one place (CSS variables or Tailwind theme): colors, type scale, spacing scale, radius, shadow.
3. Build the layout skeleton with real content, then components, then polish.
4. Run the self-review designer pass at 360, 768 and 1280 px.

## Design tokens
- Colors: one primary, one neutral scale, one accent at most. Define light and dark values if dark mode is in scope. Body text contrast at least 4.5:1.
- Type: one or two font families. A scale such as 14, 16, 20, 24, 32, 48. Body 16 px or larger, line height 1.5 to 1.7.
- Spacing: a 4 or 8 px scale only. No arbitrary pixel values.
- Never leave the browser default font or the framework default theme untouched.

## Structure of a landing page
1. Hero: headline stating the outcome, one supporting sentence, one primary button.
2. Proof: logos, numbers or a short testimonial. Only use proof the user supplied.
3. Benefits: three to five, each with a concrete result.
4. How it works: three steps.
5. Objections: FAQ or pricing clarity.
6. Final call to action, then footer.

## Anti-slop rules
- No lorem ipsum, no placeholder names, no fake statistics, no invented testimonials. Use clearly marked sample content only when the user gave none, and list it in ASSUMPTIONS.md.
- No purple-to-blue gradient by default, no emoji as icons, no stock card grid of identical boxes without a reason.
- Headlines say what the product does for whom; avoid empty words such as seamless, revolutionary, unlock.
- One primary action per screen. Secondary actions look secondary.
- Real images or none; do not hotlink random image URLs. Provide alt text.
- Keep motion subtle and respect prefers-reduced-motion.

## Required in every page
- Semantic HTML (header, main, nav, footer, one h1), labels on every input, visible focus styles.
- Viewport meta tag, responsive layout with no sideways scroll.
- Title, meta description, Open Graph tags, favicon.
- Empty, loading and error states for anything fetched.
- Images sized, compressed and lazy-loaded below the fold.

## Done when
The page meets every item above, passes the Quality section of `gate.md`, and the designer self-review found nothing left unfixed.
