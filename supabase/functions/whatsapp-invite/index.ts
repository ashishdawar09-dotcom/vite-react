// supabase/functions/whatsapp-invite/index.ts
//
// Emails the "updates on WhatsApp" invitation to people who entered before
// the opt-in button existed (who: _shared/whatsapp_invites.ts; the email:
// whatsappInvite in _shared/emails.ts). Admin only. POST
// { tournament_id, mode, index?, to? } where mode is:
//   dry_run  who would get it, and who's skipped and why; sends nothing
//   preview  { subject, html, text } for invitee number `index`
//   test     sends invitee `index`'s email to `to`, which must be one of the
//            tournament's directors (tournament_admins or admin_notify_emails),
//            with "[TEST]" in the subject; records nothing
//   send     sends to everyone not yet invited, recording each person in
//            whatsapp_invites so nobody gets it twice; a failed one is
//            retried on the next send. Works in batches: call again while
//            `remaining` > 0. Refused until partner codes work and the
//            email's images are uploaded (notReadyToSend).
// test and send also need the tournament's reply-to address, since the
// email tells people to reply to it.
//
// Secrets: RESEND_API_KEY (via _shared/mailer.ts) and the platform's SUPABASE_*.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireAdmin } from "../_shared/admin.ts";
import { type EmailTournament, firstName, whatsappInvite } from "../_shared/emails.ts";
import { isUuid, json, serveWithCors } from "../_shared/http.ts";
import { sendEmail } from "../_shared/mailer.ts";
import { formatClubNumber, maskNumber, optinLink, optinMessage } from "../_shared/whatsapp.ts";
import { type Invitee, loadInvitees } from "../_shared/whatsapp_invites.ts";

const ASSET_BASE = Deno.env.get("EMAIL_ASSET_BASE") ?? "https://shuttlestorm.adawar.org/email";
const PRIVACY_URL = Deno.env.get("EMAIL_PRIVACY_URL") ?? "https://shuttlestorm.adawar.org/privacy";
// The name on the club's WhatsApp profile (what the chat shows), the
// directors' sign-off, and the sender's name and mailing address.
const CLUB_NAME = Deno.env.get("WHATSAPP_PROFILE_NAME") ?? "Shuttle Storm";
const SIGNOFF = Deno.env.get("EMAIL_SIGNOFF") ?? "Ashish & Rakesh";
const SENDER = Deno.env.get("EMAIL_SENDER_ADDRESS") ?? "Shuttle Storm Badminton Club · 2669 Langdon St, Abbotsford, BC V2T 1S8";
// Sends per call, with a short gap (Resend allows a couple per second); the
// whole call stays well inside the Edge Function time limit.
const BATCH = 40;

const T_COLUMNS =
  "id, name, event_date, event_time, venue_name, venue_address, venue_map_url, rules_url, waiver_url, " +
  "contact_info, reply_to_email, admin_notify_emails, whatsapp_enabled, whatsapp_number, whatsapp_enabled_at";

