# Volunteer check-in desk

A small page for game-day volunteers: find a player, check them in, take
their photo. It is separate from the app and changes none of its code.

- **Page:** `public/` here, served as its own Cloudflare site (`desk.adawar.org`).
- **Service:** the `volunteer-desk` Supabase Edge Function
  (`supabase/functions/volunteer-desk/`). It is the only thing the page talks to.
- **Tables:** `desk_links` (one row per volunteer link, holding a hash of the
  link) and `desk_actions` (a log of every change), from
  `supabase/migrations/20261116120000_volunteer_desk.sql`.

The app picks the changes up by itself: check-in is `players.checked_in_at`
and the photo is `players.photo_url`, which it already reads and follows live.

## What a volunteer link can do

List the players of its tournament (name, events, partner, check-in time,
photo), check a player in or undo that, and save or undo a photo taken at the
desk. Nothing else: no emails, ages, payments, scores, draws or deletes.

A link works only between its `valid_from` and `valid_until`, and stops at
once when `revoked_at` is set.

## Links

Make links (prints each link once; only its hash is stored):

    node links.mjs --tournament <tournament id> --from "2026-11-21T07:00:00-07:00" --until "2026-11-21T22:00:00-07:00" "Priya" "Sam"

It prints the SQL to run and the link for each volunteer. Send each person
their own link.

Switch one off:

    update desk_links set revoked_at = now() where label = 'Sam';

See what was done:

    select created_at, volunteer, action, player_name from desk_actions order by id desc limit 50;

## Photos

A desk photo is stored at `player-photos/desk/<player>/<time>.jpg`. The photo
it replaced is kept, so Undo on the page puts it back and deletes the desk
photo. The volunteer ticks that the player agreed before each save; the
wording is saved with the log row.

## Deploy

1. `supabase db push` (the migration above).
2. `supabase functions deploy volunteer-desk`.
3. From this folder: `npx wrangler@4 deploy`.

The function allows the page's address in `DESK_ORIGIN` (default
`https://desk.adawar.org`). If the page moves, set that secret, and update
the two Supabase addresses in `public/_headers` and `public/config.js` if the
project changes.

## Tests

- `npx -y deno test supabase/functions/volunteer-desk/` (rules, no network).
- Server and browser runs against the scratch project: see the kit in
  `Code Claude/volunteer-desk-kit/`.
