// supabase/functions/whatsapp-send/index.ts
//
// Sends what's waiting in whatsapp_outbox, one message at a time with a
// random gap, so a burst of court calls goes out as a steady trickle.
// Woken by the functions that queue messages, and every minute by pg_cron
// while anything is due. Only one copy sends at a time (a lease row); a
// second wake-up while it's busy just returns.
//
// Answers straight away and sends in the background for up to ~100 s;
// whatever's left is picked up by the next wake-up.
// A failed message is retried a minute later, 3 tries in total.
// Deployed with JWT checks off; every request must carry the internal secret.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { json, serveWithCors } from "../_shared/http.ts";
import { hasSecret, maskNumber, pause, sendWhatsApp, whatsappConfig, type WhatsAppConfig } from "../_shared/whatsapp.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const LEASE_SECONDS = 140;
const BUDGET_MS = 100_000;

type Row = {
  id: number;
  jid: string;
  body: string;
  kind: "reply" | "court_call" | "day_before";
  match_id: string | null;
  player_ids: string[];
  attempts: number;
};

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await hasSecret(req, "x-internal-secret", "WHATSAPP_INTERNAL_SECRET"))) return json({ error: "forbidden" }, 403);
  const cfg = whatsappConfig();
  if (!cfg) return json({ skipped: "WhatsApp server not configured" }, 200);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: took, error } = await supabase.rpc("take_whatsapp_lease", { p_seconds: LEASE_SECONDS });
  if (error) return json({ error: error.message }, 500);
  if (took !== true) return json({ busy: true }, 200);

  const work = drain(supabase, cfg).catch((e) =>
    console.error("whatsapp-send drain failed:", e instanceof Error ? e.message : e)
  );
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  return json({ started: true }, 202);
}

async function drain(supabase: SupabaseClient, cfg: WhatsAppConfig): Promise<void> {
  const started = Date.now();
  const inBudget = () => Date.now() - started < BUDGET_MS;
  let sent = 0, failed = 0, holding = true;
  try {
    while (holding) {
      while (inBudget()) {
        const { data, error } = await supabase.rpc("next_whatsapp_message");
        if (error) throw new Error(`next: ${error.message}`);
        const row = (data ?? [])[0] as Row | undefined;
        if (!row) break;
        const ok = await deliver(supabase, cfg, row);
        if (ok) sent++;
        else failed++;
        // Day-before messages go slower: they're many, to different chats,
        // and nobody is waiting on them.
        if (row.kind === "day_before") await pause(5000, 9000);
        else await pause(2000, 4000);
      }
      await release(supabase);
      holding = false;
      // A message queued while this pass was finishing found us busy and
      // was told so; pick it up now rather than at the next minute.
      if (!inBudget()) break;
      const { count } = await supabase.from("whatsapp_outbox").select("id", { count: "exact", head: true })
        .eq("status", "queued").lte("not_before", new Date().toISOString());
      if (!count) break;
      const { data: again } = await supabase.rpc("take_whatsapp_lease", { p_seconds: LEASE_SECONDS });
      holding = again === true;
    }
  } finally {
    if (holding) await release(supabase);
    console.log(`whatsapp-send: ${sent} sent, ${failed} failed in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

// If this fails the lease simply runs out after LEASE_SECONDS.
async function release(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("release_whatsapp_lease");
  if (error) console.error("whatsapp-send couldn't release its lease:", error.message);
}

async function deliver(supabase: SupabaseClient, cfg: WhatsAppConfig, row: Row): Promise<boolean> {
  try {
    await sendWhatsApp(cfg, row.jid, row.body);
    await supabase.from("whatsapp_outbox")
      .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
      .eq("id", row.id);
    await logCourtCall(supabase, row, "sent", null);
    return true;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.error("whatsapp failed for", maskNumber(row.jid), msg);
    const final = row.attempts >= 3;
    await supabase.from("whatsapp_outbox").update(final
      ? { status: "failed", error_message: msg }
      : { status: "queued", error_message: msg, not_before: new Date(Date.now() + 60_000).toISOString() })
      .eq("id", row.id);
    if (final) await logCourtCall(supabase, row, "failed", msg);
    return false;
  }
}

// Court calls also show up in notification_log next to email and push.
async function logCourtCall(supabase: SupabaseClient, row: Row, status: "sent" | "failed", error: string | null) {
  if (row.kind !== "court_call" || !row.match_id) return;
  for (const playerId of row.player_ids) {
    await supabase.from("notification_log").insert({
      match_id: row.match_id,
      player_id: playerId,
      channel: "whatsapp",
      status,
      error_message: error,
    });
  }
}
