// supabase/functions/volunteer-desk-admin/index.ts
//
// Endpoint behind the organizer screen of the volunteer desk site
// (volunteer-desk/public/organizer.html). Organizers only: the caller's
// sign-in is checked against tournament_admins, exactly as the app's own
// admin functions do. It manages volunteer links and nothing else:
//
//   POST { action: "overview", tournament_id? }                             → tournaments, links, desk activity
//   POST { action: "invite", tournament_id, name, email, valid_from, valid_until } → makes a link and emails it
//   POST { action: "resend", link_id }                                      → replaces the link and emails the new one
//   POST { action: "set_state", link_id, on }                               → switches a link off or back on
//   POST { action: "set_hours", link_id, valid_from, valid_until }          → changes when a link works
//
// A link is stored only as a hash, so it can be shown once (in the answer to
// invite / resend) and never again.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireAdmin } from "../_shared/admin.ts";
import { allow, isUuid, json } from "../_shared/http.ts";
import { sendEmailDetailed } from "../_shared/mailer.ts";
import { allowedOrigin, DEFAULT_DESK_ORIGIN, linkState, sha256Hex } from "../volunteer-desk/desk.ts";
import { checkInvite, checkWindow, copyLink, emailLink, inviteEmail, MAX_LINKS, newKey } from "./invite.ts";

const DESK_ORIGIN = Deno.env.get("DESK_ORIGIN") ?? DEFAULT_DESK_ORIGIN;
const LINK_COLS = "id, tournament_id, label, email, valid_from, valid_until, revoked_at, created_at, last_used_at, emailed_at, created_by";

type Link = {
  id: string; tournament_id: string; label: string; email: string | null; valid_from: string; valid_until: string;
  revoked_at: string | null; created_at: string; last_used_at: string | null; emailed_at: string | null; created_by: string | null;
};
type Tournament = { id: string; name: string; slug: string | null; event_date: string | null };

