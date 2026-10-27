// supabase/functions/whatsapp-reminders/index.ts
//
// "Get ready for tomorrow" WhatsApp message to every registered player of a
// tournament that starts tomorrow. Called three ways:
//   - by pg_cron every 5 minutes during the evening before the event, with
//     x-internal-secret (see 20261027120000_whatsapp_notifications.sql).
//     Each call sends a small batch; the next call picks up the rest.
//   - by an admin with { tournament_id, dry_run: true }: lists who would get
//     the message and who has no usable number, sends nothing.
//   - by an admin with { tournament_id, test_number }: sends the message to
//     that one number only, to check the WhatsApp server works.
// Each number is claimed in whatsapp_reminders before sending, so a number
// is never messaged twice; a failed send is retried on later calls (3 tries).
// Deployed with JWT checks off (the database sends no JWT).
//
// Secrets: WHATSAPP_REMINDER_SECRET (matches Vault's whatsapp_reminder_secret),
// the EVOLUTION_* values (_shared/whatsapp.ts), and the platform's SUPABASE_*.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireAdmin } from "../_shared/admin.ts";
import { isUuid, json, serveWithCors } from "../_shared/http.ts";
import {
  joinNames,
  maskNumber,
  pause,
  registeredNumbers,
  sendWhatsApp,
  toWhatsAppNumber,
  whatsappConfig,
} from "../_shared/whatsapp.ts";

// The tournaments are in Abbotsford; "tomorrow" is the Pacific calendar day.
const TIME_ZONE = "America/Vancouver";
// Sends per call. With 5–9 s gaps a batch takes about a minute, well inside
// the Edge Function time limit; cron calls again 5 minutes later.
const BATCH = 8;

type Tournament = {
  id: string;
  name: string;
  event_date: string | null;
  event_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_map_url: string | null;
  whatsapp_enabled: boolean;
};

const TOURNAMENT_FIELDS =
  "id, name, event_date, event_time, venue_name, venue_address, venue_map_url, whatsapp_enabled";

async function fromDatabase(req: Request): Promise<boolean> {
  const expected = Deno.env.get("WHATSAPP_REMINDER_SECRET");
  const given = req.headers.get("x-internal-secret");
  if (!expected || !given) return false;
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(expected), digest(given)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const internal = await fromDatabase(req);
  if (!internal && !(await requireAdmin(req))) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const cfg = whatsappConfig();

  try {
    // Admin tools for one tournament.
    if (!internal) {
      if (!isUuid(body?.tournament_id)) return json({ error: "tournament_id required" }, 400);
      const { data: t, error } = await supabase.from("tournaments").select(TOURNAMENT_FIELDS)
        .eq("id", body.tournament_id).maybeSingle();
      if (error || !t) return json({ error: "tournament not found" }, 404);
      if (typeof body?.test_number === "string") {
        if (!cfg) return json({ error: "WhatsApp server not configured (EVOLUTION_* secrets)" }, 409);
        const number = toWhatsAppNumber(body.test_number);
        if (!number) return json({ error: "that doesn't look like a phone number" }, 400);
        await sendWhatsApp(cfg, number, reminderText(t as Tournament, "Test"));
        return json({ sent: 1, to: maskNumber(number) }, 200);
      }
      const { groups, noNumber } = await audience(supabase, t as Tournament);
      return json({
        dry_run: true,
        whatsapp_enabled: (t as Tournament).whatsapp_enabled,
        server_configured: cfg !== null,
        recipients: [...groups].map(([n, g]) => ({ to: maskNumber(n), names: g.names })),
        no_usable_number: noNumber,
      }, 200);
    }

    // Scheduled run: tournaments starting tomorrow with WhatsApp switched on.
    if (!cfg) return json({ skipped: "WhatsApp server not configured" }, 200);
    const tomorrow = pacificDate(1);
    const { data: due, error } = await supabase.from("tournaments").select(TOURNAMENT_FIELDS)
      .eq("whatsapp_enabled", true).eq("event_date", tomorrow);
    if (error) throw new Error(`tournaments: ${error.message}`);

    let sent = 0, failed = 0, remaining = 0;
    for (const t of (due ?? []) as Tournament[]) {
      const { groups } = await audience(supabase, t);
      const { data: done } = await supabase.from("whatsapp_reminders").select("phone, status, attempts")
        .eq("tournament_id", t.id).eq("kind", "day_before");
      const finished = new Set(
        (done ?? []).filter((d) => d.status === "sent" || d.attempts >= 3).map((d) => d.phone),
      );
      const todo = [...groups].filter(([n]) => !finished.has(n));
      for (const [number, g] of todo) {
        if (sent + failed >= BATCH) {
          remaining++;
          continue;
        }
        const { data: claimed } = await supabase.rpc("claim_whatsapp_reminder", {
          p_tournament_id: t.id, p_kind: "day_before", p_phone: number, p_player_ids: g.playerIds,
        });
        if (claimed !== true) continue; // sent already, or another call has it
        if (sent + failed > 0) await pause(5000, 9000);
        try {
          await sendWhatsApp(cfg, number, reminderText(t, joinNames(g.names)));
          await supabase.from("whatsapp_reminders")
            .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
            .eq("tournament_id", t.id).eq("kind", "day_before").eq("phone", number);
          sent++;
        } catch (e) {
          const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
          console.error("reminder failed for", maskNumber(number), msg);
          await supabase.from("whatsapp_reminders").update({ status: "failed", error_message: msg })
            .eq("tournament_id", t.id).eq("kind", "day_before").eq("phone", number);
          failed++;
        }
      }
    }
    return json({ sent, failed, remaining }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("whatsapp-reminders error:", msg);
    return json({ error: msg }, 500);
  }
}

// Active players of the tournament, grouped by WhatsApp number.
async function audience(supabase: SupabaseClient, t: Tournament) {
  const numbers = await registeredNumbers(supabase, t.id);
  const { data: players, error } = await supabase.from("players").select("id, name")
    .eq("tournament_id", t.id).eq("active", true).order("name");
  if (error) throw new Error(`players: ${error.message}`);
  const groups = new Map<string, { names: string[]; playerIds: string[] }>();
  const noNumber: string[] = [];
  for (const p of players ?? []) {
    const number = numbers.get(p.id);
    if (!number) {
      noNumber.push(p.name);
      continue;
    }
    const g = groups.get(number) ?? { names: [], playerIds: [] };
    g.names.push(p.name);
    g.playerIds.push(p.id);
    groups.set(number, g);
  }
  return { groups, noNumber };
}

// YYYY-MM-DD of today + offset days on the Pacific calendar.
function pacificDate(offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function reminderText(t: Tournament, names: string): string {
  const day = t.event_date
    ? new Date(`${t.event_date}T12:00:00Z`).toLocaleDateString("en-CA", {
      weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
    })
    : "tomorrow";
  const time = t.event_time ? formatTime(t.event_time) : null;
  const where = [t.venue_name, t.venue_address].filter(Boolean).join(", ");
  return [
    `🏸 Hi ${names}! Get ready: *${t.name}* is tomorrow, ${day}.`,
    "",
    time ? `⏰ Starts at ${time}` : null,
    where ? `📍 ${where}` : null,
    t.venue_map_url ? t.venue_map_url : null,
    "",
    "Tomorrow we'll message you here when your court is ready. See you on court!",
  ].filter((l) => l !== null).join("\n");
}

// "09:30:00" -> "9:30 AM"
function formatTime(hms: string): string {
  const [h, m] = hms.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}
