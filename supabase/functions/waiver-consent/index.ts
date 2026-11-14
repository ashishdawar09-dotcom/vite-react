// supabase/functions/waiver-consent/index.ts
//
// Public endpoint behind /waiver/<token>: a doubles partner, emailed a
// one-time link after their teammate registers, reads the regulations and
// accepts the waiver here. The token (pending_registrations.partner_consent_token)
// is the only credential, so responses reveal no more than the partner needs.
// A token on an entry with no partner (a singles player a director entered by
// hand) is that player's own link; it records the player's consent
// (waiverSigner in _shared/waiver.ts).
//
//   POST { action: "get", token }     → tournament, category, names, waiver text
//   POST { action: "accept", token, name, consent } → records the consent

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { allowClient, isUuid, json, serveWithCors } from "../_shared/http.ts";
import { type ConsentInput, recordConsent, validateConsent, waiverSigner } from "../_shared/waiver.ts";

serveWithCors(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await allowClient(supabase, req, "waiver-consent", 30, 600))) {
    return json({ success: false, error: "Too many requests. Please wait a few minutes and try again." }, 429);
  }

  const raw = await req.text();
  if (raw.length > 4096) return json({ success: false, error: "Payload too large" }, 413);
  let body: { action?: string; token?: unknown; name?: unknown; consent?: ConsentInput };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  if (!isUuid(body.token)) return json({ success: false, error: "This link isn't valid." }, 404);

  const { data: reg } = await supabase
    .from("pending_registrations")
    .select("id, status, player_name, player_email, partner_name, partner_email, tournament_id, category_id, approved_player_id, approved_partner_id")
    .eq("partner_consent_token", body.token)
    .maybeSingle();
  if (!reg || reg.status === "rejected") return json({ success: false, error: "This link isn't valid." }, 404);
  const signer = waiverSigner(reg);

  const [{ data: t }, { data: c }, { count }] = await Promise.all([
    supabase.from("tournaments")
      .select("id, name, event_date, venue_name, waiver_text, waiver_version, rules_url, waiver_url")
      .eq("id", reg.tournament_id).maybeSingle(),
    supabase.from("categories").select("name").eq("id", reg.category_id).maybeSingle(),
    supabase.from("waiver_consents").select("id", { count: "exact", head: true })
      .eq("registration_id", reg.id).eq("role", signer.role),
  ]);
  if (!t?.waiver_text) return json({ success: false, error: "This link isn't valid." }, 404);
  const alreadyAccepted = (count ?? 0) > 0;

  if (body.action === "get") {
    return json({
      success: true,
      alreadyAccepted,
      tournament: {
        name: t.name, event_date: t.event_date, venue_name: t.venue_name,
        waiver_text: t.waiver_text, waiver_version: t.waiver_version,
        rules_url: t.rules_url, waiver_url: t.waiver_url,
      },
      category: c?.name ?? null,
      player_name: reg.player_name,
      partner_name: reg.partner_name,
      // True when the link is the registrant's own (singles, no partner).
      solo: signer.solo,
    }, 200);
  }

  if (body.action === "accept") {
    if (alreadyAccepted) return json({ success: true, alreadyAccepted: true }, 200);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 120) {
      return json({ success: false, error: "Please enter your full name." }, 400);
    }
    const v = validateConsent(body.consent, t, name);
    if (!v.ok) return json({ success: false, error: v.error }, v.status);
    const err = await recordConsent(supabase, req, t, {
      registration_id: reg.id,
      role: signer.role,
      participant_name: name,
      participant_email: signer.email,
      consent: v.value,
    });
    if (err) {
      // A double submit races the unique index; treat it as done.
      if (/duplicate key/i.test(err)) return json({ success: true, alreadyAccepted: true }, 200);
      console.error("waiver-consent insert failed:", err);
      return json({ success: false, error: "Couldn't save your consent. Please try again." }, 500);
    }
    await supabase.from("pending_registrations").update({ [signer.ageColumn]: v.value.age }).eq("id", reg.id);
    // Already-approved entries: keep the signer's profile age in step.
    if (signer.playerId) {
      await supabase.from("players").update({ age: v.value.age }).eq("id", signer.playerId);
    }
    return json({ success: true }, 200);
  }

  return json({ success: false, error: "Unknown action" }, 400);
});
