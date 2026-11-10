// Projected times for every match, venue wide. One timing model, used by the
// phones (useScheduling) and the venue TV (tvModel), so they always agree.
//
// One match's turn on a court:
//
//   call ──call to serve──▶ first serve ──play──▶ score confirmed ──changeover──▶ next call on that court
//
// A waiting match's projected time is its expected court call: when its
// players should be ready. A called match's is its expected first serve.
//
// Play time is per event: the event's match length (category.match_minutes),
// doubled for a best-of-3 match (matches.best_of = 3, stamped from the event's
// "Best of 3 games from" setting; see src/lib/bestOf3.ts), and learned from the
// event's own finished matches once three are in (before that, from the
// venue's pace so far, once any three are in). Call to serve and changeover are the
// venue's: fixed numbers until three real samples exist, then learned from the
// day's court calls (see learnTurnaround).
//
// The tournament's courts are shared by every event, so there is one set of
// court free-at times for the whole venue:
//
// 1. Live matches hold their court until their expected finish.
// 2. Called matches (court allocated, warming up) hold their court next.
// 3. Then, whichever court frees first takes the next match the desk would
//    call: the one that can be called soonest. A match waits for its event's
//    start time, for its players to be off court (a player entered in two
//    events counts in both), and (knockout) for the matches that feed it.
//    Ties go to the event that has waited longest for a court, then the
//    earlier event start, then the event order. Inside an event the admin's
//    queue order decides, looking at most LOOKAHEAD matches down the queue for
//    one whose players are free.
//
// An event without its own start time starts with the earliest event that
// has one, until play is underway; from then on it can go as soon as a court
// frees. Every projected time is floored at `now`, so a backlog rolls forward
// with the clock instead of showing times in the past.
//
// Pure, so it can be tested without React; useScheduling wraps it.

import type { Category, Match, ProjectedMatch, Team } from "../types";
import { isBestOf3 } from "./bestOf3";
import { isCancelledMatch } from "./matchOutcome";

const MIN = 60_000;
/** How far down an event's queue the desk looks for a match whose players are off court. */
const LOOKAHEAD = 8;
/** Starts closer than this count as the same time when picking the next match. */
const TIE_MS = 1_000;
/** Real samples needed before a learned number replaces the fixed one. */
const MIN_SAMPLES = 3;
/** Most recent samples used for a learned number; the newest weigh most. */
const SAMPLE_WINDOW = 8;
/** A court idle longer than this between a score and the next call was waiting for players or on a break, not changing over. */
const MAX_CHANGEOVER_SAMPLE_MIN = 15;
/** A called match not started within this was a no-show or a problem, not a normal walk-on. */
const MAX_CALL_TO_SERVE_SAMPLE_MIN = 20;

export type Timing = {
  /** Minutes from the court call to the first serve: walking on and the warm up. */
  callToServeMin: number;
  /** Minutes from a confirmed score to the next call on that court. */
  changeoverMin: number;
  /** A best-of-3 match (isBestOf3: matches.best_of = 3) plays this many times a one-game match. */
  bestOf3Factor: number;
  /** Replace callToServeMin and changeoverMin with the day's own numbers once there are enough samples. */
  learnTurnaround: boolean;
};

/** The race-day model. Change it here and both the phones and the venue TV follow. */
export const RACE_DAY_TIMING: Timing = {
  callToServeMin: 4,
  changeoverMin: 2,
  bestOf3Factor: 2,
  learnTurnaround: true,
};

export type TeamPlayers = Pick<Team, "id" | "p1_id" | "p2_id">;

export type ProjectionOptions = {
  /** The tournament's teams, so a player entered in two events is never on two courts at once. Without them, teams stand in for players. */
  teams?: TeamPlayers[];
  /** Overrides for RACE_DAY_TIMING (tests). */
  timing?: Partial<Timing>;
};

export type Schedule = {
  projected: ProjectedMatch[];
  byId: Record<string, ProjectedMatch>;
  /** Average minutes completed matches finished after their scheduled finish. */
  tournamentDeltaMin: number;
  tournamentDeltaLabel: string;
  liveByCourt: Record<number, ProjectedMatch | undefined>;
};

