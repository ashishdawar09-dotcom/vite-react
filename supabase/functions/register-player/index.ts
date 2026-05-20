// supabase/functions/register-player/index.ts
//
// Public ingress for tournament registration forms. The form lives at
// /register/<tournament_id> on the SPA; players (unauthenticated) submit
// via POST here. The function validates the payload server-side using the
// service-role key and inserts into `pending_registrations` (admin-only RLS).
// An admin later approves/rejects via the RPCs in schema_v12.
//
// Required Supabase function secrets (auto-set by the platform — no config):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  tournament_id: string;
  category_id: string;
  player_name: string;
  player_email: string;
  player_phone?: string;
  player_is_member: boolean;
  partner_name?: string;
  partner_email?: string;
  partner_phone?: string;
  partner_is_member?: boolean;
  payment_reference: string;
  payment_paid_full_for_partner?: boolean;
  comments?: string;
  group_choice?: "open" | "members";
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Validation: required scalars ----
    const requiredStrings: (keyof Payload)[] = [
      "tournament_id",
      "category_id",
      "player_name",
      "player_email",
      "payment_reference",
    ];
    for (const k of requiredStrings) {
      const v = body[k];
      if (typeof v !== "string" || !v.trim()) {
        return json({ success: false, error: `Missing field: ${k}` }, 400);
      }
    }
    if (typeof body.player_is_member !== "boolean") {
      return json({ success: false, error: "player_is_member must be boolean" }, 400);
    }

    const playerEmail = body.player_email!.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(playerEmail)) {
      return json({ success: false, error: "Invalid player email" }, 400);
    }

    // ---- Validation: tournament exists, open, not past deadline ----
    const { data: t, error: tErr } = await supabase
      .from("tournaments")
      .select("id, registration_open, registration_deadline")
      .eq("id", body.tournament_id)
      .maybeSingle();
    if (tErr || !t) {
      return json({ success: false, error: "Tournament not found" }, 404);
    }
    if (!t.registration_open) {
      return json({ success: false, error: "Registration is closed for this tournament" }, 400);
    }
    if (t.registration_deadline && new Date(t.registration_deadline).getTime() < Date.now()) {
      return json({ success: false, error: "Registration deadline has passed" }, 400);
    }

    // ---- Validation: category belongs to tournament ----
    const { data: c, error: cErr } = await supabase
      .from("categories")
      .select("id, tournament_id, team_size, allow_solo_signup")
      .eq("id", body.category_id)
      .maybeSingle();
    if (cErr || !c || c.tournament_id !== body.tournament_id) {
      return json({ success: false, error: "Category not found in this tournament" }, 404);
    }

    // ---- Validation: partner required for doubles unless solo allowed ----
    const isDoubles = c.team_size === 2;
    const partnerProvided =
      !!body.partner_name?.trim() && !!body.partner_email?.trim();
    if (isDoubles && !c.allow_solo_signup && !partnerProvided) {
      return json(
        { success: false, error: "Partner name and email are required for this category" },
        400,
      );
    }
    let partnerEmail: string | null = null;
    if (partnerProvided) {
      partnerEmail = body.partner_email!.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail)) {
        return json({ success: false, error: "Invalid partner email" }, 400);
      }
      if (partnerEmail === playerEmail) {
        return json(
          { success: false, error: "Partner email must differ from your email" },
          400,
        );
      }
    }

    // ---- Dedup: no existing pending/approved row for (email, category) ----
    const { data: dup } = await supabase
      .from("pending_registrations")
      .select("id, status")
      .eq("category_id", body.category_id)
      .in("status", ["pending", "approved"])
      .ilike("player_email", playerEmail)
      .maybeSingle();
    if (dup) {
      const label = dup.status === "approved" ? "already approved" : "already submitted";
      return json(
        { success: false, error: `You are ${label} for this category` },
        409,
      );
    }

    // ---- Insert ----
    const { data: ins, error: insErr } = await supabase
      .from("pending_registrations")
      .insert({
        tournament_id: body.tournament_id,
        category_id: body.category_id,
        player_name: body.player_name!.trim(),
        player_email: playerEmail,
        player_phone: body.player_phone?.trim() || null,
        player_is_member: body.player_is_member,
        partner_name: body.partner_name?.trim() || null,
        partner_email: partnerEmail,
        partner_phone: body.partner_phone?.trim() || null,
        partner_is_member:
          typeof body.partner_is_member === "boolean" ? body.partner_is_member : null,
        payment_reference: body.payment_reference!.trim(),
        payment_paid_full_for_partner: !!body.payment_paid_full_for_partner,
        comments: body.comments?.trim() || null,
        group_choice: body.group_choice ?? null,
        raw_payload: body,
      })
      .select("id")
      .single();

    if (insErr || !ins) {
      console.error("register-player insert failed:", insErr?.message);
      return json(
        { success: false, error: insErr?.message ?? "Failed to save registration" },
        500,
      );
    }

    return json({ success: true, registrationId: ins.id }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("register-player error:", msg);
    return json({ success: false, error: msg }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
