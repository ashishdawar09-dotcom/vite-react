// The race-day desk monitor (race-monitor function): what needs the
// director right now, how the day compares with the plan, and the email.
// Pure, so it's tested without a database or network. Times at the venue
// are UTC-7 (BC all year since Nov 2026).
//
// What it flags:
// - a court empty for 5+ minutes while a match could go on;
// - a match called 8+ minutes ago that hasn't started;
// - a match playing 10+ minutes longer than planned (often a score not confirmed);
// - an event whose groups are all in, with no knockout 3+ minutes later;
// - an event starting within 30 minutes with no draw;
// - the main event's final ready while other events still have matches
//   (the plan keeps it for last);
// - the day 20+ minutes behind the plan, and from 3 pm a finish after the
//   target time, with the run sheet's fix (remaining finals to one game).

import { esc, stageName, venueClock } from "./on_deck.ts";

const MIN = 60_000;

export const RULES = {
  emptyCourtMin: 5,
  calledMin: 8,
  overtimeMarginMin: 10,
  knockoutWaitMin: 3,
  noDrawLeadMin: 30,
  behindMin: 20,
  /** Once flagged, "behind" stays until the lag is under this. */
  behindClearMin: 10,
  /** Venue hour from which a late finish brings the finals suggestion. */
  lateFinishFromHour: 15,
  statusEveryMin: 30,
};

export type MonMatch = {
  id: string; category_id: string; stage: string; group_idx: number | null; round_idx: number | null;
  is_bronze: boolean; is_bye: boolean; status: string; confirmed: boolean;
  team_a_id: string | null; team_b_id: string | null;
  court_number: number | null; court_allocated_at: string | null; started_at: string | null; confirmed_at: string | null;
  best_of: number | null; extended_minutes: number | null;
};
export type MonCategory = {
  id: string; name: string; sort_order: number; starts_at: string | null; match_minutes: number | null;
  groups_count: number | null; top_n_advance: number | null; team_size: number;
};
export type MonTeam = { id: string; category_id: string; p1_id: string; p2_id: string | null };
export type MonPlayer = { id: string; name: string; active: boolean };
/** A singles entry (player_categories) of an active player. */
export type MonEntry = { category_id: string; player_id: string };
/** The day plan from the run sheet: each planned match's finish, the target and the main event. */
export type MonPlan = { ends: string[]; finish_by?: string | null; finale_category_id?: string | null };

export type MonInput = {
  now: number;
  numCourts: number;
  categories: MonCategory[];
  matches: MonMatch[];
  teams: MonTeam[];
  players: MonPlayer[];
  singles: MonEntry[];
  plan: MonPlan | null;
  /** Alerts raised on the last run (for "behind", which clears only once well back on plan). */
  openKeys?: string[];
};

export type Alert = { key: string; title: string; detail: string };
export type MonResult = {
  alerts: Alert[];
  courts: string[];
  done: number;
  total: number;
  /** Minutes behind the plan (negative: ahead); null without a plan. */
  lagMin: number | null;
  /** The plan's last finish (ms); null without a plan. */
  planEnd: number | null;
  allDone: boolean;
};

const t = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
const mins = (ms: number) => Math.max(0, Math.round(ms / MIN));
const isRoundRobinOnly = (c: MonCategory) => c.groups_count === 1 && (c.top_n_advance ?? 0) === 0;
const isCalled = (m: MonMatch) => m.status === "pending" && !m.confirmed && !!m.court_allocated_at && !m.started_at;
const isLive = (m: MonMatch) => m.status === "live" && !m.confirmed;
const isWaiting = (m: MonMatch) =>
  m.status === "pending" && !m.confirmed && !m.is_bye && !!m.team_a_id && !!m.team_b_id && !m.court_allocated_at;

