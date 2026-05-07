# Badminton Tournament Portal — Architecture

A short, opinionated guide to how this app is wired so a new contributor (or
Claude Code) can ramp in 10 minutes.

---

## Stack

- **Frontend:** React 19 + TypeScript + Vite 8
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime)
- **Hosting:** Netlify (primary), Vercel (mirror)

## Top-level flow

```
User → main.tsx → ErrorBoundary → ToastProvider → App.tsx
                                                    │
                                                    ├─ useAuth() ────────► Supabase Auth (magic link)
                                                    ├─ useTournamentData() ► Postgres (admin: realtime / spectator: 5s polling via live_snapshot RPC)
                                                    └─ useScheduling() ──► pure compute (matches → projected court timeline)
```

## Two read paths (critical to understand)

| Audience | Mechanism | Cost | Latency |
|----------|-----------|------|---------|
| **Admin** (one user) | Supabase realtime channel (`postgres_changes`) on 4 tables, debounced 300ms | 1 WebSocket connection | <1s |
| **Spectator** (many users) | `live_snapshot(p_tournament_id)` RPC polled every 5s, paused while tab hidden | 1 REST call/5s, 0 WebSockets | up to 5s |

Why split? Supabase free plan caps realtime at 200 concurrent connections.
Spectators must NOT use realtime. Polling a single aggregated RPC keeps load
on PostgREST (designed for high concurrency) instead of replication slots.

## Write path

All mutations go through `src/lib/db.ts`. The hot/race-prone ones are now
**atomic Postgres RPCs** (see `supabase/schema_v6_perf_safety.sql`):

| Function | RPC name | Why atomic |
|----------|----------|------------|
| `extendMatch` | `extend_match` | Prevents lost-update on concurrent +5 min taps |
| `startMatchOnCourt` | `start_match_on_court` | Prevents two matches landing on same court |
| `swapMatchQueuePositions` | `swap_match_queue_positions` | Prevents partial swap on row-level error |
| `setPlayerCategories` | `set_player_categories` | Replaces non-atomic delete+insert |

Each db.ts wrapper falls back to the legacy non-atomic implementation when
the RPC isn't deployed (PGRST202), so the app keeps working during migration
windows.

## Resilience

- `src/lib/supabase.ts` wraps the global `fetch` with retry on 408/429/5xx
  + 15s timeout + 3 attempts (exponential backoff).
- `src/lib/retry.ts` exposes `withRetry` / `retried` for arbitrary callers.
- `useTournamentData` keeps last-good state on snapshot failure; retries
  next tick.
- `<ErrorBoundary>` wraps the entire app (`main.tsx`).

## Auth

`src/hooks/useAuth.ts` reads the Supabase session. `isAdmin` is true if the
JWT email is in `VITE_ADMIN_EMAILS` (comma-separated). Server-side, the
`is_admin()` Postgres function consults the `tournament_admins` table via
RLS — adding an admin = `INSERT INTO tournament_admins (email) VALUES (...)`.

Client-side `isAdmin` only gates UI. RLS policies enforce admin-only writes
on the server, so even a tampered client can't write.

## State

- All app state lives in **App.tsx** (~13 useState hooks). Derived state via
  `useMemo` recomputes on data changes.
- Known debt: App.tsx is 1100+ lines; should be sliced into feature modules.

## Audit log

Every UPDATE/INSERT/DELETE on `matches` writes a row to `match_audit_log`
via the `trg_match_audit` trigger (schema_v6). Captures the JWT email of
the actor, before/after JSON, and the changed field list. Read with
`db.listMatchAudit(matchId)`.

## Migrations

SQL files in `supabase/`. Apply manually via the Supabase SQL editor in
order. v6 (`schema_v6_perf_safety.sql`) is idempotent; safe to re-run.

Roadmap: move to `supabase/migrations/<timestamp>_<name>.sql` and apply
via `supabase db push` from CI.

## Build splits

`vite.config.ts` chunks:
- `react-vendor` (~190 KB) — react + react-dom
- `supabase` (~196 KB) — @supabase/supabase-js
- `index` (~96 KB) — app code
- `MatchesTab` / `CategoriesTab` — admin-only, lazy-loaded

Spectators only download `index + react-vendor + supabase + LiveTab`. The
Categories/Matches admin UIs never load for non-admins.

## Caching

- `netlify.toml` and `vercel.json` set `Cache-Control: public, max-age=31536000, immutable`
  on `/assets/*` (Vite hashes filenames). HTML stays uncached.

## Testing

- `vitest` for unit tests (`npm test`).
- Critical-path test: `src/lib/__tests__/standings.test.ts`.
- Roadmap: tests for `useScheduling`, bracket generation.

## CI

`.github/workflows/ci.yml` runs on every PR + push to main:
- type-check (`tsc --noEmit`)
- lint
- test
- build (with stub env vars)
- uploads `dist/` artifact

## Files you will touch most often

| File | Purpose |
|------|---------|
| `src/App.tsx` | Wiring + tab switching + admin handlers |
| `src/lib/db.ts` | Every server interaction |
| `src/hooks/useTournamentData.ts` | Read paths (admin realtime / spectator polling) |
| `src/hooks/useScheduling.ts` | Court queue + projected timeline (pure) |
| `src/components/LiveTab.tsx` | Spectator default view |
| `src/components/MatchesTab.tsx` | Admin scoring grid |
| `supabase/schema_v6_perf_safety.sql` | Latest server-side functions/indexes |
