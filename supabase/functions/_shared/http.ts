// Shared request plumbing for the badminton Edge Functions.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Browser origins allowed to call these functions: production, the Vercel
// production alias, this team's preview deployments, and local dev. Preview
// URLs must end in the team slug so another Vercel account can't match.
// CORS only constrains browsers; the auth and validation in each function
// remain the real protection.
const ALLOWED_ORIGIN =
  /^(https:\/\/(badminton\.adawar\.org|badminton-ad\.vercel\.app|vite-react-[a-z0-9-]+-ashishs-projects-eeab76d3\.vercel\.app)|http:\/\/localhost:\d+)$/;
const DEFAULT_ORIGIN = "https://badminton.adawar.org";

export const corsHeaders = {
  "Access-Control-Allow-Origin": DEFAULT_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Wraps a handler so every response echoes an allowed Origin (or the
// production origin, which the browser then rejects for anyone else).
export function serveWithCors(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req: Request) => {
    const res = req.method === "OPTIONS"
      ? new Response("ok", { headers: corsHeaders })
      : await handler(req);
    const origin = req.headers.get("Origin") ?? "";
    res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN.test(origin) ? origin : DEFAULT_ORIGIN);
    res.headers.set("Vary", "Origin");
    return res;
  });
}

// Site to send the browser back to (e.g. after Stripe Checkout): the caller's
// origin when it's one of ours, otherwise production.
export function appOrigin(req: Request): string {
  const origin = req.headers.get("Origin") ?? "";
  return ALLOWED_ORIGIN.test(origin) ? origin : DEFAULT_ORIGIN;
}

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// Client address as seen by Cloudflare in front of Supabase. Verified
// 2026-10-03: cf-connecting-ip is the real client (Cloudflare rejects requests
// that send their own), x-forwarded-for is rewritten by the proxy and its
// rightmost entry is an AWS hop shared by everyone. Per-client limits are
// still paired with a global cap in case this ever changes.
function clientAddress(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Records a hit and returns false once `max` hits exist for (bucket, key)
// within the window. Fails open if the limiter itself errors, so a database
// hiccup never blocks real registrations on tournament day.
export async function allow(
  supabase: SupabaseClient,
  bucket: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("rate_limit_hit", {
    p_bucket: bucket,
    p_key: await sha256(key),
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("rate limiter unavailable:", error.message);
    return true;
  }
  return data === true;
}

export function allowClient(
  supabase: SupabaseClient,
  req: Request,
  bucket: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  return allow(supabase, bucket, `ip:${clientAddress(req)}`, max, windowSeconds);
}
