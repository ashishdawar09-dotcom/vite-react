// supabase/functions/whatsapp-inbound/index.ts
//
// Webhook for messages people send to the club's WhatsApp number. The
// Evolution API server calls it for every incoming message (event
// MESSAGES_UPSERT) with an x-webhook-secret header. Handles three things:
//   "... My code: 1A2B3C4D"  -> opts this chat in for that registration
//                              (up to 3 chats per entry), replies once
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
    key?: { id?: string; remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean };
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

  // A chat can arrive as the phone-number ID or as WhatsApp's private
  // "@lid" ID (Evolution swaps in the phone ID when it knows it). Send to
  // the phone ID when there is one; keep the other to match STOP/START.
  const ids = [...new Set([key.remoteJid, key.remoteJidAlt]
    .filter((j): j is string => !!j && /@(s\.whatsapp\.net|lid)$/.test(j)))];
  if (ids.length === 0) return json({ ignored: "not a person" }, 200);
  const jid = ids.find((j) => j.endsWith("@s.whatsapp.net")) ?? ids[0];
  const chat: Chat = { jid, alt: ids.find((j) => j !== jid) ?? null, ids };
  // Evolution retries a webhook that failed; one reply per message.
  const replyKey = key.id ? `in:${key.id}` : null;

  const text = body.data?.message?.conversation ?? body.data?.message?.extendedTextMessage?.text ?? "";
  const command = parseCommand(text);
  if (!command) return json({ ignored: "no command" }, 200);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Someone typing codes over and over gets ignored, not answered.
  if (!(await allow(supabase, "whatsapp-inbound", jid, 20, 3600))) return json({ ignored: "rate limit" }, 200);

  try {
    if (command.kind === "join") {
      return json(await join(supabase, chat, command.code, command.labelled, replyKey, body.data?.pushName), 200);
    }
    if (command.kind === "stop") return json(await stop(supabase, chat, replyKey), 200);
    return json(await restart(supabase, chat, replyKey), 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("whatsapp-inbound error for", maskNumber(jid), msg);
    return json({ error: msg }, 500);
  }
}

type Chat = { jid: string; alt: string | null; ids: string[] };

// PostgREST in-list of chat IDs, quoted.
const inList = (ids: string[]) => `(${ids.map((i) => `"${i}"`).join(",")})`;

// At most this many chats can opt in for one entry (a player and a parent,
// say); a code that's been passed around further gets a polite no.
const MAX_CHATS_PER_ENTRY = 3;

