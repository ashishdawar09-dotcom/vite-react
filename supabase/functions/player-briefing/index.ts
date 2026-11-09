// supabase/functions/player-briefing/index.ts
//
// The day-before and morning-of player briefings, and the one-off "full
// house" thank-you, sent from the admin app's Emails tab. Admin-only. Actions:
//   preview  → counts and one rendered email (nothing is sent)
//   test     → that rendered email, sent only to the signed-in admin
//   send     → the next batch of players (BATCH at a time; the app calls again
//              until `remaining` is 0). Each player is claimed in
//              briefing_emails first, so a retry or a second admin never
//              emails anyone twice. With `scheduled_at`, Resend holds each
//              email until then.
//   cancel   → cancels the next batch of scheduled (not yet sent) emails.
//
// The full-house email is never scheduled, and it only sends once the
// database says every entry is taken (registration_capacity), so a slip of
// the finger can't tell 100 players they're sold out early.
//
// Replies go to the tournament's reply_to_email. Delivery problems come back
// through resend-webhook into briefing_emails.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireAdmin } from "../_shared/admin.ts";
import { isUuid, json, serveWithCors, SITE_URL } from "../_shared/http.ts";
import { type EmailTournament, fullHouseEmail, playerBriefing, type RenderedEmail } from "../_shared/emails.ts";
import { cancelScheduledEmail, sendEmailDetailed } from "../_shared/mailer.ts";
import {
  BRIEFING_KINDS, type BriefingKind, briefingRecipients, type PlanMatch, type PlanTeam, playerPlan, scheduleWindow,
} from "../_shared/raceday.ts";

const ASSET_BASE = Deno.env.get("EMAIL_ASSET_BASE") ?? "https://shuttlestorm.adawar.org/email";
const PRIVACY_URL = Deno.env.get("EMAIL_PRIVACY_URL") ?? "https://shuttlestorm.adawar.org/privacy";
// Images the app serves (public/email): the full-house animation and waitlist bar.
const APP_ASSET_BASE = Deno.env.get("EMAIL_APP_ASSET_BASE") ?? `${SITE_URL}/email`;
const BATCH = 25;
const GAP_MS = 150; // stays under Resend's 10 requests a second, shared with court calls
const NOTES_MAX = 600;

const T_COLUMNS =
  "id, name, slug, event_date, event_time, venue_name, venue_address, venue_map_url, rules_url, waiver_url, contact_info, reply_to_email, entry_cap";