export function evaluate(i: MonInput): MonResult {
  const { now } = i;
  const catById = new Map(i.categories.map((c) => [c.id, c]));
  const teamById = new Map(i.teams.map((x) => [x.id, x]));
  const playerById = new Map(i.players.map((p) => [p.id, p]));
  const lastRound = new Map<string, number>();
  for (const m of i.matches) {
    if (m.stage === "knockout" && !m.is_bronze) lastRound.set(m.category_id, Math.max(lastRound.get(m.category_id) ?? 0, m.round_idx ?? 0));
  }
  const playersOf = (teamId: string | null) => {
    const team = teamId ? teamById.get(teamId) : null;
    return team ? [team.p1_id, team.p2_id].filter((p): p is string => !!p) : [];
  };
  const teamName = (teamId: string | null) => playersOf(teamId).map((p) => playerById.get(p)?.name ?? "?").join(" & ") || "TBD";
  const label = (m: MonMatch) =>
    `${catById.get(m.category_id)?.name ?? "Match"} ${stageName(m, lastRound.get(m.category_id) ?? null)}: ${teamName(m.team_a_id)} vs ${teamName(m.team_b_id)}`;

  const alerts: Alert[] = [];
  const courts: string[] = [];

  // Who is on court (playing or called): they can't start another match.
  const busy = new Set<string>();
  for (const m of i.matches) if (isLive(m) || isCalled(m)) for (const p of [...playersOf(m.team_a_id), ...playersOf(m.team_b_id)]) busy.add(p);
  const starts = i.categories.map((c) => t(c.starts_at)).filter(Number.isFinite);
  const dayStart = starts.length ? Math.min(...starts) : null;
  const eventStart = (catId: string) => {
    const s = t(catById.get(catId)?.starts_at);
    return Number.isFinite(s) ? s : dayStart ?? -Infinity;
  };
  const sittingOut = (m: MonMatch) => [...playersOf(m.team_a_id), ...playersOf(m.team_b_id)].some((p) => playerById.get(p)?.active === false);
  const couldGoOn = i.matches.some((m) =>
    isWaiting(m) && eventStart(m.category_id) <= now && !sittingOut(m) &&
    [...playersOf(m.team_a_id), ...playersOf(m.team_b_id)].every((p) => !busy.has(p))
  );

  // Courts.
  for (let c = 1; c <= Math.max(1, i.numCourts); c++) {
    const here = i.matches.filter((m) => m.court_number === c);
    const live = here.find(isLive);
    const called = here.find(isCalled);
    if (live) {
      const startedAt = t(live.started_at);
      const elapsed = Number.isFinite(startedAt) ? mins(now - startedAt) : 0;
      const planned = (catById.get(live.category_id)?.match_minutes || 15) * (live.best_of === 3 ? 2 : 1) + (live.extended_minutes ?? 0);
      courts.push(`Court ${c}: ${label(live)} · playing ${elapsed} min`);
      if (elapsed >= planned + RULES.overtimeMarginMin) {
        alerts.push({
          key: `long:${live.id}`,
          title: `Court ${c}: playing ${elapsed} min`,
          detail: `${label(live)} (planned about ${planned} min). If it has finished, enter and confirm the score so the court frees up.`,
        });
      }
    } else if (called) {
      const ago = mins(now - t(called.court_allocated_at));
      courts.push(`Court ${c}: ${label(called)} · called ${ago} min ago`);
      if (ago >= RULES.calledMin) {
        alerts.push({
          key: `called:${called.id}`,
          title: `Court ${c}: called ${ago} min ago, not started`,
          detail: `${label(called)}. Check both teams are at the court; if they're already playing, tap Begin Scoring. If a team still isn't there in 5 minutes, cancel the call and call the next match.`,
        });
      }
    } else {
      const lastDone = Math.max(...here.map((m) => t(m.confirmed_at)).filter(Number.isFinite), -Infinity);
      const freeSince = Number.isFinite(lastDone) ? lastDone : dayStart;
      const idle = freeSince != null && now >= freeSince ? mins(now - freeSince) : 0;
      courts.push(`Court ${c}: empty${idle ? ` for ${idle} min` : ""}`);
      if (idle >= RULES.emptyCourtMin && couldGoOn) {
        alerts.push({
          key: `empty:${c}`,
          title: `Court ${c} has been empty for ${idle} min`,
          detail: "Matches are waiting. Call the next match in Up next (Live tab → Call).",
        });
      }
    }
  }

  // Events: groups done with no knockout; no draw close to the start.
  const sorted = [...i.categories].sort((a, b) => a.sort_order - b.sort_order);
  for (const c of sorted) {
    const mine = i.matches.filter((m) => m.category_id === c.id);
    const groups = mine.filter((m) => m.stage === "group");
    if (!isRoundRobinOnly(c) && groups.length > 0 && groups.every((m) => m.confirmed) && !mine.some((m) => m.stage === "knockout")) {
      const lastGroup = Math.max(...groups.map((m) => t(m.confirmed_at)).filter(Number.isFinite), -Infinity);
      if (!Number.isFinite(lastGroup) || now - lastGroup >= RULES.knockoutWaitMin * MIN) {
        alerts.push({
          key: `ko:${c.id}`,
          title: `${c.name}: groups done, knockout not started`,
          detail: "Start it now so its matches come into Up next: Live tab → Go to groups → Start Knockout.",
        });
      }
    }
    const entries = c.team_size === 1
      ? i.singles.filter((e) => e.category_id === c.id).length
      : i.teams.filter((x) => x.category_id === c.id).length;
    const start = t(c.starts_at);
    if (mine.length === 0 && entries >= 2 && Number.isFinite(start) && start - now <= RULES.noDrawLeadMin * MIN) {
      alerts.push({
        key: `nodraw:${c.id}`,
        title: `${c.name}: no draw yet`,
        detail: `It starts at ${venueClock(start)}. Teams tab → ${c.name} → tap the card with the fewest matches and start it.`,
      });
    }
  }

  // The main event's final is the day's last match in the plan.
  const finaleId = i.plan?.finale_category_id ?? null;
  const finaleCat = finaleId ? catById.get(finaleId) : null;
  if (finaleCat) {
    const last = lastRound.get(finaleCat.id);
    const final = i.matches.find((m) => m.category_id === finaleCat.id && m.stage === "knockout" && !m.is_bronze && m.round_idx === last);
    const othersLeft = i.matches.filter((m) => m.category_id !== finaleCat.id && !m.is_bye && !m.confirmed).length;
    if (final && isWaiting(final) && othersLeft > 0) {
      alerts.push({
        key: "finale",
        title: `Keep the ${finaleCat.name} final for last`,
        detail: `${othersLeft} match${othersLeft === 1 ? "" : "es"} in other events still to play. Call those first: in your plan the ${finaleCat.name} final is the day's last match.`,
      });
    }
  }

  // Progress and the plan.
  const playable = i.matches.filter((m) => !m.is_bye);
  const done = playable.filter((m) => m.confirmed).length;
  const total = playable.length;
  const koPending = alerts.some((a) => a.key.startsWith("ko:"));
  const allDone = total > 0 && done === total && !koPending && !i.categories.some((c) => {
    const mine = i.matches.filter((m) => m.category_id === c.id);
    return mine.length > 0 && !isRoundRobinOnly(c) && mine.every((m) => m.stage === "group");
  });

  let lagMin: number | null = null;
  let planEnd: number | null = null;
  const ends = (i.plan?.ends ?? []).map(t).filter(Number.isFinite).sort((a, b) => a - b);
  if (ends.length > 0) {
    planEnd = ends[ends.length - 1];
    lagMin = planLag(ends, done, now);
    const wasBehind = (i.openKeys ?? []).includes("behind");
    if (lagMin >= (wasBehind ? RULES.behindClearMin : RULES.behindMin) && !allDone) {
      alerts.push({
        key: "behind",
        title: `About ${Math.round(lagMin)} min behind plan`,
        detail: `${done} of ${total} matches done. Last match now about ${venueClock(planEnd + lagMin * MIN)} (plan ${venueClock(planEnd)}). Keep every court busy: call the next match as soon as a score is in.`,
      });
    }
    const finishBy = t(i.plan?.finish_by ?? null);
    const venueHour = new Date(now - 420 * MIN).getUTCHours();
    if (Number.isFinite(finishBy) && venueHour >= RULES.lateFinishFromHour && lagMin > 0 && planEnd + lagMin * MIN > finishBy && !allDone) {
      alerts.push({
        key: "late-finish",
        title: `On track to finish about ${venueClock(planEnd + lagMin * MIN)}`,
        detail: `That's after ${venueClock(finishBy)}. To catch up, make the remaining finals one game: Edit Event → Best of 3 games from → Never (about 20 minutes saved each).`,
      });
    }
  }

  return { alerts, courts, done, total, lagMin, planEnd, allDone };
}

