// WhatsApp updates through a self-hosted Evolution API server (Baileys
// mode: a spare phone linked like WhatsApp Web, no per-message cost).
//
// Opt-in only: a player messages the club number with their code first
// (whatsapp-inbound records it), and only those chats get updates. Every
// outgoing message is queued in whatsapp_outbox and sent by whatsapp-send,
// one at a time with gaps.
//
// Function secrets. Without the EVOLUTION_* ones nothing is queued or sent,
// and email and push carry on as before:
//   EVOLUTION_API_URL         - e.g. https://wa.adawar.org
//   EVOLUTION_API_KEY         - the server's AUTHENTICATION_API_KEY
//   EVOLUTION_INSTANCE        - the instance the phone is linked to
//   WHATSAPP_INTERNAL_SECRET  - matches Vault's whatsapp_internal_secret
//   WHATSAPP_WEBHOOK_SECRET   - header Evolution sends to whatsapp-inbound
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

// Turns a typed phone number into the digits WhatsApp wants (country code
// first, no "+"). Only used for the admin's test message: everyone else is
// reached at the WhatsApp ID their own opt-in message came from. 10 digits
// get the North American "1". Returns null rather than guessing.
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

// For logs and admin screens: enough to tell numbers apart, not to read one.
export function maskNumber(n: string): string {
  const digits = n.split("@")[0];
  return digits.length <= 4 ? "****" : `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

// `to` is a WhatsApp ID (123@s.whatsapp.net / 123@lid) or plain digits.
export async function sendWhatsApp(cfg: WhatsAppConfig, to: string, text: string): Promise<void> {
  const resp = await fetch(`${cfg.url}/message/sendText/${encodeURIComponent(cfg.instance)}`, {
    method: "POST",
    headers: { "apikey": cfg.apiKey, "Content-Type": "application/json" },
    // delay = milliseconds of "typing…" shown before the message lands.
    body: JSON.stringify({ number: to, text, delay: 1200, linkPreview: false }),
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

// "Asha", "Asha & Ravi", "Asha, Ravi & Meena": one message per chat even
// when a parent's phone opted in for several players.
export function joinNames(names: string[]): string {
  const first = names.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);
  const unique = [...new Set(first)];
  if (unique.length <= 1) return unique[0] ?? "there";
  return `${unique.slice(0, -1).join(", ")} & ${unique[unique.length - 1]}`;
}

// ---- Opt-in codes and commands -------------------------------------------

// The code a player sends: the first 8 characters of their registration id.
// The success screen builds the same thing (src/lib/whatsapp.ts).
export function optinCode(registrationId: string): string {
  return registrationId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export type Command = { kind: "stop" } | { kind: "start" } | { kind: "join"; code: string };

// What an incoming message asks for, or null for anything else (ordinary
// chat gets no automatic reply).
export function parseCommand(text: string): Command | null {
  const t = text.trim();
  if (/^(stop|unsubscribe)\b/i.test(t)) return { kind: "stop" };
  if (/^(start|resume)\b/i.test(t)) return { kind: "start" };
  // "... My code: 1A2B3C4D" from the button, or the code on its own.
  const code = t.match(/\bcode\W{0,3}([0-9a-f]{8})\b/i) ?? t.match(/^([0-9a-f]{8})$/i);
  if (code) return { kind: "join", code: code[1].toUpperCase() };
  return null;
}

// ---- Who gets updates ----------------------------------------------------

// player_id -> WhatsApp ID for players of the tournament who opted in (and
// haven't sent STOP) on an approved entry.
export async function optedInChats(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("whatsapp_optins")
    .select("jid, role, opted_in_at, pending_registrations!inner(status, approved_player_id, approved_partner_id)")
    .eq("tournament_id", tournamentId)
    .is("opted_out_at", null)
    .order("opted_in_at", { ascending: true });
  if (error) throw new Error(`opt-ins: ${error.message}`);
  const out = new Map<string, string>();
  for (const row of data ?? []) {
    const reg = row.pending_registrations as unknown as {
      status: string; approved_player_id: string | null; approved_partner_id: string | null;
    };
    if (reg.status !== "approved") continue;
    const playerId = row.role === "partner" ? reg.approved_partner_id : reg.approved_player_id;
    if (playerId) out.set(playerId, row.jid);
  }
  return out;
}

// ---- Queue ---------------------------------------------------------------

export type OutboxRow = {
  jid: string;
  body: string;
  kind: "reply" | "court_call" | "day_before";
  priority?: number;
  tournament_id?: string | null;
  match_id?: string | null;
  player_ids?: string[];
  dedupe_key?: string | null;
};

// Queues messages (rows whose dedupe_key is already there are skipped) and
// wakes the sender. Returns how many were queued.
export async function enqueue(supabase: SupabaseClient, rows: OutboxRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  // Same columns on every row: a bulk insert sends NULL for any column
  // that only some rows set.
  const full = rows.map((r) => ({
    jid: r.jid,
    body: r.body,
    kind: r.kind,
    priority: r.priority ?? 1,
    tournament_id: r.tournament_id ?? null,
    match_id: r.match_id ?? null,
    player_ids: r.player_ids ?? [],
    dedupe_key: r.dedupe_key ?? null,
  }));
  const { data, error } = await supabase
    .from("whatsapp_outbox")
    .upsert(full, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`queue: ${error.message}`);
  await wakeSender();
  return data?.length ?? 0;
}

// Asks whatsapp-send to drain the queue. It answers at once and sends in
// the background; if it's already sending, the new rows are picked up on
// its next pass. A failure here is fine: pg_cron wakes it every minute.
export async function wakeSender(): Promise<void> {
  const secret = Deno.env.get("WHATSAPP_INTERNAL_SECRET");
  const base = Deno.env.get("SUPABASE_URL");
  if (!secret || !base) return;
  try {
    await fetch(`${base}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.error("couldn't wake whatsapp-send:", e instanceof Error ? e.message : e);
  }
}

// ---- Request checks ------------------------------------------------------

// True when the request carries `header` equal to the secret in env var
// `envName`. Compares digests so the check takes the same time whatever
// the input.
export async function hasSecret(req: Request, header: string, envName: string): Promise<boolean> {
  const expected = Deno.env.get(envName);
  const given = req.headers.get(header);
  if (!expected || !given) return false;
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(expected), digest(given)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