serveWithCors(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const adminEmail = await requireAdmin(req);
  if (!adminEmail) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const tournamentId = body.tournament_id;
  const kind = body.kind as BriefingKind;
  if (!isUuid(tournamentId)) return json({ error: "tournament_id required" }, 400);
  if (!BRIEFING_KINDS.includes(kind)) return json({ error: "kind must be day_before, morning_of or full_house" }, 400);
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, NOTES_MAX) || null : null;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ctx = await load(supabase, tournamentId);
  if (!ctx) return json({ error: "tournament not found" }, 404);

  if (action === "preview" || action === "test") {
    const pick = isUuid(body.player_id)
      ? ctx.recipients.find((r) => r.id === body.player_id)
      : ctx.recipients[0];
    if (!pick) return json({ error: "No players with an email address yet." }, 400);
    const email = render(ctx, kind, pick, notes);
    if (action === "preview") {
      const done = await doneIds(supabase, tournamentId, kind);
      return json({
        ...email,
        player: pick.name,
        eligible: ctx.recipients.length,
        already: ctx.recipients.filter((r) => done.has(r.id)).length,
        no_email: ctx.activeCount - ctx.recipients.length,
      }, 200);
    }
    const r = await sendEmailDetailed(
      { to: adminEmail, subject: `[Test] ${email.subject}`, html: email.html, text: email.text, fromName: ctx.t.name, replyTo: ctx.replyTo },
      { tags: [{ name: "app", value: "badminton" }, { name: "kind", value: "briefing_test" }] },
    );
    return r.error ? json({ error: `Couldn't send the test: ${r.error}` }, 502) : json({ sent_to: adminEmail }, 200);
  }

  if (action === "send") {
    const when = kind === "full_house"
      ? { at: null, error: null }
      : scheduleWindow(typeof body.scheduled_at === "string" ? body.scheduled_at : null);
    if (when.error) return json({ error: when.error }, 400);
    if (kind === "full_house") {
      const { data: c, error: capErr } = await supabase.rpc("registration_capacity", { p_tournament_id: tournamentId });
      if (capErr) return json({ error: `Couldn't read the entry count: ${capErr.message}` }, 500);
      const cap = c as { cap?: unknown; taken?: unknown } | null;
      const full = typeof cap?.cap === "number" && typeof cap?.taken === "number" && cap.taken >= cap.cap;
      if (!full) return json({ error: "The tournament isn't full yet, so the full-house email can't go out." }, 409);
    }
    const done = await doneIds(supabase, tournamentId, kind);
    const todo = ctx.recipients.filter((r) => !done.has(r.id));
    let sent = 0, scheduled = 0, failed = 0;
    const errors: string[] = [];
    for (const r of todo.slice(0, BATCH)) {
      const { data: rowId, error: claimErr } = await supabase.rpc("claim_briefing", {
        p_tournament_id: tournamentId, p_player_id: r.id, p_kind: kind, p_email: r.email,
      });
      if (claimErr) return json({ error: `Couldn't claim: ${claimErr.message}` }, 500);
      if (!rowId) continue; // another admin got there first
      const email = render(ctx, kind, r, notes);
      const res = await sendEmailDetailed(
        { to: r.email, subject: email.subject, html: email.html, text: email.text, fromName: ctx.t.name, replyTo: ctx.replyTo },
        {
          scheduledAt: when.at,
          tags: [{ name: "app", value: "badminton" }, { name: "kind", value: `briefing_${kind}` }],
        },
      );
      const now = new Date().toISOString();
      if (res.error) {
        failed++;
        if (errors.length < 3) errors.push(`${r.name}: ${res.error}`);
        await supabase.from("briefing_emails").update({ status: "failed", error_message: res.error.slice(0, 500), updated_at: now }).eq("id", rowId);
      } else {
        if (when.at) scheduled++;
        else sent++;
        await supabase.from("briefing_emails").update({
          status: when.at ? "scheduled" : "sent",
          provider_message_id: res.id,
          scheduled_at: when.at,
          sent_at: when.at ? null : now,
          updated_at: now,
        }).eq("id", rowId);
      }
      await new Promise((ok) => setTimeout(ok, GAP_MS));
    }
    const after = await doneIds(supabase, tournamentId, kind);
    const remaining = ctx.recipients.filter((r) => !after.has(r.id)).length;
    // A batch where everything failed stops the app's loop (quota, bad key).
    return json({ sent, scheduled, failed, errors, remaining, stop: failed > 0 && sent + scheduled === 0 }, 200);
  }

  if (action === "cancel") {
    const { data: rows, error } = await supabase.from("briefing_emails")
      .select("id, provider_message_id")
      .eq("tournament_id", tournamentId).eq("kind", kind).eq("status", "scheduled")
      .limit(BATCH);
    if (error) return json({ error: error.message }, 500);
    let cancelled = 0, failed = 0;
    for (const row of rows ?? []) {
      const err = row.provider_message_id ? await cancelScheduledEmail(row.provider_message_id) : null;
      if (err) {
        failed++;
      } else {
        cancelled++;
        await supabase.from("briefing_emails").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", row.id);
      }
      await new Promise((ok) => setTimeout(ok, GAP_MS));
    }
    const { count } = await supabase.from("briefing_emails").select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId).eq("kind", kind).eq("status", "scheduled");
    return json({ cancelled, failed, remaining: count ?? 0, stop: failed > 0 && cancelled === 0 }, 200);
  }

  return json({ error: "unknown action" }, 400);
});

type Ctx = {
  t: EmailTournament & { id: string; slug: string | null; reply_to_email: string | null; entry_cap: number | null };
  replyTo: string | null;
  recipients: { id: string; name: string; email: string }[];
  activeCount: number;
  plan: (playerId: string) => ReturnType<typeof playerPlan>;
  doublesNames: Set<string>;         // events played in pairs, by name (as playerPlan reports them)
  teamsByEvent: Map<string, number>; // teams entered in each event right now, by name
};