export type VenueProjection = Schedule & {
  /** Expected end of the last match still to play (live, called or waiting); null when nothing is left. */
  finish: number | null;
  /** The call to serve and changeover minutes used: fixed, or learned from the day. */
  turnaround: Turnaround;
};

export type Turnaround = Pick<Timing, "callToServeMin" | "changeoverMin">;

function parseT(s: string | null): number | null {
  if (!s) return null;
  const n = new Date(s).getTime();
  return Number.isFinite(n) ? n : null;
}

export function fmtDelta(min: number): string {
  const m = Math.round(min);
  if (Math.abs(m) < 1) return "ON TIME";
  if (m < 0) return `${-m} MIN AHEAD`;
  return `${m} MIN BEHIND`;
}

/** Weighted average, newest first in `xs`: weights n, n-1, … 1. */
function recentAverage(xs: number[]): number {
  const w = xs.map((_, i) => xs.length - i);
  const sumW = w.reduce((a, b) => a + b, 0);
  return xs.reduce((s, x, i) => s + x * w[i], 0) / sumW;
}

/** Played, not a walkover, bye or cancellation: its times say something about real play. */
function wasPlayed(m: Match): boolean {
  return m.confirmed && !m.is_walkover && !m.is_bye && !isCancelledMatch(m);
}

/**
 * How many one-game matches `m` counts as on court: `factor` for a best-of-3
 * match, 1 otherwise. Each match carries its own format (matches.best_of), so
 * this follows the event's "Best of 3 games from" setting, bronze included.
 */
export function gamesFactor(m: Pick<Match, "best_of">, factor = RACE_DAY_TIMING.bestOf3Factor): number {
  return isBestOf3(m) ? factor : 1;
}

/**
 * Weighted-avg of actual one-game play time for the given category. Falls back
 * to the nominal `fallback` (category.match_minutes) until at least 3 matches
 * have completed. Recent matches weight more heavily so a sudden shift in
 * pacing influences projections quickly. A best-of-3 match counts as
 * `factorOf(m)` games, so a semifinal doesn't stretch the group stage's numbers.
 *
 * Window: last 5 confirmed non-walkover, non-bye, non-cancelled matches. Weights: 5,4,3,2,1.
 */
export function adaptiveMatchMinutes(matches: Match[], categoryId: string, fallback: number, factorOf: (m: Match) => number = m => gamesFactor(m)): number {
  const completed = matches.filter(m => m.category_id === categoryId && wasPlayed(m) && m.started_at && m.confirmed_at);
  if (completed.length < MIN_SAMPLES) return fallback;
  const recent = [...completed]
    .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""))
    .slice(0, 5)
    .map(m => (new Date(m.confirmed_at!).getTime() - new Date(m.started_at!).getTime()) / MIN / Math.max(1, factorOf(m)));
  // Clamp to a reasonable range — avoid extreme outliers throwing projections off.
  return Math.max(2, Math.min(60, recentAverage(recent)));
}

/**
 * How the day's play compares with the events' nominal match length, venue
 * wide: 1.25 means games run a quarter longer than planned. Null until 3
 * matches have been played. Used for events that haven't finished 3 matches
 * of their own yet, so early estimates follow the day's pace.
 */
export function venuePace(matches: Match[], nominalOf: (m: Match) => number, factorOf: (m: Match) => number = m => gamesFactor(m)): number | null {
  const samples = matches
    .filter(m => wasPlayed(m) && m.started_at && m.confirmed_at && nominalOf(m) > 0)
    .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""))
    .slice(0, SAMPLE_WINDOW)
    .map(m => (new Date(m.confirmed_at!).getTime() - new Date(m.started_at!).getTime()) / MIN / Math.max(1, factorOf(m)) / nominalOf(m));
  if (samples.length < MIN_SAMPLES) return null;
  return recentAverage(samples);
}

/**
 * The venue's call to serve and changeover, learned from the day's court calls.
 *
 * - Call to serve: court_allocated_at → started_at of each played match.
 * - Changeover: confirmed_at of a played match → court_allocated_at of the next
 *   match called to the same court. A call made before the score was in counts
 *   as 0; a gap over 15 minutes was an idle court, not a changeover.
 *
 * Each number stays at `fallback` until it has 3 samples; then it is the
 * weighted average of the latest 8 (newest weigh most).
 */
