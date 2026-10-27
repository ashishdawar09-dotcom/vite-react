// WhatsApp messages through a self-hosted Evolution API server (Baileys
// mode: a spare phone linked like WhatsApp Web, no per-message cost).
//
// Optional Supabase function secrets. Leave any of them unset and every
// WhatsApp step is skipped, while email and push still go out:
//   EVOLUTION_API_URL   - e.g. https://wa.example.org (no trailing slash needed)
//   EVOLUTION_API_KEY   - the server's AUTHENTICATION_API_KEY
//   EVOLUTION_INSTANCE  - the instance name the phone was linked to
//
// Each tournament also has its own switch, tournaments.whatsapp_enabled.
// Setup steps are in docs/whatsapp-setup.md.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

export type WhatsAppConfig = { url: string; apiKey: string; instance: string };

export function whatsappConfig(): WhatsAppConfig | null {
  const url = (Deno.env.get("EVOLUTION_API_URL") ?? "").trim().replace(/\/+$/, "");
  const apiKey = (Deno.env.get("EVOLUTION_API_KEY") ?? "").trim();
  const instance = (Deno.env.get("EVOLUTION_INSTANCE") ?? "").trim();
  if (!url || !apiKey || !instance) return null;
  return { url, apiKey, instance };
}

// Turns a phone number as typed on the registration form into the digits
// WhatsApp wants (country code first, no "+"). Most entries are Canadian:
// 10 digits get the North American "1" prepended. Returns null for anything
// that doesn't look like a real number, so it's skipped rather than guessed.
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  let international = trimmed.startsWith("+");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  }
  const nanp = /^[2-9]\d{2}[2-9]\d{6}$/; // area code + exchange can't start with 0/1
  if (!international && digits.length === 10) return nanp.test(digits) ? "1" + digits : null;
  if (digits.length === 11 && digits.startsWith("1")) return nanp.test(digits.slice(1)) ? digits : null;
  if (international && digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")) return digits;
  if (!international && digits.length >= 12 && digits.length <= 15 && !digits.startsWith("0")) return digits;
  return null;
}

// For logs: enough to tell numbers apart, not enough to read one out.
export function maskNumber(n: string): string {
  return n.length <= 4 ? "****" : `${"*".repeat(n.length - 4)}${n.slice(-4)}`;
}

export async function sendWhatsApp(cfg: WhatsAppConfig, number: string, text: string): Promise<void> {
  const resp = await fetch(`${cfg.url}/message/sendText/${encodeURIComponent(cfg.instance)}`, {
    method: "POST",
    headers: { "apikey": cfg.apiKey, "Content-Type": "application/json" },
    // delay = milliseconds of "typing…" shown before the message lands.
    body: JSON.stringify({ number, text, delay: 1200, linkPreview: false }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Evolution ${resp.status}: ${body.slice(0, 300)}`);
  }
}

// Waits a random time in [minMs, maxMs). Evenly spaced bursts are what
// WhatsApp's spam detection looks for.
export function pause(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}

// Players don't carry a phone number; their approved registrations do.
// Returns player_id -> WhatsApp number for the tournament's approved entries
// (the most recent entry wins when a player registered more than once).
// Players whose number is missing or unusable are left out.
export async function registeredNumbers(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("pending_registrations")
    .select("approved_player_id, player_phone, approved_partner_id, partner_phone")
    .eq("tournament_id", tournamentId)
    .eq("status", "approved")
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(`registrations: ${error.message}`);
  const out = new Map<string, string>();
  for (const r of data ?? []) {
    const own = toWhatsAppNumber(r.player_phone);
    if (r.approved_player_id && own) out.set(r.approved_player_id, own);
    const partner = toWhatsAppNumber(r.partner_phone);
    if (r.approved_partner_id && partner) out.set(r.approved_partner_id, partner);
  }
  return out;
}

// "Asha", "Asha & Ravi", "Asha, Ravi & Meena": one message per number even
// when a parent's phone is on several players' entries.
export function joinNames(names: string[]): string {
  const first = names.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);
  const unique = [...new Set(first)];
  if (unique.length <= 1) return unique[0] ?? "there";
  return `${unique.slice(0, -1).join(", ")} & ${unique[unique.length - 1]}`;
}
