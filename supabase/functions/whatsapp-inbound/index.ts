// supabase/functions/whatsapp-inbound/index.ts
//
// Webhook for messages people send to the club's WhatsApp number. The
// Evolution API server calls it for every incoming message (event
// MESSAGES_UPSERT) with an x-webhook-secret header. Handles three things:
//   "... My code: 1A2B3C4D"  -> opts this chat in for that registration
//                              (up to 3 chats per entry), replies once
//   STOP                     -> no more updates to this chat
//   START                    -> updates back on
// A chat has two IDs: its phone number (…@s.whatsapp.net) and WhatsApp's
// private "@lid" ID. Each message carries only one of them (the phone one
// whenever Evolution knows it), and there's no reliable way to look up one
// from the other. See linkOtherForm for how the two are tied together, and
// stop() for what happens when that fails.
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

// When a message arrives under one ID form and an opt-in is on file only
// under the other, ties them together if the WhatsApp profile name is the
// same and exactly one such chat fits: the rows get this ID as jid_alt and
// the chat's IDs grow to include the stored one. Returns whether it linked.
// (A parent and a player usually have different profile names, so this
// doesn't merge two people; when it can't decide it does nothing.)
async function linkOtherForm(
  supabase: SupabaseClient, chat: Chat,
  scope: { registrationId?: string; state: "active" | "stopped" | "any" },
): Promise<boolean> {
  if (chat.ids.length > 1 || !chat.pushName) return false;
  let q = supabase.from("whatsapp_optins").select("jid")
    .is("jid_alt", null).eq("push_name", chat.pushName)
    .like("jid", isLid(chat.jid) ? "%@s.whatsapp.net" : "%@lid");
  if (scope.registrationId) q = q.eq("registration_id", scope.registrationId);
  if (scope.state === "active") q = q.is("opted_out_at", null);
  if (scope.state === "stopped") q = q.not("opted_out_at", "is", null);
  const { data, error } = await q;
  if (error) throw new Error(`link: ${error.message}`);
  const candidates = [...new Set((data ?? []).map((r) => r.jid))];
  if (candidates.length !== 1) return false;
  // Now that the phone ID is known, send to it and keep the @lid as the alias.
  const update = isLid(chat.jid)
    ? { jid_alt: chat.jid }
    : { jid: chat.jid, jid_alt: candidates[0] };
  let { error: upErr } = await supabase.from("whatsapp_optins")
    .update(update).eq("jid", candidates[0]).is("jid_alt", null);
  if (upErr && !isLid(chat.jid)) {
    // That entry already has a row under the phone ID: just record the alias.
    ({ error: upErr } = await supabase.from("whatsapp_optins")
      .update({ jid_alt: chat.jid }).eq("jid", candidates[0]).is("jid_alt", null));
  }
  if (upErr) throw new Error(`link: ${upErr.message}`);
  chat.ids.push(candidates[0]);
  return true;
}

// PostgREST in-list of chat IDs, quoted.
const inList = (ids: string[]) => `(${ids.map((i) => `"${i}"`).join(",")})`;

// At most this many chats can opt in for one entry (a player and a parent,
// say); a code that's been passed around further gets a polite no.
const MAX_CHATS_PER_ENTRY = 3;

async function join(
  supabase: SupabaseClient, chat: Chat, code: string, labelled: boolean, replyKey: string | null,
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
  await linkOtherForm(supabase, chat, { registrationId: reg.id, state: "any" });
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
    push_name: chat.pushName,
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
  const optOut = () => supabase.from("whatsapp_optins")
    .update({ opted_out_at: new Date().toISOString() })
    .or(`jid.in.${inList(ids)},jid_alt.in.${inList(ids)}`).is("opted_out_at", null)
    .select("id, jid");
  let { data, error } = await optOut();
  if (error) throw new Error(`stop: ${error.message}`);
  if (!data?.length && await linkOtherForm(supabase, chat, { state: "active" })) {
    ({ data, error } = await optOut());
    if (error) throw new Error(`stop: ${error.message}`);
  }
  if (!data?.length) return await unmatchedStop(supabase, chat, replyKey);
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
  const optIn = () => supabase.from("whatsapp_optins")
    .update({ opted_out_at: null })
    .or(`jid.in.${inList(ids)},jid_alt.in.${inList(ids)}`).not("opted_out_at", "is", null)
    .select("id");
  let { data, error } = await optIn();
  if (error) throw new Error(`start: ${error.message}`);
  if (!data?.length && await linkOtherForm(supabase, chat, { state: "stopped" })) {
    ({ data, error } = await optIn());
    if (error) throw new Error(`start: ${error.message}`);
  }
  if (!data?.length) return { restarted: 0 };
  await enqueue(supabase, [{
    jid, kind: "reply", priority: 0, dedupe_key: replyKey,
    body: "✅ Updates are back on. Reply STOP anytime to turn them off.",
  }]);
  return { restarted: data.length };
}

// STOP from a chat with no opt-in on file. Usually a stranger, and nothing
// is sent to them anyway. But if some active opt-in is stored only under
// the other ID form (and the profile names didn't settle it), this may be
// one of them, still getting updates. A person has to sort that out: the
// organisers get an email, and the sender is told it's in hand.
async function unmatchedStop(supabase: SupabaseClient, chat: Chat, replyKey: string | null) {
  const { count, error } = await supabase.from("whatsapp_optins")
    .select("id", { count: "exact", head: true })
    .is("opted_out_at", null).is("jid_alt", null)
    .like("jid", isLid(chat.jid) ? "%@s.whatsapp.net" : "%@lid");
  if (error) throw new Error(`stop: ${error.message}`);
  if (!count) return { stopped: 0 };

  const { data: ts } = await supabase.from("tournaments").select("name, admin_notify_emails")
    .eq("whatsapp_enabled", true);
  const to = [...new Set((ts ?? []).flatMap((t) => (t.admin_notify_emails ?? []) as string[]))]
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const who = chat.pushName ?? "(no WhatsApp name)";
  const text =
`Someone sent STOP to the club's WhatsApp number, but their chat didn't match an opt-in on file.

WhatsApp name: ${who}
Chat ID: ${chat.jid}

WhatsApp gave us a different form of their ID than the one they opted in with, so they may still be getting updates. Please find them in whatsapp_optins (by name or entry) and set opted_out_at, or ask Claude to.`;
  const err = to.length
    ? await sendEmail({ to, subject: `WhatsApp STOP to check by hand: ${who}`, text, html: `<pre>${escapeHtml(text)}</pre>`, fromName: "Tournament Admin" })
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
