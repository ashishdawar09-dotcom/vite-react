# 🏸 Badminton Tournament

Vite + React + Supabase. Public read-only viewer; admin signs in to manage players, teams, and scores. Realtime updates so anyone watching sees scores live.

## Setup

### 1. Run the schema in Supabase

Open Supabase Dashboard → SQL Editor → paste contents of `supabase/schema.sql` → Run.

Creates: `tournaments`, `players`, `teams`, `matches` tables, `player-photos` storage bucket, RLS policies (public read, admin-only write), realtime publication.

### 2. Local dev

```bash
npm install
npm run dev
```

Env vars in `.env.local` (gitignored):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_ADMIN_EMAIL`

### 3. Deploy to Netlify

1. Push this folder to GitHub.
2. Netlify → "Add new site" → "Import an existing project" → pick the repo.
3. Build settings auto-detected from `netlify.toml` (`npm run build` → `dist`).
4. Site settings → Environment variables, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_ADMIN_EMAIL`
5. Trigger deploy.

### 4. Configure Supabase auth redirects

Supabase Dashboard → Authentication → URL Configuration:
- **Site URL**: `https://your-site.netlify.app`
- **Additional Redirect URLs**: `https://your-site.netlify.app/**`, `http://localhost:5173/**`

## How it works

- Public visitors see current state (read-only).
- "Admin Sign In" → magic link emailed → click → authenticated.
- Postgres `is_admin()` function checks JWT email against hardcoded admin address; RLS allows writes only when matched.
- Realtime subscriptions push changes to all connected clients.
