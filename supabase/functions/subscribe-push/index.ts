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
import { allowClient, isUuid, json, serveWithCors } from "../_shared/http.ts";

// notify-court-allocated POSTs to every stored endpoint, so only accept the
// browser push services (Chrome/Edge/Android, Firefox, Windows, Safari).
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)?push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
];

function validPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1024) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}


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

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ success: false, error: "POST only" }, 405);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (!(await allowClient(supabase, req, "subscribe-push", 20, 600))) {
      return json({ success: false, error: "Too many requests" }, 429);
    }

    const raw = await req.text();
    if (raw.length > 4096) return json({ success: false, error: "Payload too large" }, 413);
    let body: Partial<Payload> = {};
    try { body = raw ? (JSON.parse(raw) as Partial<Payload>) : {}; } catch { /* handled below */ }

    // Validate required fields
    const required: (keyof Payload)[] = ["tournament_id", "kind", "endpoint", "p256dh", "auth"];
    for (const k of required) {
      if (typeof body[k] !== "string" || !body[k]) {
        return json({ success: false, error: `Missing field: ${k}` }, 400);
      }
    }
    if (!isUuid(body.tournament_id)) {
      return json({ success: false, error: "Tournament not found" }, 404);
    }
    if (!validPushEndpoint(body.endpoint!)) {
      return json({ success: false, error: "Unsupported push endpoint" }, 400);
    }
    if (body.p256dh!.length > 256 || body.auth!.length > 128) {
      return json({ success: false, error: "Invalid subscription keys" }, 400);
    }
    if (body.pending_registration_id !== undefined && !isUuid(body.pending_registration_id)) {
      return json({ success: false, error: "Invalid registration" }, 400);
    }
    if (body.player_id !== undefined && !isUuid(body.player_id)) {
      return json({ success: false, error: "Invalid player" }, 400);
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
          user_agent: typeof body.user_agent === "string" ? body.user_agent.slice(0, 512) : null,
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
      return json({ success: false, error: "Failed to save subscription" }, 500);
    }

    return json({ success: true, subscriptionId: data.id }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("subscribe-push error:", msg);
    return json({ success: false, error: "Something went wrong" }, 500);
  }
}