type Tournament = EmailTournament & {
  id: string;
  reply_to_email: string | null;
  admin_notify_emails: string[] | null;
  whatsapp_enabled: boolean;
  whatsapp_number: string | null;
  whatsapp_enabled_at: string | null;
};

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = await requireAdmin(req);
  if (!admin) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.tournament_id)) return json({ error: "tournament_id required" }, 400);
  const mode = body?.mode;
  if (!["dry_run", "preview", "test", "send"].includes(mode)) return json({ error: "mode must be dry_run, preview, test or send" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { data: t, error } = await supabase.from("tournaments").select(T_COLUMNS).eq("id", body.tournament_id).maybeSingle();
    if (error || !t) return json({ error: "tournament not found" }, 404);
    const tour = t as unknown as Tournament;
    if (!tour.whatsapp_enabled || !tour.whatsapp_number || !tour.whatsapp_enabled_at) {
      return json({ error: "WhatsApp isn't switched on (with a club number) for this tournament" }, 409);
    }

    const { invitees, skipped } = await loadInvitees(supabase, tour.id, tour.whatsapp_enabled_at);
    const sent = await alreadySent(supabase, tour.id);
    const todo = invitees.filter((i) => !sent.has(i.key));
    // Updates follow the player record approval linked (matched by email),
    // which for a second child under a parent's address is the first's.
    const first = (n: string) => firstName(n).toLowerCase();
    const mismatched = todo.filter((i) => i.record_name && first(i.record_name) !== first(i.name))
      .map((i) => ({ name: i.name, email: i.email, record: i.record_name }));

    if (mode === "dry_run") {
      return json({
        launched_at: tour.whatsapp_enabled_at,
        club_number: maskNumber(tour.whatsapp_number),
        invitees: invitees.length,
        already_sent: invitees.length - todo.length,
        to_send: todo.length,
        players: todo.filter((i) => i.role === "player").length,
        partners: todo.filter((i) => i.role === "partner").length,
        skipped,
        reply_to: tour.reply_to_email,
        // Fix these entries' player links (or leave them out) before sending.
        mismatched,
        list: todo.map((i, index) => ({ index, name: i.name, email: i.email, role: i.role, categories: i.categories })),
      }, 200);
    }

    if (mode !== "preview" && !tour.reply_to_email?.trim()) {
      return json({ error: "set the tournament's reply-to address first: the email asks people to reply" }, 409);
    }
    if (mode === "preview" || mode === "test") {
      const i = Number.isInteger(body?.index) ? todo[body.index] : todo[0];
      if (!i) return json({ error: "no invitee at that index" }, 404);
      const mail = render(tour, i);
      if (mode === "preview") return json(mail, 200);
      const to = String(body?.to ?? "").trim().toLowerCase();
      if (!(await isDirector(supabase, tour, to))) return json({ error: "test emails only go to the tournament's directors" }, 400);
      const err = await sendEmail({
        to, fromName: tour.name, replyTo: tour.reply_to_email,
        subject: `[TEST for ${i.name}] ${mail.subject}`, html: mail.html, text: mail.text,
      });
      return err ? json({ error: err }, 502) : json({ sent: 1, to, as: i.name }, 200);
    }

    // send
    const notReady = await notReadyToSend(supabase);
    if (notReady) return json({ error: notReady }, 409);
    let sentNow = 0, failed = 0;
    for (const i of todo.slice(0, BATCH)) {
      if (!(await claim(supabase, tour.id, i))) continue;
      const mail = render(tour, i);
      const err = await sendEmail({
        to: i.email, fromName: tour.name, replyTo: tour.reply_to_email,
        subject: mail.subject, html: mail.html, text: mail.text,
      });
      const { error: upErr } = await supabase.from("whatsapp_invites")
        .update(err ? { status: "failed", error_message: err.slice(0, 300) } : { status: "sent", sent_at: new Date().toISOString(), error_message: null })
        .eq("tournament_id", tour.id).eq("person_key", i.key);
      if (upErr) console.error("whatsapp-invite: couldn't record", i.key, upErr.message);
      if (err) failed++;
      else sentNow++;
      await new Promise((r) => setTimeout(r, 600));
    }
    return json({ sent: sentNow, failed, remaining: Math.max(0, todo.length - BATCH) }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("whatsapp-invite error:", msg);
    return json({ error: msg }, 500);
  }
}

function render(t: Tournament, i: Invitee) {
  return whatsappInvite({
    tournament: t,
    invitee: i,
    message: optinMessage(t.name, i.code),
    link: optinLink(t.whatsapp_number, t.name, i.code)!,
    clubName: CLUB_NAME,
    clubNumber: formatClubNumber(t.whatsapp_number!),
    signoff: SIGNOFF,
    sender: SENDER,
    assetBase: ASSET_BASE,
    privacyUrl: PRIVACY_URL,
  });
}

// Everyone invited already (sent, or being sent right now).
async function alreadySent(supabase: SupabaseClient, tournamentId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("whatsapp_invites").select("person_key")
    .eq("tournament_id", tournamentId).neq("status", "failed");
  if (error) throw new Error(`invites: ${error.message}`);
  return new Set((data ?? []).map((r) => r.person_key as string));
}

// Marks the person as being invited; false if someone else got there first.
// A failed earlier attempt is taken over and retried.
async function claim(supabase: SupabaseClient, tournamentId: string, i: Invitee): Promise<boolean> {
  const { error } = await supabase.from("whatsapp_invites").insert({
    tournament_id: tournamentId, registration_id: i.registration_id, role: i.role,
    email: i.email, person_name: i.name, person_key: i.key, status: "sending",
  });
  if (!error) return true;
  const { data } = await supabase.from("whatsapp_invites")
    .update({ status: "sending", registration_id: i.registration_id, role: i.role, email: i.email, person_name: i.name, error_message: null })
    .eq("tournament_id", tournamentId).eq("person_key", i.key).eq("status", "failed")
    .select("id");
  return (data ?? []).length > 0;
}

// What has to be live before a real send: partners' codes only work with
// resolve_whatsapp_code (and the whatsapp-inbound that calls it), and the
// email's two new images must be on the asset host. null when all is well.
async function notReadyToSend(supabase: SupabaseClient): Promise<string | null> {
  const { error } = await supabase.rpc("resolve_whatsapp_code", { p_code: "00000000" });
  if (error) return `partner codes aren't live (resolve_whatsapp_code: ${error.message})`;
  for (const file of ["whatsapp-hero.gif", "whatsapp-avatar.png"]) {
    const res = await fetch(`${ASSET_BASE}/${file}`, { method: "HEAD" }).catch(() => null);
    if (!res?.ok || !res.headers.get("content-type")?.startsWith("image/")) return `${ASSET_BASE}/${file} isn't uploaded yet`;
  }
  return null;
}

async function isDirector(supabase: SupabaseClient, t: Tournament, email: string): Promise<boolean> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  if ((t.admin_notify_emails ?? []).some((e) => e.trim().toLowerCase() === email)) return true;
  const { data } = await supabase.from("tournament_admins").select("email").eq("email", email).maybeSingle();
  return !!data;
}
