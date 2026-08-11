// supabase/functions/subscribe-push/index.ts
//
// Public ingress for Web Push subscriptions. Browsers call PushManager.subscribe()
// which returns an endpoint + p256dh + auth keys; the client POSTs the result
// here, the function persists it into push_subscriptions (admin-only RLS).
//
// Identity: exactly one of these must be provided in the request:
//   - pending_registration_id  (player on the success screen, not yet approved)
//   - player_id                (already-approved player using /player/<id>/notifications)
//   - admin_email              (admin opting into new-registration pushes)
//
// All writes use the service-role client and bypass RLS — same pattern as
// register-player. The endpoint UNIQUE constraint dedups repeat subscriptions
// from the same browser (we UPSERT on endpoint).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Allowed browser origins: the production app + this project's Vercel domains
// (default + preview deploys). Anything else gets the prod origin echoed back,
// which the browser then blocks. CORS is a browser-only control — server-side
// callers ignore it — so the real protection is the auth/validation below.
const ALLOWED_ORIGIN =
  /^https:\/\/(badminton\.adawar\.org|badminton-ad\.vercel\.app|vite-react-[a-z0-9-]+\.vercel\.app)$/;

const corsHeaders = {
  // Access-Control-Allow-Origin is overwritten per-request by the wrapper in Deno.serve.
  "Access-Control-Allow-Origin": "https://badminton.adawar.org",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  tournament_id: string;
  kind: "player" | "admin";
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
  // Identity (exactly one)
  pending_registration_id?: string;
  player_id?: string;
  admin_email?: string;
};

// Verify the caller is a tournament admin (used only for kind="admin"
// subscriptions). Validates the Authorization bearer token to resolve the
// user's email, then checks `tournament_admins` with the service-role client.
// Returns the admin email, or null when the caller isn't a valid admin.
async function requireAdmin(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return null;
    const email = user.email.toLowerCase();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await admin
      .from("tournament_admins")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    return data ? email : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const res = await handle(req);
  const origin = req.headers.get("Origin") ?? "";
  res.headers.set(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGIN.test(origin) ? origin : "https://badminton.adawar.org",
  );
  res.headers.set("Vary", "Origin");
  return res;
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "POST only" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Partial<Payload>;

    // Validate required fields
    const required: (keyof Payload)[] = ["tournament_id", "kind", "endpoint", "p256dh", "auth"];
    for (const k of required) {
      if (typeof body[k] !== "string" || !body[k]) {
        return json({ success: false, error: `Missing field: ${k}` }, 400);
      }
    }
    if (body.kind !== "player" && body.kind !== "admin") {
      return json({ success: false, error: "kind must be 'player' or 'admin'" }, 400);
    }

    // Exactly-one-identity check
    const identityCount =
      (body.pending_registration_id ? 1 : 0) +
      (body.player_id ? 1 : 0) +
      (body.admin_email ? 1 : 0);
    if (identityCount !== 1) {
      return json(
        { success: false, error: "Provide exactly one of pending_registration_id, player_id, admin_email" },
        400,
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Validate tournament exists (cheap, prevents orphaned rows)
    const { data: t } = await supabase
      .from("tournaments")
      .select("id")
      .eq("id", body.tournament_id)
      .maybeSingle();
    if (!t) {
      return json({ success: false, error: "Tournament not found" }, 404);
    }

    // ---- Identity verification ----
    // Admin subscriptions must prove they're an admin; we derive admin_email
    // from the verified token and never trust the client-supplied value.
    // Player subscriptions are anonymous (no session), but we refuse forged or
    // orphaned identities by confirming the referenced row exists and belongs
    // to this tournament.
    if (body.kind === "admin") {
      const adminEmail = await requireAdmin(req);
      if (!adminEmail) {
        return json({ success: false, error: "forbidden" }, 403);
      }
      body.admin_email = adminEmail;
      body.player_id = undefined;
      body.pending_registration_id = undefined;
    } else {
      if (body.pending_registration_id) {
        const { data: pr } = await supabase
          .from("pending_registrations")
          .select("id")
          .eq("id", body.pending_registration_id)
          .eq("tournament_id", body.tournament_id)
          .maybeSingle();
        if (!pr) return json({ success: false, error: "Invalid registration" }, 400);
      } else if (body.player_id) {
        const { data: pl } = await supabase
          .from("players")
          .select("id")
          .eq("id", body.player_id)
          .eq("tournament_id", body.tournament_id)
          .maybeSingle();
        if (!pl) return json({ success: false, error: "Invalid player" }, 400);
      } else {
        return json(
          { success: false, error: "Player subscriptions require a player_id or pending_registration_id" },
          400,
        );
      }
      body.admin_email = undefined;
    }

    // Upsert by endpoint — same browser re-subscribing just overwrites
    const { data, error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          tournament_id: body.tournament_id,
          kind: body.kind,
          endpoint: body.endpoint,
          p256dh: body.p256dh,
          auth: body.auth,
          user_agent: body.user_agent ?? null,
          pending_registration_id: body.pending_registration_id ?? null,
          player_id: body.player_id ?? null,
          admin_email: body.admin_email?.toLowerCase().trim() ?? null,
          last_used_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "endpoint" },
      )
      .select("id")
      .single();

    if (error || !data) {
      console.error("subscribe-push upsert failed:", error?.message);
      return json({ success: false, error: error?.message ?? "Failed to save subscription" }, 500);
    }

    return json({ success: true, subscriptionId: data.id }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("subscribe-push error:", msg);
    return json({ success: false, error: msg }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
