// Waiver consent: validation and the stored record.
//
// A tournament with waiver_text requires every participant to accept the
// regulations, the waiver and the codes of conduct before playing. The
// registering player accepts on the form; a doubles partner accepts through
// a one-time link in their copy of the confirmation email
// (registration_emails.ts). Under-19s (BC's age of majority) need a
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
