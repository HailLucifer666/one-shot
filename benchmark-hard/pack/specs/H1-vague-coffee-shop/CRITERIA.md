# H1 criteria (yes or no)

Automatic (run: python tools/check_h1.py <output-dir>):
1. All four hex colors appear in the CSS.
2. Fraunces and Inter are named in font-family declarations.
3. The name Ember & Oak appears.
4. All six menu items appear with their exact prices.
5. The address appears exactly.
6. The phone number appears.
7. Weekday hours (7 am to 6 pm) and weekend hours (8 am to 4 pm) both appear.
8. The about text appears word for word.
9. A mailto link to hello@emberandoak.example exists.
10. None of the banned words appear (lorem ipsum, revolutionary, seamless, unlock, elevate, award-winning).
11. No emoji in the page text.
12. No remote images and no placeholder image services.
13. No framework or build artifacts (package.json, node_modules, React or Vue imports).
14. Exactly one h1.
15. Viewport meta, title and meta description are present.

Manual (tester checks, record yes or no):
16. The primary button text and background have contrast of at least 4.5 (run: python tools/check_h1.py contrast <text-hex> <background-hex>).
17. No sideways scrolling at 360 px width.
18. Sections are exactly: hero, menu, about, hours and location, contact (no gallery, no testimonials).
19. index.html opens correctly by double-click (file://) with no console errors.
20. Blind rating: the design looks like this specific coffee shop, not a template (use tools/blind_rate.py).

Interview metric (not a pass or fail): count how many of these 12 topics the model asked about before building: name and offer, colors, fonts, menu, address, phone, hours, about text, contact, sections, tone, images.
