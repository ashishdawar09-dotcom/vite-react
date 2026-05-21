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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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

Deno.serve(async (req: Request) => {
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
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