Deno.serve(async (req: Request) => {
  const res = req.method === "OPTIONS"
    ? new Response("ok", { status: 200 })
    : await handle(req).catch((e) => {
      console.error("volunteer-desk-admin failed:", e instanceof Error ? e.message : e);
      return json({ success: false, error: "Something went wrong. Please try again." }, 500);
    });
  res.headers.set("Access-Control-Allow-Origin", allowedOrigin(req.headers.get("Origin") ?? "", DESK_ORIGIN));
  res.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Vary", "Origin");
  res.headers.set("Cache-Control", "no-store");
  return res;
});

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const admin = await requireAdmin(req);
  if (!admin) return json({ success: false, code: "not_admin", error: "Only tournament organizers can use this page." }, 403);

  const raw = await req.text();
  if (raw.length > 4000) return json({ success: false, error: "Invalid request" }, 400);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ success: false, error: "Invalid request" }, 400);
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date();

  if (body.action === "overview") return await overview(supabase, admin, body.tournament_id, now);

  if (body.action === "invite") {
    if (!isUuid(body.tournament_id)) return json({ success: false, error: "Please choose a tournament." }, 400);
    const input = checkInvite(body, now);
    if ("error" in input) return json({ success: false, error: input.error }, 400);
    const { data: t } = await supabase.from("tournaments").select("id, name").eq("id", body.tournament_id).maybeSingle();
    if (!t) return json({ success: false, error: "That tournament wasn't found." }, 404);
    const { data: existing } = await supabase.from("desk_links").select("label, email").eq("tournament_id", t.id).limit(200);
    const rows = existing ?? [];
    if (rows.some((r) => r.email === input.email)) {
      return json({ success: false, code: "already_invited", error: `${input.email} already has a link. Use "Send again" on their card.` }, 409);
    }
    if (rows.some((r) => (r.label as string).toLowerCase() === input.name.toLowerCase())) {
      return json({ success: false, code: "name_taken", error: `Another volunteer is already called ${input.name}. Add a last name or initial so the log can tell them apart.` }, 409);
    }
    if (rows.length >= MAX_LINKS) return json({ success: false, error: `A tournament can have ${MAX_LINKS} volunteer links at most.` }, 409);
    if (!(await allow(supabase, "volunteer-desk-admin-send", admin, 40, 3600))) {
      return json({ success: false, error: "That's a lot of invites in a short time. Please try again in an hour." }, 429);
    }

    const key = newKey();
    const { data: made, error: insErr } = await supabase.from("desk_links").insert({
      tournament_id: t.id, label: input.name, email: input.email, token_hash: await sha256Hex(key),
      valid_from: input.valid_from, valid_until: input.valid_until, created_by: admin,
    }).select(LINK_COLS).single();
    if (insErr || !made) {
      // Two organizers inviting the same address at the same moment: the second is told so.
      if (insErr?.code === "23505") return json({ success: false, code: "already_invited", error: `${input.email} already has a link. Use "Send again" on their card.` }, 409);
      return json({ success: false, error: "Couldn't save the link. Please try again." }, 500);
    }
    const mail = inviteEmail({ name: input.name, tournament: t.name as string, link: emailLink(DESK_ORIGIN, key), valid_from: input.valid_from, valid_until: input.valid_until, again: false });
    const sent = await sendEmailDetailed(
      { to: input.email, subject: mail.subject, html: mail.html, text: mail.text, fromName: t.name as string, replyTo: admin },
      { tags: [{ name: "kind", value: "desk_invite" }] },
    );
    if (sent.error) {
      // No email, no link: a working link nobody received would be worse than none.
      await supabase.from("desk_links").delete().eq("id", made.id);
      console.error("desk invite email failed:", sent.error);
      return json({ success: false, code: "email_failed", error: "The email couldn't be sent, so no link was made. Please check the address and try again." }, 502);
    }
    const { data: saved } = await supabase.from("desk_links").update({ emailed_at: now.toISOString() }).eq("id", made.id).select(LINK_COLS).single();
    return json({ success: true, link: shape((saved ?? made) as Link, now, {}), url: copyLink(DESK_ORIGIN, key) }, 200);
  }

  // The rest act on one existing link.
  const actions = ["resend", "set_state", "set_hours"];
  if (typeof body.action !== "string" || !actions.includes(body.action)) return json({ success: false, error: "Unknown action" }, 400);
  if (!isUuid(body.link_id)) return json({ success: false, error: "That link wasn't found." }, 404);
  const { data: found } = await supabase.from("desk_links").select(`${LINK_COLS}, token_hash`).eq("id", body.link_id).maybeSingle();
  if (!found) return json({ success: false, error: "That link wasn't found." }, 404);
  const link = found as Link & { token_hash: string };

  if (body.action === "set_state") {
    if (typeof body.on !== "boolean") return json({ success: false, error: "Invalid request" }, 400);
    const { data: saved, error } = await supabase.from("desk_links").update({ revoked_at: body.on ? null : (link.revoked_at ?? now.toISOString()) })
      .eq("id", link.id).select(LINK_COLS).single();
    if (error || !saved) return json({ success: false, error: "Couldn't change the link. Please try again." }, 500);
    return json({ success: true, link: shape(saved as Link, now, {}) }, 200);
  }

  if (body.action === "set_hours") {
    const w = checkWindow(body.valid_from, body.valid_until, now);
    if ("error" in w) return json({ success: false, error: w.error }, 400);
    const { data: saved, error } = await supabase.from("desk_links").update({ valid_from: w.from, valid_until: w.until })
      .eq("id", link.id).select(LINK_COLS).single();
    if (error || !saved) return json({ success: false, error: "Couldn't change the hours. Please try again." }, 500);
    return json({ success: true, link: shape(saved as Link, now, {}) }, 200);
  }

  // resend: a new link replaces the old one (which stops working) and is emailed.
  if (!link.email) return json({ success: false, error: "This link has no email address to send to." }, 400);
  if (link.revoked_at) return json({ success: false, error: "This link is switched off. Switch it on first, then send again." }, 409);
  if (new Date(link.valid_until).getTime() <= now.getTime()) return json({ success: false, error: "This link's hours have ended. Change the hours first, then send again." }, 409);
  const { data: t } = await supabase.from("tournaments").select("name").eq("id", link.tournament_id).maybeSingle();
  if (!(await allow(supabase, "volunteer-desk-admin-send", admin, 40, 3600))) {
    return json({ success: false, error: "That's a lot of invites in a short time. Please try again in an hour." }, 429);
  }
  const key = newKey();
  const { error: rotErr } = await supabase.from("desk_links").update({ token_hash: await sha256Hex(key) }).eq("id", link.id);
  if (rotErr) return json({ success: false, error: "Couldn't make a new link. Please try again." }, 500);
  const mail = inviteEmail({ name: link.label, tournament: (t?.name as string | undefined) ?? "the tournament", link: emailLink(DESK_ORIGIN, key), valid_from: link.valid_from, valid_until: link.valid_until, again: true });
  const sent = await sendEmailDetailed(
    { to: link.email, subject: mail.subject, html: mail.html, text: mail.text, fromName: (t?.name as string | undefined) ?? "Shuttle Storm", replyTo: admin },
    { tags: [{ name: "kind", value: "desk_invite" }] },
  );
  if (sent.error) {
    // Put the old link back: the volunteer still has that one.
    await supabase.from("desk_links").update({ token_hash: link.token_hash }).eq("id", link.id);
    console.error("desk resend email failed:", sent.error);
    return json({ success: false, code: "email_failed", error: "The email couldn't be sent, so their old link still works. Please try again." }, 502);
  }
  const { data: saved } = await supabase.from("desk_links").update({ emailed_at: now.toISOString() }).eq("id", link.id).select(LINK_COLS).single();
  return json({ success: true, link: shape((saved ?? link) as Link, now, {}), url: copyLink(DESK_ORIGIN, key) }, 200);
}

