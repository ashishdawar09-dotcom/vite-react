// supabase/functions/whatsapp-inbound/index.ts
//
// Webhook for messages people send to the club's WhatsApp number. The
// Evolution API server calls it for every incoming message (event
// MESSAGES_UPSERT) with an x-webhook-secret header. Handles three things:
//   "... My code: 1A2B3C4D"  -> opts this chat in for that registration's
//                              player (first 8 characters of its id) or
//                              doubles partner (last 8), up to 3 chats per
//                              person, and replies once
//   STOP                     -> no more updates to this chat
//   START                    -> updates back on
// A chat has two IDs: its phone number (…@s.whatsapp.net) and WhatsApp's
// private "@lid" ID. Each message carries only one of them (the phone one
// whenever Evolution knows it), and there's no reliable way to look up one
// from the other. See linkOnJoin for how the two are tied together, and
// unmatchedStop for a STOP under the form we don't have.
// Everything else is left for a person to read on the phone: no automatic
// reply, so ordinary questions never get a robot answer.
// Deployed with JWT checks off (Evolution sends no JWT).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { allow, json, serveWithCors } from "../_shared/http.ts";
import { sendEmail } from "../_shared/mailer.ts";
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

  // Send to the phone-number ID when there is one; keep any other form to
  // match STOP/START.
  const ids = [...new Set([key.remoteJid, key.remoteJidAlt]
    .filter((j): j is string => !!j && /@(s\.whatsapp\.net|lid)$/.test(j)))];
  if (ids.length === 0) return json({ ignored: "not a person" }, 200);
  const jid = ids.find((j) => j.endsWith("@s.whatsapp.net")) ?? ids[0];
  const pushName = body.data?.pushName?.trim().slice(0, 100) || null;
  const chat: Chat = { jid, alt: ids.find((j) => j !== jid) ?? null, ids, pushName };
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
      return json(await join(supabase, chat, command.code, command.labelled, replyKey), 200);
    }
    if (command.kind === "stop") return json(await stop(supabase, chat, replyKey), 200);
    return json(await restart(supabase, chat, replyKey), 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("whatsapp-inbound error for", maskNumber(jid), msg);
    return json({ error: msg }, 500);
  }
}

type Chat = { jid: string; alt: string | null; ids: string[]; pushName: string | null };

const isLid = (j: string) => j.endsWith("@lid");

// On a join (the sender has the registration code): when the entry has an
// opt-in only under the other ID form with the same WhatsApp profile name,
// it's the same chat. Ties them together: the phone ID becomes the one we
// send to, the @lid the alias, and the chat's IDs grow to include the
// stored one. Never used on STOP/START, where the sender proves nothing
// and a copied profile name must not redirect anyone's updates.
async function linkOnJoin(supabase: SupabaseClient, chat: Chat, owner: Owner): Promise<void> {
  if (chat.ids.length > 1 || !chat.pushName) return;
  const { data, error } = await supabase.from("whatsapp_optins").select("jid")
    .eq("registration_id", owner.registration_id).eq("role", owner.role)
    .is("jid_alt", null).eq("push_name", chat.pushName)
    .like("jid", isLid(chat.jid) ? "%@s.whatsapp.net" : "%@lid");
  if (error) throw new Error(`link: ${error.message}`);
  const candidates = [...new Set((data ?? []).map((r) => r.jid))];
  if (candidates.length !== 1) return;
  const { error: upErr } = await supabase.from("whatsapp_optins")
    .update({ jid_alt: chat.jid })
    .eq("registration_id", owner.registration_id).eq("role", owner.role)
    .eq("jid", candidates[0]).is("jid_alt", null);
  if (upErr) throw new Error(`link: ${upErr.message}`);
  chat.ids.push(candidates[0]);
}

// Whose code it is: the registrant ("player") or their doubles partner.
type Owner = { registration_id: string; tournament_id: string; role: "player" | "partner"; person_name: string };

// PostgREST in-list of chat IDs, quoted.
const inList = (ids: string[]) => `(${ids.map((i) => `"${i}"`).join(",")})`;

// At most this many chats can opt in for one person on an entry (a player
// and a parent, say); a code that's been passed around further gets a
// polite no.
const MAX_CHATS_PER_ENTRY = 3;

