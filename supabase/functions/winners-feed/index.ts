// supabase/functions/winners-feed/index.ts
//
// Public, read-only: the champions of each event of a tournament, with their
// names and the winners photo a desk volunteer uploaded. The Shuttle Storm
// website's champions page reads it. Names and results are already public in
// the live app; players' profile pictures are deliberately left out (they
// were agreed for the app and the hall TV only).
//
//   POST { slug }   → { tournament, events: [{ id, name, champions: [{ name }], photo_url }] }
//
// An instance keeps each answer for a few seconds, so many visitors cost the
// database one read.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { allowClient, json } from "../_shared/http.ts";
import { loadWinners } from "../volunteer-desk/winners_data.ts";

const ALLOWED_ORIGIN = /^(https:\/\/(shuttlestorm\.adawar\.org|badminton\.adawar\.org)|http:\/\/localhost:\d+)$/;
const DEFAULT_ORIGIN = "https://shuttlestorm.adawar.org";
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const MEMO_MS = 15_000;
const memo = new Map<string, { at: number; body: string }>();

Deno.serve(async (req: Request) => {
  const res = req.method === "OPTIONS"
    ? new Response("ok", { status: 200 })
    : await handle(req).catch((e) => {
      console.error("winners-feed failed:", e instanceof Error ? e.message : e);
      return json({ success: false, error: "Something went wrong. Please try again." }, 500);
    });
  const origin = req.headers.get("Origin") ?? "";
  res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN.test(origin) ? origin : DEFAULT_ORIGIN);
  res.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Vary", "Origin");
  return res;
});

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const raw = await req.text();
  if (raw.length > 500) return json({ success: false, error: "Invalid request" }, 400);
  let slug: unknown;
  try { slug = (JSON.parse(raw) as { slug?: unknown }).slug; } catch { return json({ success: false, error: "Invalid request" }, 400); }
  if (typeof slug !== "string" || !SLUG.test(slug)) return json({ success: false, error: "Unknown tournament" }, 404);

  const hit = memo.get(slug);
  if (hit && Date.now() - hit.at < MEMO_MS) return answer(hit.body);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await allowClient(supabase, req, "winners-feed", 300, 600))) {
    return json({ success: false, error: "Too many requests. Please wait a minute and try again." }, 429);
  }
  const { data: t } = await supabase.from("tournaments").select("id, name, event_date").eq("slug", slug).maybeSingle();
  if (!t) return json({ success: false, error: "Unknown tournament" }, 404);
  const events = (await loadWinners(supabase, t.id as string))
    // Names only: a player's profile picture was agreed for the app and the hall TV, not for the website.
    .map((e) => ({ id: e.id, name: e.name, champions: e.champions.map((c) => ({ name: c.name })), photo_url: e.photo_url }));
  const body = JSON.stringify({ success: true, tournament: { name: t.name, event_date: t.event_date }, events });
  if (memo.size > 20) memo.clear();
  memo.set(slug, { at: Date.now(), body });
  return answer(body);
}

function answer(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" } });
}