/** A link as the organizer screen shows it. The hash never leaves the function. */
function shape(l: Link, now: Date, counts: Record<string, { check_ins: number; photos: number }>) {
  return {
    id: l.id, name: l.label, email: l.email, valid_from: l.valid_from, valid_until: l.valid_until,
    on: !l.revoked_at, state: linkState(l, now), created_at: l.created_at, created_by: l.created_by,
    emailed_at: l.emailed_at, last_used_at: l.last_used_at,
    check_ins: counts[l.id]?.check_ins ?? 0, photos: counts[l.id]?.photos ?? 0,
  };
}

async function overview(supabase: SupabaseClient, admin: string, wanted: unknown, now: Date): Promise<Response> {
  const { data: ts } = await supabase.from("tournaments").select("id, name, slug, event_date").order("event_date", { ascending: false, nullsFirst: false }).limit(100);
  const tournaments = (ts ?? []) as Tournament[];
  if (!tournaments.length) return json({ success: true, admin, tournaments: [], tournament: null, links: [], activity: [], totals: { check_ins: 0, photos: 0 }, desk_url: DESK_ORIGIN }, 200);
  // The one asked for, else the next one coming up, else the most recent.
  const today = now.toISOString().slice(0, 10);
  const upcoming = tournaments.filter((t) => t.event_date && t.event_date >= today).sort((a, b) => (a.event_date! < b.event_date! ? -1 : 1));
  const tournament = (isUuid(wanted) ? tournaments.find((t) => t.id === wanted) : null) ?? upcoming[0] ?? tournaments[0];

  const [{ data: links }, { data: acts }, { count: active }, { count: checkedIn }] = await Promise.all([
    supabase.from("desk_links").select(LINK_COLS).eq("tournament_id", tournament.id).order("created_at", { ascending: true }).limit(200),
    supabase.from("desk_actions").select("id, link_id, volunteer, player_name, action, created_at").eq("tournament_id", tournament.id).order("id", { ascending: false }).limit(3000),
    supabase.from("players").select("id", { count: "exact", head: true }).eq("tournament_id", tournament.id).eq("active", true),
    supabase.from("players").select("id", { count: "exact", head: true }).eq("tournament_id", tournament.id).eq("active", true).not("checked_in_at", "is", null),
  ]);
  const counts: Record<string, { check_ins: number; photos: number }> = {};
  const totals = { check_ins: 0, photos: 0 };
  for (const a of acts ?? []) {
    const c = a.link_id ? (counts[a.link_id as string] ??= { check_ins: 0, photos: 0 }) : null;
    const d = a.action === "check_in" ? 1 : a.action === "undo_check_in" ? -1 : 0;
    const p = a.action === "photo" ? 1 : a.action === "undo_photo" ? -1 : 0;
    totals.check_ins += d; totals.photos += p;
    if (c) { c.check_ins += d; c.photos += p; }
  }
  return json({
    success: true,
    admin,
    tournaments: tournaments.map((t) => ({ id: t.id, name: t.name, event_date: t.event_date })),
    tournament: { id: tournament.id, name: tournament.name, event_date: tournament.event_date },
    players: { active: active ?? 0, checked_in: checkedIn ?? 0 },
    links: ((links ?? []) as Link[]).map((l) => shape(l, now, counts)),
    totals,
    activity: (acts ?? []).slice(0, 40).map((a) => ({ id: a.id, volunteer: a.volunteer, player: a.player_name, action: a.action, at: a.created_at })),
    desk_url: DESK_ORIGIN,
  }, 200);
}