/**
 * Minutes behind the plan (negative: ahead). With `done` matches finished,
 * the plan was here between its done-th and (done+1)-th finish: past the
 * next planned finish we're behind by the time since it; before the last
 * reached one we're ahead.
 */
export function planLag(ends: number[], done: number, now: number): number {
  if (done < ends.length && now > ends[done]) return (now - ends[done]) / MIN;
  if (done >= 1 && done <= ends.length && ends[done - 1] > now) return -(ends[done - 1] - now) / MIN;
  return 0;
}

export type MonitorState = {
  /** Open alerts, with when each was first emailed. */
  sent?: Record<string, string>;
  last_email_at?: string;
  all_done_sent?: boolean;
};

export type Decision = { send: boolean; kind: "alert" | "status" | "done" | null; fresh: Alert[]; state: MonitorState };

/**
 * Whether this run emails: when a new alert appears, every 30 minutes with
 * the status (any email resets the clock, since each carries the status),
 * and once when every match is done. Alerts that have gone away are
 * forgotten, so they're emailed again if they come back.
 */
export function decide(r: MonResult, state: MonitorState, now: number): Decision {
  const sent: Record<string, string> = {};
  const fresh: Alert[] = [];
  for (const a of r.alerts) {
    if (state.sent?.[a.key]) sent[a.key] = state.sent[a.key];
    else { fresh.push(a); sent[a.key] = new Date(now).toISOString(); }
  }
  if (state.all_done_sent) return { send: false, kind: null, fresh: [], state: { ...state, sent } };
  if (r.allDone) return { send: true, kind: "done", fresh, state: { sent: {}, last_email_at: new Date(now).toISOString(), all_done_sent: true } };
  const last = t(state.last_email_at);
  const statusDue = !Number.isFinite(last) || now - last >= (RULES.statusEveryMin - 1) * MIN;
  const kind = fresh.length > 0 ? "alert" : statusDue ? "status" : null;
  return {
    send: kind != null,
    kind,
    fresh,
    state: { sent, last_email_at: kind ? new Date(now).toISOString() : state.last_email_at, all_done_sent: false },
  };
}

