// supabase/functions/whatsapp-reminders/index.ts
//
// "Get ready for tomorrow" WhatsApp message for players who opted in, for
// tournaments that start tomorrow with WhatsApp on. Called three ways:
//   - by pg_cron every 5 minutes, 6 to 9 pm Pacific the evening before
//     (queue_whatsapp_reminders), with x-internal-secret. Queues one
//     message per chat; whatsapp-send delivers them a few seconds apart.
//     A chat is queued only once (dedupe key), so later calls only add
//     people who opted in since.
//   - by an admin with { tournament_id, dry_run: true }: who would get it
//     (opted in) and who hasn't opted in. Sends nothing.
//   - by an admin with { tournament_id, test_number }: sends the message
//     straight to that one number (your own), to check the server works.
// Deployed with JWT checks off (the database sends no JWT).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireAdmin } from "../_shared/admin.ts";
import { isUuid, json, serveWithCors } from "../_shared/http.ts";
import {
  enqueue,
  hasSecret,
  joinNames,
  maskNumber,
  optedInChats,
  sendWhatsApp,
  toWhatsAppNumber,
  whatsappConfig,
} from "../_shared/whatsapp.ts";

// The tournaments are in Abbotsford; "tomorrow" is the Pacific calendar day.
const TIME_ZONE = "America/Vancouver";

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

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const internal = await hasSecret(req, "x-internal-secret", "WHATSAPP_INTERNAL_SECRET");
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
      const { chats, notOptedIn } = await audience(supabase, t as Tournament);
      return json({
        dry_run: true,
        whatsapp_enabled: (t as Tournament).whatsapp_enabled,
        server_configured: cfg !== null,
        recipients: [...chats].map(([jid, g]) => ({ to: maskNumber(jid), names: g.names })),
        not_opted_in: notOptedIn,
      }, 200);
    }

    // Scheduled run: tournaments starting tomorrow with WhatsApp switched on.
    if (!cfg) return json({ skipped: "WhatsApp server not configured" }, 200);
    const { data: due, error } = await supabase.from("tournaments").select(TOURNAMENT_FIELDS)
      .eq("whatsapp_enabled", true).eq("event_date", pacificDate(1));
    if (error) throw new Error(`tournaments: ${error.message}`);

    let queued = 0;
    for (const t of (due ?? []) as Tournament[]) {
      const { chats } = await audience(supabase, t);
      // A message that failed 3 times frees its slot so a later run can try
      // again (the phone may have been offline for a few minutes); after 2
      // such rounds, leave that chat alone for the evening.
      const { data: failedRows, error: failErr } = await supabase.from("whatsapp_outbox").select("jid")
        .eq("tournament_id", t.id).eq("kind", "day_before").eq("status", "failed");
      if (failErr) throw new Error(`failed rows: ${failErr.message}`);
      const failures = new Map<string, number>();
      for (const f of failedRows ?? []) failures.set(f.jid, (failures.get(f.jid) ?? 0) + 1);
      const todo = [...chats].filter(([jid]) => (failures.get(jid) ?? 0) < 2);
      queued += await enqueue(supabase, todo.map(([jid, g]) => ({
        jid,
        kind: "day_before" as const,
        priority: 1,
        tournament_id: t.id,
        player_ids: g.playerIds,
        dedupe_key: `day_before:${t.id}:${jid}`,
        body: reminderText(t, joinNames(g.names)),
      })));
    }
    return json({ queued }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("whatsapp-reminders error:", msg);
    return json({ error: msg }, 500);
  }
}

// Active players of the tournament, grouped by the chats that opted in for
// them, and the names of those who haven't opted in.
async function audience(supabase: SupabaseClient, t: Tournament) {
  const optedIn = await optedInChats(supabase, t.id);
  const { data: players, error } = await supabase.from("players").select("id, name")
    .eq("tournament_id", t.id).eq("active", true).order("name");
  if (error) throw new Error(`players: ${error.message}`);
  const chats = new Map<string, { names: string[]; playerIds: string[] }>();
  const notOptedIn: string[] = [];
  for (const p of players ?? []) {
    const jids = optedIn.get(p.id) ?? [];
    if (jids.length === 0) notOptedIn.push(p.name);
    for (const jid of jids) {
      const g = chats.get(jid) ?? { names: [], playerIds: [] };
      g.names.push(p.name);
      g.playerIds.push(p.id);
      chats.set(jid, g);
    }
  }
  return { chats, notOptedIn };
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
    "",
    "(Reply STOP to stop these updates.)",
  ].filter((l) => l !== null).join("\n");
}

// "09:30:00" -> "9:30 AM"
function formatTime(hms: string): string {
  const [h, m] = hms.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}
