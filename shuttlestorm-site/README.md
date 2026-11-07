# Shuttle Storm website

The public marketing site at https://shuttlestorm.adawar.org: home page plus
`/about`, `/founders`, `/sponsors`, `/categories`, `/register`, `/venue`,
`/faq`, `/rules`, `/waiver` and `/privacy`. Plain static HTML and CSS, no build
step. Registration itself lives in the main app (badminton.adawar.org).

- Pages: `public/*.html`. Subpages share `public/page.css` and one header nav
  and footer, so a nav or footer change goes in every page.
- Phone/tablet menu: `public/menu.js` builds the full-screen menu from its own
  link list, opened by the `data-menu-toggle` button in each header. Add new
  pages to that list too.
- WhatsApp chat button: `public/chat.js`, loaded on every page right after
  `menu.js` (a new page needs that `<script>` line too). The round button
  opens a small card, and the card opens WhatsApp to the club number with a
  question started; the directors answer from the club's WhatsApp. It counts
  opens and chats in Google Analytics only (no Meta event, as the privacy
  page promises). The registration app shows the same button on its success
  screen (`src/features/publicRegistration/ChatWithUs.tsx`).
- Cloudflare Web Analytics: one `<script type='module' …beacon.min.js>` line,
  with the site's public token, right after the `chat.js` line on every page
  (a new page needs it too). It sets no cookies and only counts browsers that
  run the page, so bots mostly drop out. The CSP allows it
  (`https://static.cloudflareinsights.com` in `script-src`,
  `https://cloudflareinsights.com` in `connect-src`), and the privacy page
  lists it. The numbers are in the Cloudflare dashboard under Analytics → Web
  analytics.
- Live visitor count: `public/live.js`, loaded on every page right after the
  Web Analytics line (a new page needs it too). While a page is open it
  tells the tournament app which page it is and whether it's on screen
  (after load, every 30 s on screen, on going to the background, and "bye"
  on leaving), through Supabase Realtime's broadcast API with the app's
  public key. No cookie, nothing stored. The directors see "N people on the
  website right now" at the top of the app's Players tab. The message format
  matches the app's `src/lib/liveVisitors.ts`; the CSP allows
  `https://wdqooznwzesmjdvlcrxw.supabase.co` in `connect-src`, and the
  privacy page lists it.
- Security headers and CSP: `public/_headers`. `connect-src` must list bare
  `https://analytics.google.com` or GA4 hits are blocked.
- Sitemap: `public/sitemap.xml`. Add new pages there.

## Deploy

Cloudflare Worker static assets (no Worker code), custom domain
`shuttlestorm.adawar.org`:

```bash
npx -y wrangler@4 deploy
```

Then tell Bing and other IndexNow engines what changed:

```bash
./indexnow.sh            # every URL in public/sitemap.xml
./indexnow.sh /sponsors  # or just the paths you changed
```

The IndexNow key in `.indexnow-key` is public by design; it is also served at
`/<key>.txt`.

## Local preview

```bash
npx -y wrangler@4 dev --port 8788
```

`wrangler dev` applies `_headers`, so the CSP matches production.

## Provenance

Built outside git in `~/Developer/shuttlestorm-site` and copied here on
2026-10-17, matching Cloudflare version `3552e5b7`. Last synced with
Cloudflare version `b2bd5338` (Cloudflare Web Analytics, 2026-11-04).
