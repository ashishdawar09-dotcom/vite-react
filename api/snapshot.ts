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

export async function GET(request: Request): Promise<Response> {
  const tid = new URL(request.url).searchParams.get("t") ?? "";
  if (!UUID_RE.test(tid)) return error(400, "t must be a tournament uuid");

  // Same publishable key the browser bundle ships. VITE_* vars are available
  // to functions at runtime; SUPABASE_* override them if set.
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return error(500, "snapshot endpoint not configured");

  let upstream: Response;
  try {
    upstream = await fetch(`${url}/rest/v1/rpc/live_snapshot`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_tournament_id: tid }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return error(504, "upstream unavailable");
  }
  if (!upstream.ok) return error(502, `upstream ${upstream.status}`);

  // live_snapshot returns a JSON object; pass it through without re-encoding.
  const body = await upstream.text();
  if (!body.startsWith("{")) return error(502, "unexpected upstream body");
  return json(200, body, true);
}
