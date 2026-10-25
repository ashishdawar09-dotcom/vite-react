# Snapshot load test (U9)

Checks that race-day spectator polling holds up, and how much of it reaches
Supabase, with and without the CDN-cached `/api/snapshot` endpoint (U8).
See KTD5, the Load model, U8 and U9 in `docs/plans/race-day-2026.md`.

**Never point any of this at production** (`wdqooznwzesmjdvlcrxw`,
badminton.adawar.org). The k6 script and the writer refuse those targets.

## Files

| File | What it does |
|---|---|
| `seed.sql` | Creates the synthetic "Load Cup" (slug `loadtest`) on the scratch project: 10 categories, 63 players, 45 teams, 100 matches (80 group, 20 knockout), 4 live, 2 allocated to a court. Re-running replaces it. Synthetic names only. |
| `snapshot.k6.js` | k6 script. `TARGET=direct` POSTs the `live_snapshot` RPC (run A); `TARGET=cached` GETs `/api/snapshot` on a Vercel preview (run B). Each VU polls every `POLL_S` seconds, starting at a random offset. |
| `writer.mjs` | Bumps a score on one live match every few seconds so caches and the DB see race-day churn. |

## Environment

Credentials come only from your shell. Never commit them: the repo is public.

| Variable | Used by | Value |
|---|---|---|
| `SCRATCH_SUPABASE_URL` | k6 direct, writer | `https://<scratch-ref>.supabase.co` |
| `SCRATCH_PUBLISHABLE_KEY` | k6 direct | scratch publishable key |
| `SCRATCH_SECRET_KEY` | writer | scratch secret key (bypasses RLS) |
| `LOADTEST_TOURNAMENT_ID` | all | id of the `loadtest` tournament |
| `PREVIEW_URL` | k6 cached | `https://<preview-host>.vercel.app` |
| `VERCEL_BYPASS_TOKEN` | k6 cached | deployment-protection bypass secret |
| `VUS`, `POLL_S`, `DURATION` | k6 | defaults 225, 5, `20m` |

The Vercel preview needs branch-scoped Preview env vars `VITE_SUPABASE_URL`
and `VITE_SUPABASE_PUBLISHABLE_KEY` pointing at the scratch project (the
function reads them at runtime). Redeploy after adding them.

## Running

1. Check the scratch org's egress first. Org B also hosts Little Computer
   School production, and Free-plan restrictions are org-wide. Keep total
   load-test egress under ~1.5 GB per billing cycle.
2. Load the seed: run `seed.sql` on the scratch project (SQL editor or
   Management API). Note the tournament id it prints.
3. Start the writer, then k6:

```bash
node scripts/loadtest/writer.mjs 3 1500 &
TARGET=direct VUS=225 DURATION=4m k6 run scripts/loadtest/snapshot.k6.js
TARGET=cached VUS=225 DURATION=20m k6 run scripts/loadtest/snapshot.k6.js
```

4. Afterwards: revoke the bypass token, remove the scratch Preview env vars,
   and pause the scratch project.

Pass criteria (U9): p95 under 800 ms, error rate under 0.5 %, and in run B at
most one origin request per 2 s.

## Results

Payload at race-day size (Load Cup, 100 matches): 131 KB raw, 16.8 KB gzip,
11.6 KB brotli per snapshot.

### Run A: direct RPC (2026-10-25, scratch project, Free/Nano, us-west-2)

225 VUs polling every 5 s, writer updating a live score every 3 s
(87 writes, 0 errors), k6 v2.3.0 from a laptop in BC.

| Metric | Result | Pass? |
|---|---|---|
| Requests to Supabase | 10,796 in 4 min (44 req/s, the race-day rate) | |
| Error rate | 0.00 % (0 / 10,796) | ✓ (< 0.5 %) |
| Latency | median 64 ms, p95 92 ms, p99 137 ms, max 438 ms | ✓ (p95 < 800 ms) |
| Egress on the wire | 189 MB (17.5 KB per response, gzip + headers) | |

Run A ran for 4 minutes instead of 20. Nobody could confirm whether Supabase
meters egress on compressed bytes (0.19 GB for this run) or raw bytes
(1.4 GB). At raw, 20 minutes would have been ~7 GB, over Org B's 5 GB quota,
which LCS production shares. Four minutes at the full rate is past warm-up,
and latency stayed flat throughout.

What it shows: a Free Nano instance serves the race-day request rate with
ease. **Egress is the constraint, not capacity.** Even the plan's lower load
model (150 phones, ~70 % in foreground, ~680k requests a day) comes to
≈ 12 GB at this payload's gzip size, or ≈ 89 GB if metered raw. Direct
polling cannot stay inside the 5 GB Free quota.

### Run B: cached endpoint

RUN_B_PLACEHOLDER