async function join(
  supabase: SupabaseClient, chat: Chat, code: string, labelled: boolean, replyKey: string | null,
) {
  const { jid } = chat;
  const { data: owners, error } = await supabase.rpc("resolve_whatsapp_code", { p_code: code });
  if (error) throw new Error(`code lookup: ${error.message}`);
  const owner = (owners ?? [])[0] as Owner | undefined;
  if (!owner) {
    if (!labelled) return { joined: false, reason: "not a code" };
    await enqueue(supabase, [{
      jid, kind: "reply", priority: 0, dedupe_key: replyKey,
      body: "Sorry, we couldn't match that code to a registration. Please check it (8 letters and numbers, from your confirmation screen or our email) and send it again, or reply to any of our emails and we'll sort it out.",
    }]);
    return { joined: false, reason: "unknown code" };
  }

  const { data: t } = await supabase.from("tournaments").select("name, whatsapp_enabled")
    .eq("id", owner.tournament_id).single();
  // The button only shows while WhatsApp is on; anything else is stale.
  if (!t?.whatsapp_enabled) return { joined: false, reason: "WhatsApp off for this tournament" };

  // Already opted in from this chat (in either ID form)? Then it's a re-join.
  await linkOnJoin(supabase, chat, owner);
  const { data: existing, error: exErr } = await supabase.from("whatsapp_optins")
    .select("id, jid, jid_alt")
    .eq("registration_id", owner.registration_id).eq("role", owner.role);
  if (exErr) throw new Error(`opt-ins: ${exErr.message}`);
  const matches = (existing ?? []).filter((r) => chat.ids.includes(r.jid) || (r.jid_alt && chat.ids.includes(r.jid_alt)));
  // Two rows for this chat (one per ID form, from before they were tied
  // together): keep one, preferring the phone ID, so nothing goes out twice.
  const mine = matches.find((r) => r.jid.endsWith("@s.whatsapp.net")) ?? matches[0];
  const extra = matches.filter((r) => r !== mine).map((r) => r.id);
  if (extra.length) {
    const { error: delErr } = await supabase.from("whatsapp_optins").delete().in("id", extra);
    if (delErr) throw new Error(`merge: ${delErr.message}`);
  }
  if (!mine && (existing ?? []).length >= MAX_CHATS_PER_ENTRY) {
    await enqueue(supabase, [{
      jid, kind: "reply", priority: 0, dedupe_key: replyKey, tournament_id: owner.tournament_id,
      body: `Sorry, ${MAX_CHATS_PER_ENTRY} phones already get updates for that entry. Please ask the organisers if you need this one added.`,
    }]);
    return { joined: false, reason: "too many chats" };
  }

  // A re-join may carry only one of the chat's two IDs: keep what we knew,
  // with the phone-number ID as the one we send to.
  const known = [...new Set([...chat.ids, ...matches.flatMap((r) => [r.jid, r.jid_alt])]
    .filter((j): j is string => !!j))];
  const sendTo = known.find((j) => j.endsWith("@s.whatsapp.net")) ?? known[0];
  const row = {
    jid: sendTo,
    jid_alt: known.find((j) => j !== sendTo) ?? null,
    push_name: chat.pushName,
    opted_in_at: new Date().toISOString(),
    opted_out_at: null,
  };
  const { error: upErr } = mine
    ? await supabase.from("whatsapp_optins").update(row).eq("id", mine.id)
    : await supabase.from("whatsapp_optins").insert({
      ...row, registration_id: owner.registration_id, tournament_id: owner.tournament_id, role: owner.role,
    });
  if (upErr) throw new Error(`opt-in: ${upErr.message}`);

  await enqueue(supabase, [{
    jid: sendTo, kind: "reply", priority: 0, tournament_id: owner.tournament_id, dedupe_key: replyKey,
    body:
`✅ Thanks ${joinNames([owner.person_name])}! You'll get WhatsApp updates for *${t.name}* here:
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
  if (!data?.length) return await unmatchedStop(supabase, chat, replyKey);
  await cancelQueued(supabase, [...new Set([...ids, ...data.map((r) => r.jid)])]);
  await enqueue(supabase, [{
    jid, kind: "reply", priority: 0, dedupe_key: replyKey,
    body: "You won't get any more updates here. Reply START if you change your mind.",
  }]);
  return { stopped: data.length };
}

// Anything already queued for these chats goes too. Clearing dedupe_key
// lets it be queued again if they send START later the same evening.
async function cancelQueued(supabase: SupabaseClient, jids: string[]) {
  await supabase.from("whatsapp_outbox")
    .update({ status: "cancelled", error_message: "player sent STOP", dedupe_key: null })
    .in("jid", jids).eq("status", "queued");
}

// Only an exact chat match turns updates back on: START from an unknown
// chat can't be tied to anyone safely (the player can send their code again).
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

// STOP from a chat with no opt-in on file. Usually a stranger: nothing is
// sent to them, so nothing happens and nobody is told. The exception is an
// opt-in stored only under the other ID form whose WhatsApp profile name
// matches the sender's: probably the same person, still getting updates.
//   - one such chat: opt it out (erring toward fewer messages; nothing is
//     redirected and no alias is recorded, so this can't be used to take
//     over anyone's updates)
//   - several: the organisers of those tournaments get an email to sort it
//     out by hand (at most one per sender a day, ten a day overall)
async function unmatchedStop(supabase: SupabaseClient, chat: Chat, replyKey: string | null) {
  if (chat.ids.length > 1 || !chat.pushName) return { stopped: 0 };
  const { data: rows, error } = await supabase.from("whatsapp_optins")
    .select("id, jid, tournament_id")
    .is("opted_out_at", null).is("jid_alt", null).eq("push_name", chat.pushName)
    .like("jid", isLid(chat.jid) ? "%@s.whatsapp.net" : "%@lid");
  if (error) throw new Error(`stop: ${error.message}`);
  const jids = [...new Set((rows ?? []).map((r) => r.jid))];
  if (jids.length === 0) return { stopped: 0 };

  if (jids.length === 1) {
    const { error: upErr } = await supabase.from("whatsapp_optins")
      .update({ opted_out_at: new Date().toISOString() })
      .eq("jid", jids[0]).is("opted_out_at", null);
    if (upErr) throw new Error(`stop: ${upErr.message}`);
    await cancelQueued(supabase, jids);
    await enqueue(supabase, [{
      jid: chat.jid, kind: "reply", priority: 0, dedupe_key: replyKey,
      body: "You won't get any more updates. To turn them back on, send your code again.",
    }]);
    return { stopped: rows!.length, matchedBy: "name" };
  }

  if (!(await allow(supabase, "wa-stop-alert", chat.jid, 1, 86400)) ||
      !(await allow(supabase, "wa-stop-alert", "all", 10, 86400))) {
    return { stopped: 0, flagged: false, reason: "alert limit" };
  }
  const tournamentIds = [...new Set((rows ?? []).map((r) => r.tournament_id))];
  const { data: ts } = await supabase.from("tournaments").select("admin_notify_emails").in("id", tournamentIds);
  const to = [...new Set((ts ?? []).flatMap((t) => (t.admin_notify_emails ?? []) as string[]))]
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const text =
`Someone sent STOP to the club's WhatsApp number from a chat (${maskNumber(chat.jid)}) we couldn't match to an opt-in, and ${jids.length} opted-in chats have the same WhatsApp name, which the sender sets themselves: "${chat.pushName}".

WhatsApp sent a different form of their ID than the one on file, so one of those players may still be getting updates. Please check whatsapp_optins for that name and set opted_out_at on the right one, or ask Claude to.`;
  const err = to.length
    ? await sendEmail({ to, subject: "WhatsApp STOP to check by hand", text, html: `<pre>${escapeHtml(text)}</pre>`, fromName: "Tournament Admin" })
    : "no admin_notify_emails";
  if (err) console.error("unmatched STOP alert not sent:", err, maskNumber(chat.jid));
  await enqueue(supabase, [{
    jid: chat.jid, kind: "reply", priority: 0, dedupe_key: replyKey,
    body: "Got it. We'll turn off your updates shortly.",
  }]);
  return { stopped: 0, flagged: true };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
