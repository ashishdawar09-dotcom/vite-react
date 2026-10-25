// Simulated spectator phones running the real client policy
// (src/lib/snapshotSource.ts): each phone polls ENDPOINT_BASE/api/snapshot and
// falls back to the direct RPC the way src/lib/db.ts liveSnapshot does.
// SCRATCH PROJECT AND PREVIEWS ONLY: refuses production hosts.
//
// Prints one line per 10 s: endpoint successes/failures, RPC calls, CDN cache
// statuses, and the age of the data phones received. With SCRATCH_SECRET_KEY
// set it also writes a unique score to one live match every 20 s and reports
// how long each change took to reach every phone.
//
//   ENDPOINT_BASE=https://<preview> VERCEL_BYPASS_TOKEN=… \
//   SCRATCH_SUPABASE_URL=… SCRATCH_PUBLISHABLE_KEY=… LOADTEST_TOURNAMENT_ID=… \
//   [SCRATCH_SECRET_KEY=…] node scripts/loadtest/phones.mjs [phones=50] [duration_s=300]

import {
  chooseSnapshotSource,
  initialSnapshotSourceState,
  isSnapshotBody,
  isSnapshotResponse,
  recordEndpointResult,
  snapshotPollDelay,
} from "../../src/lib/snapshotSource.ts";

const PROD_MARKERS = ["wdqooznwzesmjdvlcrxw", "badminton.adawar.org", "badminton-ad.vercel.app"];
const POLL_MS = 5_000;

const base = process.env.ENDPOINT_BASE;
const sbUrl = process.env.SCRATCH_SUPABASE_URL;
const sbKey = process.env.SCRATCH_PUBLISHABLE_KEY;
const secret = process.env.SCRATCH_SECRET_KEY;
const tid = process.env.LOADTEST_TOURNAMENT_ID;
const bypass = process.env.VERCEL_BYPASS_TOKEN;
const phones = Number(process.argv[2] ?? 50);
const durationS = Number(process.argv[3] ?? 300);

if (!base || !sbUrl || !sbKey || !tid) throw new Error("missing env; see scripts/loadtest/README.md");
for (const u of [base, sbUrl]) {
  if (PROD_MARKERS.some((m) => u.includes(m))) throw new Error(`refusing production target: ${u}`);
}

const endAt = Date.now() + durationS * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-10 s bucket of what the phones did.
let bucket = newBucket();
function newBucket() {
  return { endpointOk: 0, endpointFail: 0, rpcOk: 0, rpcFail: 0, cache: {}, ages: [], degraded: 0 };
}

// Score-propagation probe: the writer sets a unique score_a on one live match;
// each phone records when it first sees it.
let probe = null; // { matchId, value, writtenAt, seenBy: Map<phone, ms> }
const latencies = [];

async function fetchEndpoint() {
  const headers = { "Accept-Encoding": "gzip, br" };
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  try {
    const res = await fetch(`${base}/api/snapshot?t=${tid}`, { headers, signal: AbortSignal.timeout(8_000) });
    const c = res.headers.get("x-vercel-cache") ?? "none";
    bucket.cache[c] = (bucket.cache[c] ?? 0) + 1;
    if (!isSnapshotResponse(res.status, res.headers.get("content-type"))) return null;
    const body = await res.json();
    return isSnapshotBody(body) ? body : null;
  } catch {
    return null;
  }
}

async function fetchRpc() {
  try {
    const res = await fetch(`${sbUrl}/rest/v1/rpc/live_snapshot`, {
      method: "POST",
      headers: { apikey: sbKey, "Content-Type": "application/json", "Accept-Encoding": "gzip, br" },
      body: JSON.stringify({ p_tournament_id: tid }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return isSnapshotBody(body) ? body : null;
  } catch {
    return null;
  }
}

function observe(phone, snap) {
  bucket.ages.push(Date.now() - snap.generated_at * 1000);
  if (!probe || probe.seenBy.has(phone)) return;
  const m = snap.matches.find((x) => x.id === probe.matchId);
  if (m && m.score_a === probe.value) probe.seenBy.set(phone, Date.now() - probe.writtenAt);
}

async function phone(n) {
  let state = initialSnapshotSourceState;
  await sleep(Math.random() * POLL_MS);
  while (Date.now() < endAt) {
    let snap = null;
    if (chooseSnapshotSource(state, Date.now()) === "endpoint") {
      snap = await fetchEndpoint();
      state = recordEndpointResult(state, snap !== null, Date.now());
      if (snap) bucket.endpointOk++;
      else bucket.endpointFail++;
    }
    if (!snap) {
      snap = await fetchRpc();
      if (snap) bucket.rpcOk++;
      else bucket.rpcFail++;
    }
    if (snap) observe(n, snap);
    const delay = snapshotPollDelay(state, POLL_MS);
    if (delay > POLL_MS) bucket.degraded++;
    await sleep(delay);
  }
}

async function writer() {
  if (!secret) return;
  const h = { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  const res = await fetch(`${sbUrl}/rest/v1/matches?tournament_id=eq.${tid}&status=eq.live&select=id&limit=1`, { headers: h });
  const [m] = await res.json();
  if (!m) throw new Error("no live match to probe; re-run seed.sql");
  let value = 30;
  await sleep(10_000);
  while (Date.now() < endAt - 25_000) {
    closeProbe();
    value = value >= 99 ? 30 : value + 1;
    const writtenAt = Date.now();
    const r = await fetch(`${sbUrl}/rest/v1/matches?id=eq.${m.id}`, {
      method: "PATCH",
      headers: { ...h, Prefer: "return=minimal" },
      body: JSON.stringify({ score_a: value }),
    });
    if (r.ok) probe = { matchId: m.id, value, writtenAt, seenBy: new Map() };
    await sleep(20_000);
  }
  closeProbe();
}

function closeProbe() {
  if (!probe) return;
  const seen = [...probe.seenBy.values()].sort((a, b) => a - b);
  latencies.push(...seen);
  console.log(
    `  probe score_a=${probe.value}: seen by ${seen.length}/${phones} phones, ` +
      `p50 ${pct(seen, 50)} ms, max ${seen.at(-1) ?? "-"} ms`,
  );
  probe = null;
}

function pct(arr, p) {
  if (arr.length === 0) return "-";
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

const start = Date.now();
const ticker = setInterval(() => {
  const b = bucket;
  bucket = newBucket();
  const t = Math.round((Date.now() - start) / 1000);
  console.log(
    `t=${String(t).padStart(4)}s endpoint ok=${b.endpointOk} fail=${b.endpointFail} | rpc ok=${b.rpcOk} fail=${b.rpcFail}` +
      ` | degraded=${b.degraded} | cache ${JSON.stringify(b.cache)} | data age p50=${pct(b.ages, 50)} p95=${pct(b.ages, 95)} ms`,
  );
}, 10_000);

console.log(`phones: ${phones} phones polling ${base}/api/snapshot for ${durationS}s`);
await Promise.all([...Array.from({ length: phones }, (_, i) => phone(i)), writer()]);
clearInterval(ticker);
if (latencies.length) {
  console.log(`score propagation over all probes: p50 ${pct(latencies, 50)} ms, p95 ${pct(latencies, 95)} ms, max ${pct(latencies, 100)} ms`);
}
