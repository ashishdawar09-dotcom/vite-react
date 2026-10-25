// k6 load test for the spectator snapshot poll (U9 in docs/plans/race-day-2026.md).
// SCRATCH PROJECT AND PREVIEWS ONLY: the script refuses production targets.
//
//   TARGET=direct  each VU POSTs the live_snapshot RPC on the scratch project (run A)
//   TARGET=cached  each VU GETs /api/snapshot on a Vercel preview (run B)
//
// Env (never commit values; the repo is public): see scripts/loadtest/README.md.
//   SCRATCH_SUPABASE_URL, SCRATCH_PUBLISHABLE_KEY   (direct)
//   PREVIEW_URL, VERCEL_BYPASS_TOKEN                (cached)
//   LOADTEST_TOURNAMENT_ID                          (both)
//   VUS (225), POLL_S (5), DURATION (20m)

import http from "k6/http";
import { sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const PROD_MARKERS = ["wdqooznwzesmjdvlcrxw", "badminton.adawar.org", "badminton-ad.vercel.app"];

const TARGET = __ENV.TARGET || "direct";
const VUS = Number(__ENV.VUS || 225);
const POLL_S = Number(__ENV.POLL_S || 5);
const DURATION = __ENV.DURATION || "20m";
const TID = __ENV.LOADTEST_TOURNAMENT_ID;

const url =
  TARGET === "cached"
    ? `${__ENV.PREVIEW_URL}/api/snapshot?t=${TID}`
    : `${__ENV.SCRATCH_SUPABASE_URL}/rest/v1/rpc/live_snapshot`;

if (!TID || url.includes("undefined")) throw new Error("missing env; see scripts/loadtest/README.md");
if (PROD_MARKERS.some((m) => url.includes(m))) throw new Error(`refusing production target: ${url}`);

// Browsers send this, and both Supabase and Vercel compress on it.
const COMMON = { "Accept-Encoding": "gzip, deflate, br" };
const params =
  TARGET === "cached"
    ? { headers: { ...COMMON, "x-vercel-protection-bypass": __ENV.VERCEL_BYPASS_TOKEN }, tags: { target: "cached" } }
    : {
        headers: { ...COMMON, apikey: __ENV.SCRATCH_PUBLISHABLE_KEY, "Content-Type": "application/json" },
        tags: { target: "direct" },
      };
const body = JSON.stringify({ p_tournament_id: TID });

const failed = new Rate("snapshot_failed");
const cacheHit = new Counter("vercel_cache_hit");
const cacheStale = new Counter("vercel_cache_stale");
const cacheMiss = new Counter("vercel_cache_miss");
const cacheOther = new Counter("vercel_cache_other");

export const options = {
  scenarios: {
    poll: { executor: "constant-vus", vus: VUS, duration: DURATION, gracefulStop: "10s" },
  },
  thresholds: {
    http_req_duration: ["p(95)<800"],
    snapshot_failed: ["rate<0.005"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  // Spread VUs across the poll window, like phones that opened the page at
  // different times, instead of 225 requests landing on the same tick.
  if (__ITER === 0) sleep(Math.random() * POLL_S);

  const res = TARGET === "cached" ? http.get(url, params) : http.post(url, body, params);
  const ok =
    res.status === 200 &&
    /^application\/json/i.test(res.headers["Content-Type"] || "") &&
    typeof res.body === "string" &&
    res.body.includes('"matches"');
  failed.add(!ok);

  if (TARGET === "cached") {
    const c = (res.headers["X-Vercel-Cache"] || "").toUpperCase();
    if (c === "HIT") cacheHit.add(1);
    else if (c === "STALE") cacheStale.add(1);
    else if (c === "MISS") cacheMiss.add(1);
    else cacheOther.add(1);
  }

  sleep(Math.max(0, POLL_S - res.timings.duration / 1000));
}
