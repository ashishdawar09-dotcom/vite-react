# Changes Summary — Hardening for 500-User Tournament

This document summarizes the changes applied autonomously based on the
solutions architect / product manager / engineering manager reviews.

## ⚠️ ONE MANUAL STEP REQUIRED

You must apply the SQL migration before any of the new RPCs are usable:

1. Open Supabase SQL Editor (your project)
2. Paste and run the contents of `supabase/schema_v6_perf_safety.sql`
3. The script is **idempotent** — safe to run multiple times

Until you do this, the code automatically falls back to the old non-atomic
paths so nothing breaks; you just don't get the safety guarantees yet.

---

## What Changed

### Database (`supabase/schema_v6_perf_safety.sql` — NEW)
- **6 composite indexes** for hot read paths (matches by status / court / scheduled / category)
- **4 atomic RPCs**:
  - `extend_match` — race-free +N min
  - `start_match_on_court` — locks court, returns false if occupied
  - `swap_match_queue_positions` — atomic swap
  - `set_player_categories` — atomic delete+insert
- **`live_snapshot(tid)` RPC** — single round-trip server-side aggregation for spectators
- **`tournament_admins` table + updated `is_admin()`** — multi-admin support without code changes
- **`match_audit_log` + trigger** — captures every score/status/winner change with the JWT email of the actor

### Resilience (`src/lib/`)
- **`supabase.ts`** — global fetch wrapper: 3 attempts, exponential backoff on 408/429/5xx, 15s timeout
- **`retry.ts`** — `withRetry`/`retried` helpers for arbitrary code paths
- **Multi-admin** — `VITE_ADMIN_EMAILS` (comma-separated). Falls back to `VITE_ADMIN_EMAIL` for backwards compat

### Read path optimization (`src/hooks/useTournamentData.ts`)
- Spectators now hit a single `live_snapshot` RPC every 5s instead of 5 parallel SELECTs
- Polling **pauses while the tab is hidden** (visibilitychange listener) — saves bandwidth
- Auto-fallback to legacy multi-fetch if RPC isn't deployed yet

### Atomic mutations (`src/lib/db.ts`)
- `extendMatch`, `swapMatchQueuePositions`, `setPlayerCategories`, `startMatchOnCourt` now call RPCs
- `startMatchOnCourt` now returns `boolean` — false if court was already occupied. Callers in `App.tsx` and `MatchesTab.tsx` show a toast if false
- New: `liveSnapshot()`, `listMatchAudit()`

### UX (`src/components/`)
- **`Toast.tsx`** — toast provider + global `toast()` shim. Replaces `alert()` everywhere
- **`ErrorBoundary.tsx`** — full-app error boundary with Reload/Dismiss
- **Search box on Live tab** — type a player or team name to filter live / upcoming / recent matches. Shows match count
- All 12 `alert()` calls across `App.tsx`, `CategoriesTab.tsx`, `CategoryEditor.tsx`, `MatchesTab.tsx` replaced with `toast()`

### Tooling
- **`vitest`** installed; `npm test` runs unit tests
- **`src/lib/standings.ts`** — extracted pure standings-calc function
- **`src/lib/__tests__/standings.test.ts`** — 4 tests covering all-wins, tie-breaking, byes/unconfirmed, score accumulation. All passing
- **`.github/workflows/ci.yml`** — type-check + lint + test + build on every PR/push
- **`ARCHITECTURE.md`** — onboarding doc

---

## Build Output (verified)

```
dist/index.html                             1.02 kB │ gzip:  0.49 kB
dist/assets/CategoriesTab-CKVRsOXy.js      10.68 kB │ gzip:  3.24 kB  (lazy, admin-only)
dist/assets/MatchesTab-B415kylH.js         15.38 kB │ gzip:  4.48 kB  (lazy, admin-only)
dist/assets/index-B9X8WwaW.js             103.28 kB │ gzip: 25.63 kB
dist/assets/react-vendor-DaSoaILB.js      189.63 kB │ gzip: 59.64 kB
dist/assets/supabase-BIbyWNzi.js          195.90 kB │ gzip: 49.89 kB
```

Spectator first-load: ~135 KB gzipped. Repeat visits: ~26 KB (vendor chunks cache).

## Verification

- ✅ `npx tsc --noEmit` — clean
- ✅ `npx vitest run` — 4/4 passing
- ✅ `npx vite build` — succeeds in 1.55s

---

## Next Manual Steps for You

1. **Run the SQL migration** (`schema_v6_perf_safety.sql`) — required to activate RPCs / indexes / audit log
2. **Set `VITE_ADMIN_EMAILS`** in Netlify + Vercel env (e.g., `you@x.com,backup-admin@y.com`)
3. **Add backup admins to the table** (one-time SQL):
   ```sql
   INSERT INTO tournament_admins (email) VALUES ('backup-admin@y.com');
   ```
4. **Push to git** — CI will run automatically; first run takes ~3 min
5. **Re-deploy** Netlify and Vercel to get the new bundles

## What's Still Pending (Out of Scope for Today)

- Refactor `App.tsx` (1100 lines) into feature modules — biggest remaining tech debt
- Extract `useScheduling` cost analysis (recomputes O(M×C) per render)
- Mobile responsiveness pass
- CSV bulk player import
- Player check-in screen
- Print-friendly bracket
- ESLint strictening (`noImplicitAny`)
- Sentry integration
- Tailwind / design-tokens migration to replace 210+ inline styles

These can be done in a follow-up sprint.