export function learnTurnaround(matches: Match[], fallback: Turnaround): Turnaround {
  const callToServe: { at: number; min: number }[] = [];
  const changeover: { at: number; min: number }[] = [];

  const byCourt = new Map<number, Match[]>();
  for (const m of matches) {
    const called = parseT(m.court_allocated_at);
    if (called == null || m.court_number == null || m.is_bye || isCancelledMatch(m)) continue;
    const started = parseT(m.started_at);
    if (wasPlayed(m) && started != null && started >= called && started - called <= MAX_CALL_TO_SERVE_SAMPLE_MIN * MIN) {
      callToServe.push({ at: started, min: (started - called) / MIN });
    }
    const arr = byCourt.get(m.court_number) ?? [];
    arr.push(m);
    byCourt.set(m.court_number, arr);
  }
  for (const list of byCourt.values()) {
    list.sort((a, b) => parseT(a.court_allocated_at)! - parseT(b.court_allocated_at)!);
    for (let i = 0; i + 1 < list.length; i++) {
      const prev = list[i];
      const done = parseT(prev.confirmed_at);
      if (!wasPlayed(prev) || done == null) continue;
      const gap = (parseT(list[i + 1].court_allocated_at)! - done) / MIN;
      if (gap > MAX_CHANGEOVER_SAMPLE_MIN) continue;
      changeover.push({ at: done, min: Math.max(0, gap) });
    }
  }

  const learned = (samples: { at: number; min: number }[], prior: number) => {
    if (samples.length < MIN_SAMPLES) return prior;
    const recent = samples.sort((a, b) => b.at - a.at).slice(0, SAMPLE_WINDOW).map(s => s.min);
    return recentAverage(recent);
  };
  return {
    callToServeMin: learned(callToServe, fallback.callToServeMin),
    changeoverMin: learned(changeover, fallback.changeoverMin),
  };
}

/** Queue order inside one event: group stage before knockout, then group/round, then the admin's queue position. */
function queueOrder(a: Match, b: Match): number {
  const stageA = a.stage === "group" ? 0 : 1;
  const stageB = b.stage === "group" ? 0 : 1;
  if (stageA !== stageB) return stageA - stageB;
  const ai = a.stage === "group" ? (a.group_idx ?? 0) : (a.round_idx ?? 0);
  const bi = b.stage === "group" ? (b.group_idx ?? 0) : (b.round_idx ?? 0);
  if (ai !== bi) return ai - bi;
  return (a.queue_position ?? a.slot_idx) - (b.queue_position ?? b.slot_idx);
}

/** Pending, waiting for a court call: the matches the simulation places. */
function isQueued(m: Match): boolean {
  return m.status === "pending" && !m.confirmed && !m.is_bye;
}

function pendingLabel(m: Match, deltaMin: number): string {
  if (m.is_bye) return "BYE";
  if (deltaMin > 60) return "LATER";
  if (deltaMin > 1) return `IN ${Math.round(deltaMin)}M`;
  // After the now-floor, delta_min is at or near 0 for any backlogged match.
  // The wall-clock at projected_start_at rolls forward as real time passes
  // (fmtClock in the UI), so this label is purely a "ready" signal.
  return "STARTS NOW";
}

/** The matches whose result decides who plays `m` (knockout only). */
function feedersOf(m: Match, catMatches: Match[]): Match[] {
  if (m.stage !== "knockout") return [];
  const r = m.round_idx ?? 0;
  if (r === 0) return catMatches.filter(x => x.stage === "group");
  const prev = catMatches.filter(x => x.stage === "knockout" && !x.is_bronze && (x.round_idx ?? 0) === r - 1);
  if (m.is_bronze) return prev;
  const direct = prev.filter(x => x.slot_idx === m.slot_idx * 2 || x.slot_idx === m.slot_idx * 2 + 1);
  return direct.length ? direct : prev;
}

/**
 * Earliest time each event's matches may start. An event without its own
 * start time starts with the earliest event that has one, until play is
 * underway (anything called, live or finished); from then on, now.
 */
