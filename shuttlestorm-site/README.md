# Shuttle Storm website

The public marketing site at https://shuttlestorm.adawar.org: home page plus
`/about`, `/founders`, `/sponsors`, `/categories`, `/register`, `/venue`,
`/faq`, `/rules`, `/waiver` and `/privacy`. Plain static HTML and CSS, no build
step. Registration itself lives in the main app (badminton.adawar.org).

- Pages: `public/*.html`. Subpages share `public/page.css` and one header nav
  and footer, so a nav or footer change goes in every page.
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
2026-10-17, matching Cloudflare version `3552e5b7`.