export function planLine(r: MonResult): string {
  if (r.lagMin == null || r.planEnd == null) return `${r.done} of ${r.total} matches done (no day plan loaded).`;
  const lag = Math.round(r.lagMin);
  const pace = lag >= 3 ? `About ${lag} min behind plan` : lag <= -3 ? `About ${-lag} min ahead of plan` : "On plan";
  return `${pace}: ${r.done} of ${r.total} matches done. Last match about ${venueClock(r.planEnd + Math.max(-30, r.lagMin) * MIN)} (plan ${venueClock(r.planEnd)}).`;
}

export function composeEmail(
  r: MonResult,
  o: { tournament: string; now: number; kind: "alert" | "status" | "done" | "test"; fresh: Alert[] },
): { subject: string; text: string; html: string } {
  const when = venueClock(o.now);
  const lag = r.lagMin == null ? null : Math.round(r.lagMin);
  const pace = lag == null ? `${r.done}/${r.total} done` : lag >= 3 ? `${lag} min behind plan` : lag <= -3 ? `${-lag} min ahead of plan` : "on plan";
  const freshKeys = new Set(o.fresh.map((a) => a.key));
  const subject = o.kind === "done"
    ? `All matches done · ${o.tournament}`
    : o.kind === "alert"
      ? `⚠ ${o.fresh[0].title}${o.fresh.length > 1 ? ` (+${o.fresh.length - 1} more)` : ""} · ${o.tournament}`
      : `${o.kind === "test" ? "[Test] " : ""}Desk check ${when}: ${pace}${r.alerts.length ? `, ${r.alerts.length} to act on` : ""} · ${o.tournament}`;

  const lines: string[] = [`Desk check · ${when}`, ""];
  if (o.kind === "done") lines.push(`Every match is done (${r.done} played). The monitor stops here. Congratulations!`, "");
  if (r.alerts.length) {
    lines.push("NEEDS YOU NOW");
    for (const a of r.alerts) lines.push(`• ${freshKeys.has(a.key) ? "[new] " : ""}${a.title}`, `  ${a.detail}`);
    lines.push("");
  }
  lines.push("PLAN", planLine(r), "", "COURTS", ...r.courts, "");
  lines.push("From the race-day monitor: it checks every 10 minutes, emails when something needs you, and sends this status every 30 minutes. Turn it off in the app: Emails tab → Desk monitor.");
  const text = lines.join("\n");

  const block = (title: string, body: string) =>
    `<tr><td style="padding:16px 24px 4px;"><div style="color:#64748b;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">${title}</div>${body}</td></tr>`;
  const alertsHtml = r.alerts.map((a) =>
    `<div style="margin-top:10px;padding:12px 14px;border-radius:10px;background:${freshKeys.has(a.key) ? "#fef2f2" : "#f8fafc"};border-left:4px solid ${freshKeys.has(a.key) ? "#dc2626" : "#94a3b8"};">
      <div style="font-size:15px;font-weight:800;color:#0f172a;">${freshKeys.has(a.key) ? "NEW · " : ""}${esc(a.title)}</div>
      <div style="font-size:14px;color:#334155;margin-top:4px;line-height:1.45;">${esc(a.detail)}</div></div>`).join("");
  const html =
`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Desk check</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef2f7;padding:20px 10px;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0f172a;padding:20px 24px;"><div style="color:#94a3b8;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">${esc(o.tournament)} · desk check ${esc(when)}</div>
<div style="color:#ffffff;font-size:22px;font-weight:900;margin-top:6px;">${o.kind === "done" ? "All matches done" : r.alerts.length ? `${r.alerts.length} thing${r.alerts.length === 1 ? "" : "s"} to act on` : "All clear"}</div></td></tr>
${r.alerts.length ? block("Needs you now", alertsHtml) : ""}
${block("Plan", `<div style="font-size:14px;color:#0f172a;margin-top:6px;line-height:1.45;">${esc(planLine(r))}</div>`)}
${block("Courts", r.courts.map((c) => `<div style="font-size:13px;color:#334155;margin-top:6px;">${esc(c)}</div>`).join(""))}
<tr><td style="padding:16px 24px 22px;color:#94a3b8;font-size:12px;line-height:1.5;">From the race-day monitor: it checks every 10 minutes, emails when something needs you, and sends this status every 30 minutes. Turn it off in the app: Emails tab → Desk monitor.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
