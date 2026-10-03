# 🏸 Badminton Tournament

Vite + React + Supabase. Public read-only viewer; admin signs in to manage players, teams, and scores. Realtime updates so anyone watching sees scores live.

Production: https://badminton.adawar.org (Vercel project `vite-react`, deploys from `main`).

## Database

Supabase project `wdqooznwzesmjdvlcrxw`. Schema changes are migrations in
`supabase/migrations/`, tracked by the Supabase CLI:

```bash
supabase link --project-ref wdqooznwzesmjdvlcrxw
supabase migration list          # what is applied in production
supabase migration new <name>    # write a new change
supabase db push                 # apply pending migrations
```

`20261002000000_baseline.sql` is a snapshot of the live schema taken on
2 October 2026. Everything before it was applied by hand and is kept in
`supabase/legacy/` for history only — never re-run those files.

Edge Functions live in `supabase/functions/` and deploy separately:
`supabase functions deploy <name>`.

The Free plan has no Supabase backups. Before each event run
`bash scripts/backup-db.sh`; it writes every table and the player photos to
`~/Developer/badminton-backups/<timestamp>/` (private, contains contact details).

## Local dev

```bash
npm ci
npm run dev
```

Env vars in `.env.local` (gitignored), see `.env.example`:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_VOICE_WORKER_URL` (optional; voice assistant)
- `VITE_VAPID_PUBLIC_KEY`, `VITE_SENTRY_DSN` (optional)

Checks: `npm test`, `npm run lint`, `npm run build:check`.

## How it works

- Public visitors see current state (read-only).
- Admins sign in (email code or Google); `is_admin()` checks the JWT email against the `tournament_admins` table and RLS allows writes only when matched.
- Realtime subscriptions push changes to admin clients; spectators poll the `live_snapshot` RPC.
- The voice assistant is a separate Cloudflare Worker (`badminton-voice-agent`).
