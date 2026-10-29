// supabase/functions/whatsapp-inbound/index.ts
//
// Webhook for messages people send to the club's WhatsApp number. The
// Evolution API server calls it for every incoming message (event
// MESSAGES_UPSERT) with an x-webhook-secret header. Handles three things:
//   "... My code: 1A2B3C4D"  -> opts that registration in, replies once
//   STOP                     -> no more updates to this chat
//   START                    -> updates back on
// Everything else is left for a person to read on the phone: no automatic
// reply, so ordinary questions never get a robot answer.
// Deployed with JWT checks off (Evolution sends no JWT).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { allow, json, serveWithCors } from "../_shared/http.ts";
import { enqueue, hasSecret, joinNames, maskNumber, parseCommand } from "../_shared/whatsapp.ts";

type Incoming = {
  event?: string;
  data?: {
    key?: { remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean };
    pushName?: string;
    message?: { conversation?: string; extendedTextMessage?: { text?: string } };
  };
};

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await hasSecret(req, "x-webhook-secret", "WHATSAPP_WEBHOOK_SECRET"))) {
    return json({ error: "forbidden" }, 403);
  }

  const body: Incoming = await req.json().catch(() => ({}));
  if (!/^messages[._]upsert$/i.test(body.event ?? "")) return json({ ignored: "event" }, 200);
  const key = body.data?.key;
  if (!key || key.fromMe) return json({ ignored: "own message" }, 200);

  // Evolution swaps WhatsApp's private "@lid" IDs for the phone ID when it
  // knows it; take whichever is a person's chat.
  const jid = [key.remoteJid, key.remoteJidAlt].find((j) => j?.endsWith("@s.whatsapp.net"))
    ?? key.remoteJid ?? "";
  if (!/@(s\.whatsapp\.net|lid)$/.test(jid)) return json({ ignored: "not a person" }, 200);

  const text = body.data?.message?.conversation ?? body.data?.message?.extendedTextMessage?.text ?? "";
  const command = parseCommand(text);
  if (!command) return json({ ignored: "no command" }, 200);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Someone typing codes over and over gets ignored, not answered.
  if (!(await allow(supabase, "whatsapp-inbound", jid, 20, 3600))) return json({ ignored: "rate limit" }, 200);

  try {
    if (command.kind === "join") return json(await join(supabase, jid, command.code, body.data?.pushName), 200);
    if (command.kind === "stop") return json(await stop(supabase, jid), 200);
    return json(await restart(supabase, jid), 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("whatsapp-inbound error for", maskNumber(jid), msg);
    return json({ error: msg }, 500);
  }
}

async function join(supabase: SupabaseClient, jid: string, code: string, pushName?: string) {
  const { data: regs, error } = await supabase.rpc("registration_for_whatsapp_code", { p_code: code });
  if (error) throw new Error(`code lookup: ${error.message}`);
  const reg = (regs ?? [])[0] as { id: string; tournament_id: string; player_name: string } | undefined;
  if (!reg) {
    await enqueue(supabase, [{
      jid, kind: "reply", priority: 0,
      body: "Sorry, we couldn't match that code to a registration. Please use the WhatsApp button on your registration confirmation page.",
    }]);
    return { joined: false, reason: "unknown code" };
  }

  const { data: t } = await supabase.from("tournaments").select("name, whatsapp_enabled")
    .eq("id", reg.tournament_id).single();
  // The button only shows while WhatsApp is on; anything else is stale.
  if (!t?.whatsapp_enabled) return { joined: false, reason: "WhatsApp off for this tournament" };

  const { error: upErr } = await supabase.from("whatsapp_optins").upsert({
    registration_id: reg.id,
    tournament_id: reg.tournament_id,
    role: "player",
    jid,
    push_name: pushName?.slice(0, 100) ?? null,
    opted_in_at: new Date().toISOString(),
    opted_out_at: null,
  }, { onConflict: "registration_id,role" });
  if (upErr) throw new Error(`opt-in: ${upErr.message}`);

  await enqueue(supabase, [{
    jid, kind: "reply", priority: 0, tournament_id: reg.tournament_id,
    body:
`✅ Thanks ${joinNames([reg.player_name])}! You'll get WhatsApp updates for *${t.name}* here:
• a reminder the evening before
• a message when your court is ready

Reply STOP anytime to turn them off.`,
  }]);
  return { joined: true };
}

async function stop(supabase: SupabaseClient, jid: string) {
  const { data, error } = await supabase.from("whatsapp_optins")
    .update({ opted_out_at: new Date().toISOString() })
    .eq("jid", jid).is("opted_out_at", null)
    .select("id");
  if (error) throw new Error(`stop: ${error.message}`);
  if (!data?.length) return { stopped: 0 };
  // Anything already queued for this chat goes too. Clearing dedupe_key
  // lets it be queued again if they send START later the same evening.
  await supabase.from("whatsapp_outbox")
    .update({ status: "cancelled", error_message: "player sent STOP", dedupe_key: null })
    .eq("jid", jid).eq("status", "queued");
  await enqueue(supabase, [{
    jid, kind: "reply", priority: 0,
    body: "You won't get any more updates here. Reply START if you change your mind.",
  }]);
  return { stopped: data.length };
}

async function restart(supabase: SupabaseClient, jid: string) {
  const { data, error } = await supabase.from("whatsapp_optins")
    .update({ opted_out_at: null })
    .eq("jid", jid).not("opted_out_at", "is", null)
    .select("id");
  if (error) throw new Error(`start: ${error.message}`);
  if (!data?.length) return { restarted: 0 };
  await enqueue(supabase, [{
    jid, kind: "reply", priority: 0,
    body: "✅ Updates are back on. Reply STOP anytime to turn them off.",
  }]);
  return { restarted: data.length };
}
