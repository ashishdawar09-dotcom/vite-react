// Waiver consent: validation, the stored record, and the partner email.
//
// A tournament with waiver_text requires every participant to accept the
// regulations, the waiver and the codes of conduct before playing. The
// registering player accepts on the form; a doubles partner accepts through
// a one-time link emailed to them. Under-19s (BC's age of majority) need a
// parent or guardian to accept, and the typed signature must match the name
// of whoever is accepting.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

export type ConsentInput = {
  age?: unknown;
  guardian_name?: unknown;
  signature?: unknown;
  accepted_rules?: unknown;
  accepted_waiver?: unknown;
  accepted_codes_of_conduct?: unknown;
  waiver_version?: unknown;
};

export type WaiverTournament = {
  id: string;
  waiver_text: string | null;
  waiver_version: string | null;
};

export type ValidConsent = {
  age: number;
  guardian_name: string | null;
  signature: string;
};

const AGE_OF_MAJORITY = 19;

export function parseAge(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 4 && n <= 110 ? n : null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// Returns the cleaned consent, or an error message for the person filling it in.
export function validateConsent(
  input: ConsentInput | undefined,
  t: WaiverTournament,
  participantName: string,
): { ok: true; value: ValidConsent } | { ok: false; error: string; status: number } {
  const c = input ?? {};
  const accepted = c.accepted_rules === true && c.accepted_waiver === true && c.accepted_codes_of_conduct === true;
  if (!accepted || c.waiver_version === undefined || c.waiver_version === null) {
    return { ok: false, status: 400, error: "Please read and accept the regulations, the waiver and the codes of conduct." };
  }
  // Ticked against an older text: they must see the current one first.
  if (c.waiver_version !== t.waiver_version) {
    return { ok: false, status: 409, error: "The waiver has been updated. Please reload the page and read it again." };
  }
  const age = parseAge(c.age);
  if (age === null) return { ok: false, status: 400, error: "Please enter the player's age." };
  const guardian = typeof c.guardian_name === "string" ? c.guardian_name.trim() : "";
  if (age < AGE_OF_MAJORITY && guardian.length < 2) {
    return { ok: false, status: 400, error: "Players under 19 need a parent or guardian to accept the waiver. Please enter their name." };
  }
  if (guardian.length > 120) return { ok: false, status: 400, error: "Parent or guardian name is too long." };
  const signature = typeof c.signature === "string" ? c.signature.trim() : "";
  const signer = age < AGE_OF_MAJORITY ? guardian : participantName;
  if (!signature || norm(signature) !== norm(signer)) {
    return {
      ok: false,
      status: 400,
      error: age < AGE_OF_MAJORITY
        ? "To sign, the parent or guardian types their full name exactly as entered."
        : "To sign, type your full name exactly as entered above.",
    };
  }
  return { ok: true, value: { age, guardian_name: age < AGE_OF_MAJORITY ? guardian : null, signature } };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function recordConsent(
  supabase: SupabaseClient,
  req: Request,
  t: WaiverTournament,
  row: {
    registration_id: string;
    role: "player" | "partner";
    participant_name: string;
    participant_email: string | null;
    consent: ValidConsent;
  },
): Promise<string | null> {
  const { error } = await supabase.from("waiver_consents").insert({
    registration_id: row.registration_id,
    tournament_id: t.id,
    role: row.role,
    participant_name: row.participant_name,
    participant_email: row.participant_email,
    participant_age: row.consent.age,
    guardian_name: row.consent.guardian_name,
    signature: row.consent.signature,
    accepted_rules: true,
    accepted_waiver: true,
    accepted_codes_of_conduct: true,
    waiver_version: t.waiver_version,
    waiver_sha256: await sha256Hex(t.waiver_text ?? ""),
    ip_address: req.headers.get("cf-connecting-ip") ?? null,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300) || null,
  });
  return error ? error.message : null;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

// Emails the doubles partner their consent link, unless they've already
// accepted for this registration or there's nothing to send. Never throws:
// the admin card shows the link to share by hand if the email doesn't arrive.
export async function sendPartnerWaiverEmail(
  supabase: SupabaseClient,
  registrationId: string,
  appOrigin: string,
): Promise<void> {
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) {
      await supabase.from("pending_registrations")
        .update({ partner_waiver_email_status: "failed: email not configured" }).eq("id", registrationId);
      return;
    }
    const { data: reg } = await supabase
      .from("pending_registrations")
      .select("id, player_name, partner_name, partner_email, partner_consent_token, tournament_id, category_id")
      .eq("id", registrationId)
      .maybeSingle();
    if (!reg?.partner_email || !reg.partner_consent_token) return;
    const { count } = await supabase
      .from("waiver_consents")
      .select("id", { count: "exact", head: true })
      .eq("registration_id", reg.id)
      .eq("role", "partner");
    if ((count ?? 0) > 0) return;
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from("tournaments").select("name, event_date").eq("id", reg.tournament_id).maybeSingle(),
      supabase.from("categories").select("name").eq("id", reg.category_id).maybeSingle(),
    ]);
    const tournament = t?.name ?? "the tournament";
    const link = `${appOrigin}/waiver/${reg.partner_consent_token}`;
    const partner = reg.partner_name?.trim() || "there";
    const text =
      `Hi ${partner},\n\n` +
      `${reg.player_name} has entered you as their partner in ${c?.name ?? "doubles"} at ${tournament}.\n\n` +
      `Before you can play, please read the competition regulations and accept the waiver here:\n${link}\n\n` +
      `It takes about two minutes. If you weren't expecting this, you can ignore this email.\n`;
    const html =
      `<p>Hi ${esc(partner)},</p>` +
      `<p>${esc(reg.player_name)} has entered you as their partner in <strong>${esc(c?.name ?? "doubles")}</strong> at <strong>${esc(tournament)}</strong>.</p>` +
      `<p>Before you can play, please read the competition regulations and accept the waiver:</p>` +
      `<p><a href="${esc(link)}">Read and accept the waiver</a></p>` +
      `<p>It takes about two minutes. If you weren't expecting this, you can ignore this email.</p>`;
    const from = Deno.env.get("REGISTRATION_FROM_EMAIL") ?? `${tournament.replace(/[<>"]/g, "")} <no-reply@adawar.org>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [reg.partner_email], subject: `Please accept the waiver for ${tournament}`, text, html }),
    });
    const detail = res.ok ? "" : (await res.text()).slice(0, 160);
    if (!res.ok) console.error("partner waiver email failed:", res.status, detail);
    await supabase.from("pending_registrations").update({
      partner_waiver_email_status: res.ok ? "sent" : `failed: ${res.status} ${detail}`.slice(0, 200),
      partner_waiver_emailed_at: new Date().toISOString(),
    }).eq("id", reg.id);
  } catch (e) {
    console.error("partner waiver email failed:", e instanceof Error ? e.message : String(e));
    await supabase.from("pending_registrations").update({
      partner_waiver_email_status: `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
      partner_waiver_emailed_at: new Date().toISOString(),
    }).eq("id", registrationId);
  }
}
