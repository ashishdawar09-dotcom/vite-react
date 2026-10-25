// GET /api/snapshot?t=<tournament uuid>
//
// CDN-cached proxy for the live_snapshot RPC (KTD5 in
// docs/plans/race-day-2026.md). Every spectator phone polls this path, but
// Vercel's CDN answers repeat polls from cache, so Supabase sees roughly one
// request per region every few seconds however many phones are watching.
// The snapshot is public data (anon RPC, publishable key), so a shared cache
// leaks nothing a direct call wouldn't.
//
// Errors are never cached. Successful responses carry stale-if-error so the
// CDN keeps serving the last good snapshot through brief Supabase errors.
// The client (src/lib/db.ts liveSnapshot) falls back to the RPC if this
// endpoint fails.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPSTREAM_TIMEOUT_MS = 8_000;

// ~3 s fresh, then serve stale while one background request refreshes it.
// Vercel's CDN consumes this header and strips it from the client response.
const CDN_CACHE = "public, max-age=3, stale-while-revalidate=30, stale-if-error=300";
// Browsers must not keep their own copy: each poll should reach the CDN.
const BROWSER_CACHE = "public, max-age=0, must-revalidate";
const NO_STORE = "no-store";

function json(status: number, body: string, cacheable: boolean): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheable ? BROWSER_CACHE : NO_STORE,
      "Vercel-CDN-Cache-Control": cacheable ? CDN_CACHE : NO_STORE,
    },
  });
}

function error(status: number, message: string): Response {
  return json(status, JSON.stringify({ error: message }), false);
}

// Vercel's CDN doesn't merge concurrent refreshes: in the load test each
// region's cache nodes revalidated independently, ~1.5 origin calls/s at 225
// phones instead of one per 3 s. So a warm function instance also shares one
// in-flight Supabase call per tournament and reuses its result for MEMO_MS.
// Worst-case data age at the phone: MEMO_MS + CDN max-age + the 5 s poll.
const MEMO_MS = 2_000;
const MEMO_MAX_ENTRIES = 20;
type Upstream = { ok: true; body: string } | { ok: false; status: number; message: string };
const memo = new Map<string, { at: number; body: string }>();
const inflight = new Map<string, Promise<Upstream>>();

async function fetchUpstream(url: string, key: string, tid: string): Promise<Upstream> {
  let upstream: Response;
  try {
    upstream = await fetch(`${url}/rest/v1/rpc/live_snapshot`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_tournament_id: tid }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 504, message: "upstream unavailable" };
  }
  if (!upstream.ok) return { ok: false, status: 502, message: `upstream ${upstream.status}` };

  // live_snapshot returns a JSON object; pass it through without re-encoding.
  const body = await upstream.text();
  if (!body.startsWith("{")) return { ok: false, status: 502, message: "unexpected upstream body" };
  return { ok: true, body };
}

async function snapshot(url: string, key: string, tid: string): Promise<Upstream> {
  const hit = memo.get(tid);
  if (hit && Date.now() - hit.at < MEMO_MS) return { ok: true, body: hit.body };
  let pending = inflight.get(tid);
  if (!pending) {
    pending = fetchUpstream(url, key, tid).then((r) => {
      if (r.ok) {
        if (memo.size >= MEMO_MAX_ENTRIES) memo.clear();
        memo.set(tid, { at: Date.now(), body: r.body });
      }
      return r;
    }).finally(() => inflight.delete(tid));
    inflight.set(tid, pending);
  }
  return pending;
}

export async function GET(request: Request): Promise<Response> {
  const tid = new URL(request.url).searchParams.get("t") ?? "";
  if (!UUID_RE.test(tid)) return error(400, "t must be a tournament uuid");

  // Same publishable key the browser bundle ships. VITE_* vars are available
  // to functions at runtime; SUPABASE_* override them if set.
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return error(500, "snapshot endpoint not configured");

  const r = await snapshot(url, key, tid);
  return r.ok ? json(200, r.body, true) : error(r.status, r.message);
}
