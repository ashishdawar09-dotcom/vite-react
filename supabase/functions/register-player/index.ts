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
import { allow, allowClient, appOrigin, isUuid, json, serveWithCors } from "../_shared/http.ts";
import { cardCents, etransferCents } from "../_shared/pricing.ts";
import { stripeConfigured, stripePost } from "../_shared/stripe.ts";


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
  payment_method?: "etransfer" | "card";
  payment_reference?: string;
  payment_paid_full_for_partner?: boolean;
  comments?: string;
  group_choice?: "open" | "members";
};

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

    // Flood guard per client. Generous because families and club sessions share
    // one network; the per-tournament cap below bounds the total.
    if (!(await allowClient(supabase, req, "register-player", 15, 600))) {
      return json({ success: false, error: "Too many submissions. Please wait a few minutes and try again." }, 429);
    }

    // Cap raw body size before parsing — prevents oversized payloads from
    // bloating storage or exhausting memory. ~8 KB is generous for this form.
    const rawBody = await req.text();
    if (rawBody.length > 8192) {
      return json({ success: false, error: "Payload too large" }, 413);
    }
    let body: Partial<Payload> = {};
    try {
      body = rawBody ? (JSON.parse(rawBody) as Partial<Payload>) : {};
    } catch {
      return json({ success: false, error: "Invalid JSON" }, 400);
    }

    // ---- Validation: required scalars ----
    const requiredStrings: (keyof Payload)[] = [
      "tournament_id",
      "category_id",
      "player_name",
      "player_email",
    ];
    for (const k of requiredStrings) {
      const v = body[k];
      if (typeof v !== "string" || !v.trim()) {
        return json({ success: false, error: `Missing field: ${k}` }, 400);
      }
    }
    const payByCard = body.payment_method === "card";
    if (!payByCard && (typeof body.payment_reference !== "string" || !body.payment_reference.trim())) {
      return json({ success: false, error: "Missing field: payment_reference" }, 400);
    }
    if (payByCard && !stripeConfigured()) {
      return json({ success: false, error: "Card payments aren't available right now. Please pay by e-Transfer." }, 503);
    }
    if (!isUuid(body.tournament_id) || !isUuid(body.category_id)) {
      return json({ success: false, error: "Tournament not found" }, 404);
    }
    if (typeof body.player_is_member !== "boolean") {
      return json({ success: false, error: "player_is_member must be boolean" }, 400);
    }

    // ---- Validation: per-field length caps (flood / abuse guard) ----
    const lenCaps: Partial<Record<keyof Payload, number>> = {
      tournament_id: 64, category_id: 64,
      player_name: 80, player_email: 120, player_phone: 30,
      partner_name: 80, partner_email: 120, partner_phone: 30,
      payment_reference: 100, comments: 500, group_choice: 16,
    };
    for (const k of Object.keys(lenCaps) as (keyof Payload)[]) {
      const v = body[k];
      if (typeof v === "string" && v.length > (lenCaps[k] as number)) {
        return json({ success: false, error: `Field too long: ${k}` }, 400);
      }
    }

    const playerEmail = body.player_email!.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(playerEmail)) {
      return json({ success: false, error: "Invalid player email" }, 400);
    }

    // ---- Validation: tournament exists, open, not past deadline ----
    const { data: t, error: tErr } = await supabase
      .from("tournaments")
      .select("id, name, registration_open, registration_deadline")
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

    // Overall cap per tournament, which per-client limits can't get around.
    if (!(await allow(supabase, "register-player-tournament", t.id, 200, 3600))) {
      return json({ success: false, error: "Registration is busy right now. Please try again shortly." }, 429);
    }

    // ---- Validation: category belongs to tournament ----
    const { data: c, error: cErr } = await supabase
      .from("categories")
      .select("id, name, tournament_id, team_size, allow_solo_signup, price, price_basis")
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

    // ---- Amount, computed from the category, never from the request ----
    const paysForBoth = !!body.payment_paid_full_for_partner && partnerProvided;
    const etransfer = etransferCents(c, paysForBoth);
    if (payByCard && etransfer === null) {
      return json({ success: false, error: "Card payment isn't available for this category. Please pay by e-Transfer." }, 400);
    }
    const amountDue = etransfer === null ? null : payByCard ? cardCents(etransfer) : etransfer;

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

    // ---- Flood guard: cap total registrations per email per tournament ----
    // The per-category dedup above is trivially bypassed by varying the
    // category; this bounds how many rows one email can create overall.
    const { count: emailCount } = await supabase
      .from("pending_registrations")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", body.tournament_id)
      .neq("status", "payment_expired")
      .ilike("player_email", playerEmail);
    if ((emailCount ?? 0) >= 8) {
      return json(
        { success: false, error: "Too many registrations for this email" },
        429,
      );
    }

    // A new card attempt replaces any unfinished one for the same entry, so a
    // player can't end up paying twice by retrying.
    if (payByCard) {
      const { data: stale } = await supabase
        .from("pending_registrations")
        .update({ status: "payment_expired", card_payment_status: "expired" })
        .eq("category_id", body.category_id)
        .eq("status", "awaiting_payment")
        .ilike("player_email", playerEmail)
        .select("stripe_checkout_session_id");
      for (const row of stale ?? []) {
        if (!row.stripe_checkout_session_id) continue;
        await stripePost(`/checkout/sessions/${row.stripe_checkout_session_id}/expire`, {}).catch(() => {});
      }
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
        payment_method: payByCard ? "card" : "etransfer",
        payment_reference: payByCard ? null : body.payment_reference!.trim(),
        payment_paid_full_for_partner: paysForBoth || (isDoubles && c.price_basis === "per_team" && partnerProvided),
        amount_due_cents: amountDue,
        status: payByCard ? "awaiting_payment" : "pending",
        card_payment_status: payByCard ? "awaiting" : null,
        comments: body.comments?.trim() || null,
        group_choice: body.group_choice ?? null,
        // Store a bounded, validated subset rather than the raw request body
        // (previously persisted verbatim and unbounded).
        raw_payload: {
          player_name: body.player_name!.trim(),
          player_email: playerEmail,
          player_phone: body.player_phone?.trim() || null,
          partner_name: body.partner_name?.trim() || null,
          partner_email: partnerEmail,
          partner_phone: body.partner_phone?.trim() || null,
          payment_method: payByCard ? "card" : "etransfer",
          payment_reference: payByCard ? null : body.payment_reference!.trim(),
          comments: body.comments?.trim() || null,
          group_choice: body.group_choice ?? null,
        },
      })
      .select("id")
      .single();

    if (insErr || !ins) {
      console.error("register-player insert failed:", insErr?.message);
      return json({ success: false, error: "Failed to save registration. Please try again." }, 500);
    }

    if (!payByCard) {
      return json({ success: true, registrationId: ins.id }, 200);
    }

    // ---- Card: hand off to Stripe Checkout ----
    const origin = appOrigin(req);
    const back = `${origin}/register/${body.tournament_id}`;
    const meta = { app: "badminton", registration_id: ins.id, tournament_id: body.tournament_id };
    const entryFor = !isDoubles
      ? "Entry for 1 player"
      : c.price_basis === "per_team" || paysForBoth
        ? "Entry for a team of 2"
        : "Entry for 1 player of a doubles team";
    try {
      const session = await stripePost<{ id: string; url: string }>("/checkout/sessions", {
        mode: "payment",
        customer_email: playerEmail,
        client_reference_id: ins.id,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "cad",
            unit_amount: amountDue,
            product_data: { name: `${t.name} — ${c.name}`, description: entryFor },
          },
        }],
        metadata: meta,
        payment_intent_data: { metadata: meta, statement_descriptor_suffix: "BADMINTON" },
        success_url: `${back}?payment=success&reg=${ins.id}`,
        cancel_url: `${back}?payment=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      }, `badminton-checkout-${ins.id}`);
      await supabase
        .from("pending_registrations")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", ins.id);
      return json({ success: true, registrationId: ins.id, checkoutUrl: session.url }, 200);
    } catch (e) {
      console.error("register-player checkout failed:", e instanceof Error ? e.message : String(e));
      await supabase
        .from("pending_registrations")
        .update({ status: "payment_expired", card_payment_status: "expired" })
        .eq("id", ins.id);
      return json({ success: false, error: "Card payment couldn't be started. Please try again or pay by e-Transfer." }, 502);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("register-player error:", msg);
    return json({ success: false, error: "Something went wrong. Please try again." }, 500);
  }
}
