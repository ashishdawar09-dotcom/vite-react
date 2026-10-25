# Snapshot load test (U9)

Checks that race-day spectator polling holds up, and how much of it reaches
Supabase, with and without the CDN-cached `/api/snapshot` endpoint (U8).
See KTD5, the Load model, U8 and U9 in `docs/plans/race-day-2026.md`.

**Never point any of this at production** (`wdqooznwzesmjdvlcrxw`,
badminton.adawar.org). The k6 script and the writer refuse those targets.

## Files

| File | What it does |
|---|---|
| `seed.sql` | Creates the synthetic "Load Cup" (slug `loadtest`) on the scratch project: 10 categories, 120 players, 70 teams, 102 matches (90 group in two groups per category, 12 knockout), 4 live, 2 allocated to a court. Re-running replaces it. Synthetic names only. |
| `snapshot.k6.js` | k6 script. `TARGET=direct` POSTs the `live_snapshot` RPC (run A); `TARGET=cached` GETs `/api/snapshot` on a Vercel preview (run B). Each VU polls every `POLL_S` seconds, starting at a random offset. |
| `writer.mjs` | Bumps a score on one live match every few seconds so caches and the DB see race-day churn. |
| `phones.mjs` | N simulated phones running the real client policy (`src/lib/snapshotSource.ts`): endpoint first, RPC fallback, degraded mode. Prints endpoint/RPC counts, CDN cache statuses and data age every 10 s; with `SCRATCH_SECRET_KEY` it also probes how long a score change takes to reach every phone. Needs `ENDPOINT_BASE`. |
| `local-endpoint.mjs` | Serves `api/snapshot.ts` on `localhost:8790`; `kill -USR1 <pid>` toggles a 502 failure mode. For fallback tests without Vercel. |

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
ENDPOINT_BASE=$PREVIEW_URL node scripts/loadtest/phones.mjs 50 300
```

4. Afterwards: revoke the bypass token, remove the scratch Preview env vars,
   and pause the scratch project.

Pass criteria (U9): p95 under 800 ms, error rate under 0.5 %, and in run B at
most one origin request per 2 s.

## Results

Payload at race-day size: 63 players / 100 matches = 131 KB raw, 16.8 KB gzip,
11.6 KB brotli. 120 players / 102 matches = **165 KB raw, 23.6 KB gzip,
15.8 KB brotli**.

### Run A: direct RPC (2026-10-25, scratch project, Free/Nano, us-west-2)

**A1 (63 players):** 225 VUs polling every 5 s, writer updating a live score every 3 s
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

**A2 (120 players, 165 KB):** same load for 2 minutes.

| Metric | Result | Pass? |
|---|---|---|
| Requests to Supabase | 5,399 in 2 min (43 req/s) | |
| Error rate | 0.00 % | ✓ |
| Latency | median 76 ms, p95 **244 ms**, p99 427 ms, max 653 ms | ✓ |
| Egress on the wire | 132 MB (24.5 KB per response) | |

p95 more than doubled with a 25 % bigger payload: the Nano instance spends
real CPU building the JSON. It still passes, but it is the trend to watch if
the payload keeps growing. At 120 players the plan's 680k-request day is
≈ 16 GB gzip-metered.

### Fallback and recovery (local, real handler + real client policy)

`local-endpoint.mjs` + `phones.mjs`: 20 phones, endpoint made to fail at
t≈32 s and restored at t≈132 s, with a score probe every 20 s.

| Phase | What phones did |
|---|---|
| Healthy | All polls via the endpoint. Score changes reached every phone in p50 1.3 s, max 4.6 s. |
| Endpoint fails | The next poll on every phone fell back to the RPC in the same tick, so no data gap. After 3 failures each phone switched to the RPC every 30 s and re-checked the endpoint every 60 s. |
| While degraded | Scores lag up to 30 s (two probes landed between polls and were never seen inside their 20 s window; others took 11–14 s). |
| Endpoint back | Phones returned to the endpoint at their next 60 s re-check (≈ 38 s after the restore here). |

Without any cache (same harness, endpoint healthy) score propagation was
p50 3.1 s, p95 4.9 s, max 5.2 s, bounded by the 5 s poll.

### Run B: cached endpoint

**Not run yet.** The Vercel preview sits behind deployment protection, and
creating the protection-bypass token needs Ashish's OK given in the same
Claude session that creates it. Still to measure through the CDN: origin
request rate and HIT/STALE ratio at 225 VUs, stale-if-error during a brief
Supabase error, cold-cache stampede when many phones arrive at once, and
score propagation through the cache (expected ≤ ~8 s: up to 3 s cache age
plus the 5 s poll).
