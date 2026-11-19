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

## Winners photos

The desk page has a second tab, **Winners photos**: every event of the
tournament, its champions once the final is confirmed, and one photo of the
winners with their prizes (add, replace, remove). A photo may be added before
the final is entered; it shows publicly only once the event has a champion.

- Stored at `player-photos/winners/<tournament>/<event>/<time>.jpg`, one row
  per event in `category_winner_photos` (public read, written by the
  `volunteer-desk` function only). Migration `20261120120000_winner_photos.sql`.
- The live app shows it under the champion card
  (`src/features/champions/ChampionCard.tsx`) on the Knockout tab, and on the
  Groups tab for a round-robin-only event.
- The Shuttle Storm website's `/champions` page reads the public
  `winners-feed` function (`supabase/functions/winners-feed/`): champion
  names and the winners photo per event. Players' profile pictures are not in
  that feed: they were agreed for the app and the hall TV, not the website.
- Who won is worked out in `supabase/functions/volunteer-desk/champions.ts`,
  following the app's results page: the confirmed Final, or for a
  round-robin-only event the clear winner on wins (ties are left undecided
  there; the app's own tie rules decide them).

## Organizer screen

`https://desk.adawar.org/organizer` (`public/organizer.html`). An organizer
signs in with the same email code as the app, then:

- invites a volunteer by name and email (the volunteer gets their link by
  email; it is also shown once on screen to copy);
- sees every volunteer link, whether it has been opened, and what it did;
- switches a link off or back on, changes its hours, or sends a new link
  (the old one stops working).

It talks to the `volunteer-desk-admin` function
(`supabase/functions/volunteer-desk-admin/`), which checks the sign-in
against `tournament_admins` the way the app's admin functions do. Hours are
entered and shown in BC time (UTC-7 all year), whatever the device's clock.

The emailed link carries the key as `?k=` (it survives the mail service's
click redirect); the copied link uses `#k=`. The page accepts both and takes
the key out of the address bar at once.

## Links by hand

The organizer screen is the normal way. `links.mjs` still works for making a
link without an email:


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

1. `supabase db push` (the two `*_volunteer_desk*` / `*_desk_link_invites*` migrations).
2. `supabase functions deploy volunteer-desk`, `volunteer-desk-admin` and `winners-feed`.
3. From this folder: `npx wrangler@4 deploy`.

The function allows the page's address in `DESK_ORIGIN` (default
`https://desk.adawar.org`). If the page moves, set that secret, and update
the two Supabase addresses in `public/_headers` and `public/config.js` if the
project changes.

## Tests

- `npx -y deno test supabase/functions/volunteer-desk/ supabase/functions/volunteer-desk-admin/` (rules, including who the champion is; no network).
- Server and browser runs against the scratch project: see the kit in
  `Code Claude/volunteer-desk-kit/`.
