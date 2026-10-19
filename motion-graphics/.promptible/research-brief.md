# Research brief — Shuttle Storm ’26 categories promo

## Product or concept

Shuttle Storm ’26, the Shuttle Storm Badminton Club tournament in Abbotsford, BC on Saturday, November 21, 2026. The beat: one tap on "Categories" in the site's real phone menu opens the eleven event categories, juniors to masters, and entries close 11:59 pm, Wednesday, November 18, 2026. Every claim comes from the club's own published site source in this repository (`shuttlestorm-site/public/`), deployed at https://shuttlestorm.adawar.org/.

Revision note: an earlier concept tapped the home page "Register now" button, which on the real site opens the external registration form (badminton.adawar.org/register/…), not /categories. That implied a navigation that does not exist, so the action is now the menu link "05 Categories", whose real href is `/categories` (menu.js LINKS list).

## Authoritative sources

- https://shuttlestorm.adawar.org/ — the phone menu (menu.js): "05 Categories" → /categories.
- https://shuttlestorm.adawar.org/categories — the eleven-row category table (group, ages, entry fee).
- https://shuttlestorm.adawar.org/register — "Entries close 11:59 pm, Wednesday, November 18, 2026".

Surfaces are real phone-width (430 CSS px, 3x) screenshots of those exact pages rendered from the repository source with Playwright: the open menu (`site-menu.png`), the full categories page (`site-categories.png`) and the register page (`site-register.png`). The mark is the site's own `favicon.svg`, copied byte for byte. Element positions (menu link, each table row, the deadline lines) were measured from the live DOM.

## Real visual language

The site is near-black ink (#06080D) with bone text (#ECEEF2), a single flat volt accent (#D4FF3A), wide uppercase Archivo display type and JetBrains Mono eyebrow labels. The phone menu is a numbered list of large uppercase links. The categories page is a plain ruled table with eleven rows. The video world uses the locked warm-light fallback (the user delegated the surface choice): warm off-white paper, dark ink, neutral shadows, with the dark site screens as authentic objects inside it and volt only as a flat marker that already belongs to the brand.

## Closest approved mechanism

`tsenta-one-click-wall`: open tight on one authentic product action; the tap causes the state change (the menu navigates to /categories); then a pullback reveals the scale of what it opened: the eleven real table rows lift out of the phone and regroup into a frame-filling wall (Juniors, Youth, Adults, Masters), as the tsenta clip ends on a wall of real cards.

## Motion plan

Open tight on the real "05 CATEGORIES" link in the phone menu. A flat fingertip touch mark lands on it and the site's own :active state turns the text volt (menu.js `.ss-menu-list a:active{color:#D4FF3A}`); then a clean cut to /categories, which scrolls to its table while the camera eases out. A fast (~0.9 s) flat volt bar marks each of the eleven rows beside the text, with a tabular counter 01→11. The rows then lift out of the page together, keeping their proportions (no clipping or overlap), and scale up into a frame-filling wall separated by the page's own Group column (Juniors, Youth, Adults, Masters). They stay authentic screenshot crops throughout, never re-typed, while the emptied phone drops away and the marker bars retract. The lockup (site brand style: 600, 125% wide, .14em) slides into the top edge and the register page's own deadline line (scaled crop) slides up from the bottom; a flat volt underline draws under it. All cards move fully opaque. Stable end hold of about 2.3 s.

## Avoid

No invented UI, prices, ranks, spots-left counters or urgency claims, and no implied navigation the site does not perform. No neon, glow, colored shadows, gradients or glass. No dark void (warm light world). No decorative particles or whips. No narration captions. Do not recolor or redraw the Shuttle Storm mark.