export function eventStarts(matches: Pick<Match, "confirmed" | "status" | "court_allocated_at">[], categories: Pick<Category, "id" | "starts_at">[], now: number): Map<string, number> {
  const underway = matches.some(m => m.confirmed || m.status !== "pending" || !!m.court_allocated_at);
  const own = categories.map(c => parseT(c.starts_at)).filter((n): n is number => n != null);
  const fallback = !underway && own.length ? Math.min(...own) : now;
  return new Map(categories.map(c => [c.id, parseT(c.starts_at) ?? fallback]));
}

type EventInfo = {
  cat: Category;
  index: number;
  /** Earliest time this event's matches may start. */
  start: number;
  /** One game's play time, minutes. */
  playMin: number;
  /** Most recent call or start (real or projected) of one of its matches; -Infinity before its first. */
  last: number;
  /** Queued matches not yet placed, in queue order. */
  rest: Match[];
};

type Slot = Pick<ProjectedMatch, "projected_start_at" | "delta_min" | "delta_label">;

/** Projected times for every match, plus what the venue TV needs: the day's expected finish and the turnaround used. */
export function projectVenue(matches: Match[], categories: Category[], numCourts: number, now: number, opts: ProjectionOptions = {}): VenueProjection {
  const timing: Timing = { ...RACE_DAY_TIMING, ...opts.timing };
  const fixed: Turnaround = { callToServeMin: timing.callToServeMin, changeoverMin: timing.changeoverMin };
  if (matches.length === 0) {
    return { projected: [], byId: {}, tournamentDeltaMin: 0, tournamentDeltaLabel: fmtDelta(0), liveByCourt: {}, finish: null, turnaround: fixed };
  }
  const turnaround = timing.learnTurnaround ? learnTurnaround(matches, fixed) : fixed;
  const callToServe = turnaround.callToServeMin * MIN;
  const changeover = turnaround.changeoverMin * MIN;

  const courtCount = Math.max(1, numCourts || 1);
  const inRange = (c: number | null): c is number => c != null && c >= 1 && c <= courtCount;
  const isCalled = (m: Match) => isQueued(m) && inRange(m.court_number) && !!m.court_allocated_at && !m.started_at;

  // Who must be free for a match to go on: its players, or the team itself when its players aren't known.
  const playersOfTeam = new Map<string, string[]>();
  for (const t of opts.teams ?? []) {
    const ps = [t.p1_id, t.p2_id].filter((p): p is string => !!p);
    if (ps.length) playersOfTeam.set(t.id, ps);
  }
  const partiesOf = (m: Match): string[] => [m.team_a_id, m.team_b_id].flatMap(t => (t ? playersOfTeam.get(t) ?? [`team:${t}`] : []));

  const factorOf = (m: Match) => gamesFactor(m, timing.bestOf3Factor);

  const byCat = new Map<string, Match[]>();
  for (const m of matches) {
    const arr = byCat.get(m.category_id) ?? [];
    arr.push(m);
    byCat.set(m.category_id, arr);
  }
  const sortedByCat = new Map<string, Match[]>();
  for (const cat of categories) sortedByCat.set(cat.id, (byCat.get(cat.id) ?? []).slice().sort(queueOrder));

  const starts = eventStarts(matches, categories, now);

  const free: number[] = Array.from({ length: courtCount }, () => now);
  const busyUntil = new Map<string, number>();
  const endOf = new Map<string, number>();
  const slots = new Map<string, Slot>();
  const hold = (m: Match, until: number) => {
    for (const p of partiesOf(m)) busyUntil.set(p, Math.max(busyUntil.get(p) ?? -Infinity, until));
  };
  const partiesFree = (m: Match) => partiesOf(m).reduce((t, p) => Math.max(t, busyUntil.get(p) ?? -Infinity), -Infinity);

  // Play time: the event's own pace once it has 3 finished matches; before
  // that its nominal length, scaled by the venue's pace when there is one.
  const nominal = new Map(categories.map(c => [c.id, c.match_minutes || 12]));
  const pace = venuePace(matches, m => nominal.get(m.category_id) ?? 0, factorOf);
  const events: EventInfo[] = categories.map((cat, index) => {
    const planned = nominal.get(cat.id)!;
    const fallback = pace == null ? planned : Math.max(2, Math.min(60, planned * pace));
    return {
      cat,
      index,
      start: starts.get(cat.id) ?? now,
      playMin: adaptiveMatchMinutes(matches, cat.id, fallback, factorOf),
      last: -Infinity,
      rest: [],
    };
  });
  const playOf = (m: Match, ev: EventInfo) => ev.playMin * factorOf(m) * MIN;

  let tournamentDeltaSum = 0;
  let tournamentDeltaCount = 0;

  // Pass 1: what has happened or is happening.
  for (const ev of events) {
    for (const m of sortedByCat.get(ev.cat.id) ?? []) {
      const startedAt = parseT(m.started_at);
      const confirmedAt = parseT(m.confirmed_at);
      const scheduledAt = parseT(m.scheduled_at);
      const begun = startedAt ?? parseT(m.court_allocated_at);
      if (begun != null && !isQueued(m)) ev.last = Math.max(ev.last, begun);

      if (m.confirmed && confirmedAt && scheduledAt) {
        const d = (confirmedAt - (scheduledAt + playOf(m, ev))) / MIN;
        slots.set(m.id, {
          projected_start_at: m.scheduled_at,
          delta_min: d,
          delta_label: isCancelledMatch(m) ? "CANCELLED" : m.is_walkover ? "WALKOVER" : (d > 1 ? `${Math.round(d)}M LATE` : d < -1 ? `${Math.round(-d)}M EARLY` : "ON TIME"),
        });
        tournamentDeltaSum += d;
        tournamentDeltaCount++;
      }
      if (m.confirmed && confirmedAt && inRange(m.court_number)) {
        // A court that has just finished a match needs its changeover before the next call.
        const after = wasPlayed(m) ? confirmedAt + changeover : confirmedAt;
        free[m.court_number - 1] = Math.max(free[m.court_number - 1], after);
      }
      if (m.confirmed && confirmedAt && scheduledAt) continue;

      if (m.status === "live" && startedAt) {
        const totalMs = playOf(m, ev) + (m.extended_minutes ?? 0) * MIN;
        const totalMin = totalMs / MIN;
        const elapsed = (now - startedAt) / MIN;
        const end = Math.max(now, startedAt + totalMs);
        slots.set(m.id, {
          projected_start_at: m.started_at,
          delta_min: elapsed - totalMin,
          delta_label: elapsed > totalMin + 1 ? `${Math.round(elapsed - totalMin)}M OVER` : `${Math.round(elapsed)}M PLAYING`,
        });
        if (inRange(m.court_number)) free[m.court_number - 1] = Math.max(free[m.court_number - 1], end + changeover);
        hold(m, end);
        endOf.set(m.id, end);
      } else if (m.status === "pending" && !m.confirmed && m.is_bye) {
        // A bye needs no court.
        const start = Math.max(now, ev.start);
        const deltaMin = (start - now) / MIN;
        slots.set(m.id, { projected_start_at: new Date(start).toISOString(), delta_min: deltaMin, delta_label: "BYE" });
      } else if (isQueued(m)) {
        if (!isCalled(m)) ev.rest.push(m);
      } else if (!slots.has(m.id)) {
        slots.set(m.id, { projected_start_at: m.scheduled_at, delta_min: null, delta_label: m.is_bye ? "BYE" : "" });
      }
    }
  }

  /** Puts `m` on `court`: shown at `shownAt`, first serve at `serve`. */
  const place = (m: Match, ev: EventInfo, court: number, shownAt: number, serve: number) => {
    const end = serve + playOf(m, ev);
    const deltaMin = (shownAt - now) / MIN;
    slots.set(m.id, { projected_start_at: new Date(shownAt).toISOString(), delta_min: deltaMin, delta_label: pendingLabel(m, deltaMin) });
    free[court] = end + changeover;
    hold(m, end);
    endOf.set(m.id, end);
  };

  // Pass 2: called matches start on the court they were given, in call order,
  // once their players have walked on and the court is clear.
  const called = events
    .flatMap(ev => (sortedByCat.get(ev.cat.id) ?? []).filter(isCalled).map(m => ({ m, ev })))
    .sort((x, y) => (parseT(x.m.court_allocated_at) ?? 0) - (parseT(y.m.court_allocated_at) ?? 0));
  for (const { m, ev } of called) {
    const court = m.court_number! - 1;
    const calledAt = parseT(m.court_allocated_at) ?? now;
    const serve = Math.max(now, calledAt + callToServe, free[court], partiesFree(m));
    place(m, ev, court, serve, serve);
    ev.last = Math.max(ev.last, calledAt);
  }

  // Pass 3: everything still queued, one court at a time.
  const feeders = new Map<string, Match[]>();
  for (const ev of events) {
    const all = sortedByCat.get(ev.cat.id) ?? [];
    for (const m of ev.rest) feeders.set(m.id, feedersOf(m, all));
  }
  const unplaced = new Set(events.flatMap(ev => ev.rest.map(m => m.id)));
  const readyAt = (m: Match, ev: EventInfo): number => {
    let r = Math.max(ev.start, partiesFree(m));
    for (const f of feeders.get(m.id) ?? []) {
      if (unplaced.has(f.id)) return Infinity;
      const end = endOf.get(f.id);
      if (end != null) r = Math.max(r, end);
    }
    return r;
  };

  while (unplaced.size > 0) {
    let court = 0;
    for (let i = 1; i < free.length; i++) if (free[i] < free[court]) court = i;
    const at = free[court];

    let best: { ev: EventInfo; idx: number; start: number } | null = null;
    for (const ev of events) {
      for (let idx = 0; idx < Math.min(LOOKAHEAD, ev.rest.length); idx++) {
        const ready = readyAt(ev.rest[idx], ev);
        if (!Number.isFinite(ready)) continue;
        const start = Math.max(at, ready);
        if (!best || start < best.start - TIE_MS) { best = { ev, idx, start }; continue; }
        if (start > best.start + TIE_MS) continue;
        // Same time: the event that has waited longest, then the earlier
        // event start, then event order, then queue order.
        const b = best.ev;
        const better =
          ev !== b
            ? ev.last !== b.last ? ev.last < b.last
              : ev.start !== b.start ? ev.start < b.start
              : ev.cat.sort_order !== b.cat.sort_order ? ev.cat.sort_order < b.cat.sort_order
              : ev.index < b.index
            : idx < best.idx;
        if (better) best = { ev, idx, start };
      }
    }
    if (!best) break; // Unreachable with well-formed data: the front of every queue only waits on placed matches.

    const [m] = best.ev.rest.splice(best.idx, 1);
    const call = Math.max(at, readyAt(m, best.ev));
    unplaced.delete(m.id);
    place(m, best.ev, court, call, call + callToServe);
    best.ev.last = Math.max(best.ev.last, call);
  }

  // Output in event order, queue order inside each, as before.
  const projected: ProjectedMatch[] = [];
  for (const ev of events) {
    for (const m of sortedByCat.get(ev.cat.id) ?? []) {
      const s = slots.get(m.id) ?? { projected_start_at: m.scheduled_at, delta_min: null, delta_label: "" };
      projected.push({ ...m, ...s });
    }
  }

  const byId: Record<string, ProjectedMatch> = {};
  for (const p of projected) byId[p.id] = p;

  const liveByCourt: Record<number, ProjectedMatch | undefined> = {};
  for (const p of projected) {
    if (p.status === "live" && p.court_number != null) liveByCourt[p.court_number] = p;
  }

  const tournamentDeltaMin = tournamentDeltaCount > 0 ? tournamentDeltaSum / tournamentDeltaCount : 0;
  const finish = endOf.size ? Math.max(...endOf.values()) : null;
  return { projected, byId, tournamentDeltaMin, tournamentDeltaLabel: fmtDelta(tournamentDeltaMin), liveByCourt, finish, turnaround };
}

/** Projected times for every match (the phones' view). Same model as the venue TV. */
export function projectSchedule(matches: Match[], categories: Category[], numCourts: number, now: number, opts: ProjectionOptions = {}): Schedule {
  const { projected, byId, tournamentDeltaMin, tournamentDeltaLabel, liveByCourt } = projectVenue(matches, categories, numCourts, now, opts);
  return { projected, byId, tournamentDeltaMin, tournamentDeltaLabel, liveByCourt };
}