async function join(
  supabase: SupabaseClient, chat: Chat, code: string, labelled: boolean,
  replyKey: string | null, pushName?: string,
) {
  const { jid } = chat;
  const { data: regs, error } = await supabase.rpc("registration_for_whatsapp_code", { p_code: code });
  if (error) throw new Error(`code lookup: ${error.message}`);
  const reg = (regs ?? [])[0] as { id: string; tournament_id: string; player_name: string } | undefined;
  if (!reg) {
    if (!labelled) return { joined: false, reason: "not a code" };
    await enqueue(supabase, [{
      jid, kind: "reply", priority: 0, dedupe_key: replyKey,
      body: "Sorry, we couldn't match that code to a registration. Please use the WhatsApp button on your registration confirmation page.",
    }]);
    return { joined: false, reason: "unknown code" };
  }

  const { data: t } = await supabase.from("tournaments").select("name, whatsapp_enabled")
    .eq("id", reg.tournament_id).single();
  // The button only shows while WhatsApp is on; anything else is stale.
  if (!t?.whatsapp_enabled) return { joined: false, reason: "WhatsApp off for this tournament" };

  // Already opted in from this chat (in either ID form)? Then it's a re-join.
  const { data: existing, error: exErr } = await supabase.from("whatsapp_optins")
    .select("id, jid, jid_alt")
    .eq("registration_id", reg.id).eq("role", "player");
  if (exErr) throw new Error(`opt-ins: ${exErr.message}`);
  const mine = (existing ?? []).find((r) => chat.ids.includes(r.jid) || (r.jid_alt && chat.ids.includes(r.jid_alt)));
  if (!mine && (existing ?? []).length >= MAX_CHATS_PER_ENTRY) {
    await enqueue(supabase, [{
      jid, kind: "reply", priority: 0, dedupe_key: replyKey, tournament_id: reg.tournament_id,
      body: `Sorry, ${MAX_CHATS_PER_ENTRY} phones already get updates for that entry. Please ask the organisers if you need this one added.`,
    }]);
    return { joined: false, reason: "too many chats" };
  }

  // A re-join may carry only one of the chat's two IDs: keep what we knew,
  // with the phone-number ID as the one we send to.
  const known = [...new Set([...chat.ids, mine?.jid, mine?.jid_alt].filter((j): j is string => !!j))];
  const sendTo = known.find((j) => j.endsWith("@s.whatsapp.net")) ?? known[0];
  const row = {
    jid: sendTo,
    jid_alt: known.find((j) => j !== sendTo) ?? null,
    push_name: pushName?.slice(0, 100) ?? null,
    opted_in_at: new Date().toISOString(),
    opted_out_at: null,
  };
  const { error: upErr } = mine
    ? await supabase.from("whatsapp_optins").update(row).eq("id", mine.id)
    : await supabase.from("whatsapp_optins").insert({
      ...row, registration_id: reg.id, tournament_id: reg.tournament_id, role: "player",
    });
  if (upErr) throw new Error(`opt-in: ${upErr.message}`);

  await enqueue(supabase, [{
    jid: sendTo, kind: "reply", priority: 0, tournament_id: reg.tournament_id, dedupe_key: replyKey,
    body:
`✅ Thanks ${joinNames([reg.player_name])}! You'll get WhatsApp updates for *${t.name}* here:
• a reminder the evening before
• a message when your court is ready

Reply STOP anytime to turn them off.`,
  }]);
  return { joined: true };
}

async function stop(supabase: SupabaseClient, chat: Chat, replyKey: string | null) {
  const { jid, ids } = chat;
  const { data, error } = await supabase.from("whatsapp_optins")
    .update({ opted_out_at: new Date().toISOString() })
    .or(`jid.in.${inList(ids)},jid_alt.in.${inList(ids)}`).is("opted_out_at", null)
    .select("id, jid");
  if (error) throw new Error(`stop: ${error.message}`);
  if (!data?.length) return { stopped: 0 };
  // Anything already queued for this chat goes too. Clearing dedupe_key
  // lets it be queued again if they send START later the same evening.
  const stored = [...new Set([...ids, ...data.map((r) => r.jid)])];
  await supabase.from("whatsapp_outbox")
    .update({ status: "cancelled", error_message: "player sent STOP", dedupe_key: null })
    .in("jid", stored).eq("status", "queued");
  await enqueue(supabase, [{
    jid, kind: "reply", priority: 0, dedupe_key: replyKey,
    body: "You won't get any more updates here. Reply START if you change your mind.",
  }]);
  return { stopped: data.length };
}

async function restart(supabase: SupabaseClient, chat: Chat, replyKey: string | null) {
  const { jid, ids } = chat;
  const { data, error } = await supabase.from("whatsapp_optins")
    .update({ opted_out_at: null })
    .or(`jid.in.${inList(ids)},jid_alt.in.${inList(ids)}`).not("opted_out_at", "is", null)
    .select("id");
  if (error) throw new Error(`start: ${error.message}`);
  if (!data?.length) return { restarted: 0 };
  await enqueue(supabase, [{
    jid, kind: "reply", priority: 0, dedupe_key: replyKey,
    body: "✅ Updates are back on. Reply STOP anytime to turn them off.",
  }]);
  return { restarted: data.length };
}
