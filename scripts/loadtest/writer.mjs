// Background score writer for load tests (U9): bumps a score on one live
// match of the load-test tournament every few seconds, so caches and the
// database see race-day churn. SCRATCH PROJECT ONLY: refuses production.
//
//   SCRATCH_SUPABASE_URL=… SCRATCH_SECRET_KEY=… LOADTEST_TOURNAMENT_ID=… \
//     node scripts/loadtest/writer.mjs [interval_s=3] [duration_s=1500]
//
// The secret key bypasses RLS. Keep it in your shell only; never commit it.

const url = process.env.SCRATCH_SUPABASE_URL;
const key = process.env.SCRATCH_SECRET_KEY;
const tid = process.env.LOADTEST_TOURNAMENT_ID;
const intervalS = Number(process.argv[2] ?? 3);
const durationS = Number(process.argv[3] ?? 1500);

if (!url || !key || !tid) throw new Error("missing env; see scripts/loadtest/README.md");
if (url.includes("wdqooznwzesmjdvlcrxw")) throw new Error("refusing to write to production");

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const res = await fetch(
  `${url}/rest/v1/matches?tournament_id=eq.${tid}&status=eq.live&select=id,score_a,score_b`,
  { headers },
);
if (!res.ok) throw new Error(`read live matches: HTTP ${res.status}`);
const live = await res.json();
if (live.length === 0) throw new Error("no live matches in the load-test tournament; re-run seed.sql");
console.log(`writer: ${live.length} live matches, one update every ${intervalS}s for ${durationS}s`);

let writes = 0;
let errors = 0;
const end = Date.now() + durationS * 1000;
while (Date.now() < end) {
  const m = live[writes % live.length];
  const side = Math.random() < 0.5 ? "score_a" : "score_b";
  m[side] = ((m[side] ?? 0) + 1) % 30;
  const r = await fetch(`${url}/rest/v1/matches?id=eq.${m.id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ [side]: m[side] }),
  });
  writes++;
  if (!r.ok) errors++;
  await new Promise((resolve) => setTimeout(resolve, intervalS * 1000));
}
console.log(`writer: done, ${writes} writes, ${errors} errors`);
