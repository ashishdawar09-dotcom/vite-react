// supabase/functions/race-monitor/index.ts
//
// The race-day desk monitor. pg_cron calls it every 10 minutes through
// kick_race_monitor() (migration 20261111000000_race_day_desk.sql), only on a
// tournament's day from 8:30 am to 9 pm at the venue, with the
// x-internal-secret header. For each tournament with the monitor on, it
// looks at the courts, the events and the day plan (_shared/race_monitor.ts)
// and emails the director when something needs them, a status every 30
// minutes, and once when every match is done.
//
// An admin can also call it from the app (Emails tab → Send me a status now)
// with { tournament_id }: that sends the current status straight away, any
// day, marked [Test], without touching the monitor's state.
//
// Deployed with JWT checks off (config.toml): the cron call has no user.
// Secrets: RACE_MONITOR_SECRET (the vault's race_monitor_secret),
// RESEND_API_KEY, RESEND_FROM_EMAIL.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireAdmin } from "../_shared/admin.ts";
import { isUuid, json, serveWithCors } from "../_shared/http.ts";
import { sendEmailDetailed } from "../_shared/mailer.ts";
import { hasSecret } from "../_shared/whatsapp.ts";
import {
  composeEmail, decide, evaluate,
  type MonCategory, type MonEntry, type MonitorState, type MonMatch, type MonPlan, type MonPlayer, type MonTeam,
} from "../_shared/race_monitor.ts";

const MIN = 60_000;

type SettingsRow = {
  tournament_id: string;
  monitor_on: boolean;
  monitor_email_to: string | null;
  monitor_plan: MonPlan | null;
  monitor_state: MonitorState | null;
};

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  const scheduled = await hasSecret(req, "x-internal-secret", "RACE_MONITOR_SECRET");
  let testTournament: string | null = null;
  if (!scheduled) {
    if (!(await requireAdmin(req))) return json({ error: "forbidden" }, 403);
    const body = await req.json().catch(() => ({}));
    if (!isUuid(body?.tournament_id)) return json({ error: "tournament_id required" }, 400);
    testTournament = body.tournament_id;
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = Date.now();
  try {
    let rows: SettingsRow[];
    if (testTournament) {
      const { data, error } = await supabase.from("race_day_settings")
        .select("tournament_id, monitor_on, monitor_email_to, monitor_plan, monitor_state")
        .eq("tournament_id", testTournament);
      if (error) throw new Error(error.message);
      rows = (data ?? []) as SettingsRow[];
      if (!rows.length || !rows[0].monitor_email_to) return json({ error: "Set the monitor's email address first." }, 400);
    } else {
      const today = new Date(now - 420 * MIN).toISOString().slice(0, 10);
      const { data, error } = await supabase.from("race_day_settings")
        .select("tournament_id, monitor_on, monitor_email_to, monitor_plan, monitor_state, tournaments!inner(event_date)")
        .eq("monitor_on", true)
        .eq("tournaments.event_date", today);
      if (error) throw new Error(error.message);
      rows = (data ?? []) as unknown as SettingsRow[];
    }

    const results = [];
    for (const row of rows) {
      if (!row.monitor_email_to) continue;
      results.push(await runOne(supabase, row, now, testTournament != null));
    }
    return json({ ran: results.length, results }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("race-monitor error:", msg);
    return json({ error: msg }, 500);
  }
}

async function runOne(supabase: SupabaseClient, row: SettingsRow, now: number, test: boolean) {
  const tid = row.tournament_id;
  const [tour, cats, matches, teams, players] = await Promise.all([
    supabase.from("tournaments").select("name, num_courts").eq("id", tid).single(),
    supabase.from("categories").select("id, name, sort_order, starts_at, match_minutes, groups_count, top_n_advance, team_size").eq("tournament_id", tid),
    supabase.from("matches").select("id, category_id, stage, group_idx, round_idx, is_bronze, is_bye, status, confirmed, team_a_id, team_b_id, court_number, court_allocated_at, started_at, confirmed_at, best_of, extended_minutes").eq("tournament_id", tid),
    supabase.from("teams").select("id, category_id, p1_id, p2_id").eq("tournament_id", tid),
    supabase.from("players").select("id, name, active").eq("tournament_id", tid),
  ]);
  for (const r of [tour, cats, matches, teams, players]) if (r.error) throw new Error(r.error.message);
  const categories = (cats.data ?? []) as MonCategory[];
  const singleIds = categories.filter((c) => c.team_size === 1).map((c) => c.id);
  const activeIds = new Set(((players.data ?? []) as MonPlayer[]).filter((p) => p.active).map((p) => p.id));
  let singles: MonEntry[] = [];
  if (singleIds.length) {
    const { data, error } = await supabase.from("player_categories").select("category_id, player_id").in("category_id", singleIds);
    if (error) throw new Error(error.message);
    singles = ((data ?? []) as MonEntry[]).filter((e) => activeIds.has(e.player_id));
  }

  const state: MonitorState = row.monitor_state ?? {};
  const result = evaluate({
    now,
    numCourts: tour.data?.num_courts ?? 4,
    categories,
    matches: (matches.data ?? []) as MonMatch[],
    teams: (teams.data ?? []) as MonTeam[],
    players: (players.data ?? []) as MonPlayer[],
    singles,
    plan: row.monitor_plan,
    openKeys: Object.keys(state.sent ?? {}),
  });
  const tournament = tour.data?.name ?? "Tournament";
  const to = row.monitor_email_to!.split(",").map((s) => s.trim()).filter(Boolean);
  const from = Deno.env.get("RESEND_FROM_EMAIL") ?? null;

  if (test) {
    const mail = composeEmail(result, { tournament, now, kind: "test", fresh: [] });
    const sent = await sendEmailDetailed(
      { to, subject: mail.subject, text: mail.text, html: mail.html, fromName: "Desk monitor" },
      { from, tags: [{ name: "app", value: "badminton" }, { name: "kind", value: "race_monitor" }] },
    );
    return { tournament_id: tid, test: true, sent: !sent.error, error: sent.error, alerts: result.alerts.length };
  }

  const d = decide(result, state, now);
  let error: string | null = null;
  if (d.send && d.kind) {
    const mail = composeEmail(result, { tournament, now, kind: d.kind, fresh: d.fresh });
    const sent = await sendEmailDetailed(
      { to, subject: mail.subject, text: mail.text, html: mail.html, fromName: "Desk monitor" },
      {
        from,
        // One email per tournament per 10-minute check, even if the cron call is repeated.
        idempotencyKey: `race-monitor/${tid}/${Math.floor(now / (10 * MIN))}`,
        tags: [{ name: "app", value: "badminton" }, { name: "kind", value: "race_monitor" }],
      },
    );
    error = sent.error;
  }
  // A failed send keeps the old state, so the next check tries again.
  if (!error) {
    const { error: upErr } = await supabase.from("race_day_settings")
      .update({ monitor_state: { ...d.state, last_run_at: new Date(now).toISOString() } })
      .eq("tournament_id", tid);
    if (upErr) console.error("race-monitor state update failed:", upErr.message);
  } else {
    console.error("race-monitor email failed:", error);
  }
  return { tournament_id: tid, kind: d.kind, sent: d.send && !error, error, alerts: result.alerts.length, fresh: d.fresh.length };
}