async function load(supabase: SupabaseClient, tournamentId: string): Promise<Ctx | null> {
  const { data: t } = await supabase.from("tournaments").select(T_COLUMNS).eq("id", tournamentId).maybeSingle();
  if (!t) return null;
  const [players, cats, pcs, teams, matches] = await Promise.all([
    supabase.from("players").select("id, name, email, active").eq("tournament_id", tournamentId),
    supabase.from("categories").select("id, name, sort_order, team_size").eq("tournament_id", tournamentId).order("sort_order"),
    supabase.from("player_categories").select("player_id, category_id"),
    supabase.from("teams").select("id, category_id, p1_id, p2_id").eq("tournament_id", tournamentId),
    supabase.from("matches").select("id, category_id, team_a_id, team_b_id, status, scheduled_at, court_number")
      .eq("tournament_id", tournamentId).eq("status", "pending").not("scheduled_at", "is", null),
  ]);
  for (const r of [players, cats, pcs, teams, matches]) if (r.error) throw new Error(r.error.message);
  const roster = players.data ?? [];
  const nameById = new Map(roster.map((p) => [p.id as string, (p.name as string).trim()]));
  const ids = new Set(roster.map((p) => p.id as string));
  const catsByPlayer = new Map<string, string[]>();
  for (const pc of pcs.data ?? []) {
    if (!ids.has(pc.player_id)) continue;
    catsByPlayer.set(pc.player_id, [...(catsByPlayer.get(pc.player_id) ?? []), pc.category_id]);
  }
  const shared = {
    categories: (cats.data ?? []) as { id: string; name: string }[],
    teams: (teams.data ?? []) as PlanTeam[],
    matches: (matches.data ?? []) as PlanMatch[],
    nameById,
  };
  return {
    t: t as Ctx["t"],
    replyTo: (t.reply_to_email as string | null)?.trim() || null,
    recipients: briefingRecipients(roster as { id: string; name: string; email: string | null; active: boolean }[]),
    activeCount: roster.filter((p) => p.active).length,
    plan: (playerId) => playerPlan(playerId, { ...shared, playerCategoryIds: catsByPlayer.get(playerId) ?? [] }),
    doublesNames: new Set((cats.data ?? []).filter((c) => c.team_size === 2).map((c) => c.name as string)),
    teamsByEvent: new Map((cats.data ?? []).map((c) => [
      c.name as string,
      (teams.data ?? []).filter((tm) => tm.category_id === c.id).length,
    ])),
  };
}

// Players whose briefing of this kind is sent, scheduled or going out now.
async function doneIds(supabase: SupabaseClient, tournamentId: string, kind: BriefingKind): Promise<Set<string>> {
  const { data, error } = await supabase.from("briefing_emails").select("player_id")
    .eq("tournament_id", tournamentId).eq("kind", kind).in("status", ["sending", "sent", "scheduled"]);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.player_id as string));
}

function render(ctx: Ctx, kind: BriefingKind, p: { id: string; name: string }, notes: string | null): RenderedEmail {
  const plan = ctx.plan(p.id);
  if (kind === "full_house") {
    return fullHouseEmail({
      tournament: ctx.t,
      player: { name: p.name },
      entries: plan.entries.map((e) => ({ ...e, doubles: ctx.doublesNames.has(e.category), teams: ctx.teamsByEvent.get(e.category) })),
      cap: ctx.t.entry_cap,
      notes,
      waitlistUrl: `${SITE_URL}/register/${ctx.t.id}`,
      appAssetBase: APP_ASSET_BASE,
      assetBase: ASSET_BASE,
      privacyUrl: PRIVACY_URL,
    });
  }
  return playerBriefing({
    tournament: ctx.t,
    kind,
    player: { name: p.name },
    entries: plan.entries,
    firstMatch: plan.firstMatch,
    notes,
    liveUrl: ctx.t.slug ? `${SITE_URL}/t/${ctx.t.slug}` : SITE_URL,
    profileUrl: `${SITE_URL}/p/${p.id}`,
    assetBase: ASSET_BASE,
    privacyUrl: PRIVACY_URL,
  });
}
