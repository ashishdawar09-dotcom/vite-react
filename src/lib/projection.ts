// Projected start times for every match, venue wide.
//
// The tournament's courts are shared by every event, so there is one set of
// court free-at times for the whole venue:
//
// 1. Live matches hold their court until their expected finish.
// 2. Called matches (court allocated, warming up) hold their court next.
// 3. Then, whichever court frees first takes the next match the desk would
//    call: the one that can start soonest. A match waits for its event's
//    start time, for both teams to be off court, and (knockout) for the
//    matches that feed it. Ties go to the event that has waited longest for
//    a court, then the earlier event start, then the event order. Inside an
//    event the admin's queue order decides, looking at most LOOKAHEAD
//    matches down the queue for one whose teams are free.
//
// An event without its own start time starts with the earliest event that
// has one, until play is underway; from then on it can go as soon as a court
// frees. Every projected start is floored at `now`, so a backlog rolls
// forward with the clock instead of showing times in the past.
//
// Pure, so it can be tested without React; useScheduling wraps it.

import type { Category, Match, ProjectedMatch } from "../types";
import { isCancelledMatch } from "./matchOutcome";

const MIN = 60_000;
/** How far down an event's queue the desk looks for a match whose teams are off court. */
const LOOKAHEAD = 8;
/** Starts closer than this count as the same time when picking the next match. */
const TIE_MS = 1_000;

export type Schedule = {
  projected: ProjectedMatch[];
  byId: Record<string, ProjectedMatch>;
  /** Average minutes completed matches finished after their scheduled finish. */
  tournamentDeltaMin: number;
  tournamentDeltaLabel: string;
  liveByCourt: Record<number, ProjectedMatch | undefined>;
};

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

/**
 * Weighted-avg of actual match durations for the given category. Falls back to
 * the nominal `fallback` (category.match_minutes) until at least 3 matches have
 * completed. Recent matches weight more heavily so a sudden shift in pacing
 * (e.g. tighter scoring in the knockout rounds) influences projections quickly.
 *
 * Window: last 5 confirmed non-walkover, non-bye, non-cancelled matches. Weights: 5,4,3,2,1.
 */
export function adaptiveMatchMinutes(matches: Match[], categoryId: string, fallback: number): number {
  const completed = matches.filter(m =>
    m.category_id === categoryId &&
    m.confirmed && !m.is_walkover && !m.is_bye && !isCancelledMatch(m) &&
    m.started_at && m.confirmed_at,
  );
  if (completed.length < 3) return fallback;
  const recent = [...completed]
    .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""))
    .slice(0, 5);
  const weights = recent.map((_, i) => recent.length - i);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const weighted = recent.reduce((sum, m, i) => {
    const dur = (new Date(m.confirmed_at!).getTime() - new Date(m.started_at!).getTime()) / MIN;
    return sum + dur * weights[i];
  }, 0) / sumW;
  // Clamp to a reasonable range — avoid extreme outliers throwing projections off.
  return Math.max(2, Math.min(60, weighted));
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
  matchMin: number;
  /** Most recent start (real or projected) of one of its matches; -Infinity before its first. */
  last: number;
  /** Queued matches not yet placed, in queue order. */
  rest: Match[];
};

type Slot = Pick<ProjectedMatch, "projected_start_at" | "delta_min" | "delta_label">;

export function projectSchedule(matches: Match[], categories: Category[], numCourts: number, now: number): Schedule {
  if (matches.length === 0) {
    return { projected: [], byId: {}, tournamentDeltaMin: 0, tournamentDeltaLabel: fmtDelta(0), liveByCourt: {} };
  }

  const courtCount = Math.max(1, numCourts || 1);
  const inRange = (c: number | null): c is number => c != null && c >= 1 && c <= courtCount;
  const isCalled = (m: Match) => isQueued(m) && inRange(m.court_number) && !!m.court_allocated_at && !m.started_at;

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
  const teamFree = new Map<string, number>();
  const endOf = new Map<string, number>();
  const slots = new Map<string, Slot>();
  const holdTeams = (m: Match, until: number) => {
    for (const t of [m.team_a_id, m.team_b_id]) if (t) teamFree.set(t, Math.max(teamFree.get(t) ?? -Infinity, until));
  };

  const events: EventInfo[] = categories.map((cat, index) => {
    const nominal = cat.match_minutes || 12;
    return {
      cat,
      index,
      start: starts.get(cat.id) ?? now,
      matchMin: adaptiveMatchMinutes(matches, cat.id, nominal),
      last: -Infinity,
      rest: [],
    };
  });

  let tournamentDeltaSum = 0;
  let tournamentDeltaCount = 0;

  // Pass 1: what has happened or is happening.
  for (const ev of events) {
    const nominal = ev.cat.match_minutes || 12;
    for (const m of sortedByCat.get(ev.cat.id) ?? []) {
      const startedAt = parseT(m.started_at);
      const confirmedAt = parseT(m.confirmed_at);
      const scheduledAt = parseT(m.scheduled_at);
      const begun = startedAt ?? parseT(m.court_allocated_at);
      if (begun != null && !isQueued(m)) ev.last = Math.max(ev.last, begun);

      if (m.confirmed && confirmedAt && scheduledAt) {
        const d = (confirmedAt - (scheduledAt + ev.matchMin * MIN)) / MIN;
        slots.set(m.id, {
          projected_start_at: m.scheduled_at,
          delta_min: d,
          delta_label: isCancelledMatch(m) ? "CANCELLED" : m.is_walkover ? "WALKOVER" : (d > 1 ? `${Math.round(d)}M LATE` : d < -1 ? `${Math.round(-d)}M EARLY` : "ON TIME"),
        });
        if (inRange(m.court_number)) free[m.court_number - 1] = Math.max(free[m.court_number - 1], confirmedAt);
        tournamentDeltaSum += d;
        tournamentDeltaCount++;
      } else if (m.status === "live" && startedAt) {
        const totalMin = nominal + (m.extended_minutes ?? 0);
        const expectedFinish = startedAt + totalMin * MIN;
        const elapsed = (now - startedAt) / MIN;
        const end = Math.max(now, expectedFinish);
        slots.set(m.id, {
          projected_start_at: m.started_at,
          delta_min: elapsed - totalMin,
          delta_label: elapsed > totalMin + 1 ? `${Math.round(elapsed - totalMin)}M OVER` : `${Math.round(elapsed)}M PLAYING`,
        });
        if (inRange(m.court_number)) free[m.court_number - 1] = Math.max(free[m.court_number - 1], end);
        holdTeams(m, end);
        endOf.set(m.id, end);
      } else if (m.status === "pending" && !m.confirmed && m.is_bye) {
        // A bye needs no court.
        const start = Math.max(now, ev.start);
        const deltaMin = (start - now) / MIN;
        slots.set(m.id, { projected_start_at: new Date(start).toISOString(), delta_min: deltaMin, delta_label: "BYE" });
      } else if (isQueued(m)) {
        if (!isCalled(m)) ev.rest.push(m);
      } else {
        slots.set(m.id, { projected_start_at: m.scheduled_at, delta_min: null, delta_label: m.is_bye ? "BYE" : "" });
      }
    }
  }

  const place = (m: Match, ev: EventInfo, court: number, start: number) => {
    const end = start + ev.matchMin * MIN;
    const deltaMin = (start - now) / MIN;
    slots.set(m.id, { projected_start_at: new Date(start).toISOString(), delta_min: deltaMin, delta_label: pendingLabel(m, deltaMin) });
    free[court] = end;
    holdTeams(m, end);
    endOf.set(m.id, end);
  };

  // Pass 2: called matches start on the court they were given, in call order.
  const called = events
    .flatMap(ev => (sortedByCat.get(ev.cat.id) ?? []).filter(isCalled).map(m => ({ m, ev })))
    .sort((x, y) => (parseT(x.m.court_allocated_at) ?? 0) - (parseT(y.m.court_allocated_at) ?? 0));
  for (const { m, ev } of called) {
    const court = m.court_number! - 1;
    const teamsReady = [m.team_a_id, m.team_b_id].reduce((t, id) => Math.max(t, id ? teamFree.get(id) ?? -Infinity : -Infinity), -Infinity);
    place(m, ev, court, Math.max(now, free[court], teamsReady));
    ev.last = Math.max(ev.last, parseT(m.court_allocated_at) ?? now);
  }

  // Pass 3: everything still queued, one court at a time.
  const feeders = new Map<string, Match[]>();
  for (const ev of events) {
    const all = sortedByCat.get(ev.cat.id) ?? [];
    for (const m of ev.rest) feeders.set(m.id, feedersOf(m, all));
  }
  const unplaced = new Set(events.flatMap(ev => ev.rest.map(m => m.id)));
  const readyAt = (m: Match, ev: EventInfo): number => {
    let r = ev.start;
    for (const t of [m.team_a_id, m.team_b_id]) if (t) r = Math.max(r, teamFree.get(t) ?? -Infinity);
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
    const start = Math.max(at, readyAt(m, best.ev));
    unplaced.delete(m.id);
    place(m, best.ev, court, start);
    best.ev.last = Math.max(best.ev.last, start);
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
  return { projected, byId, tournamentDeltaMin, tournamentDeltaLabel: fmtDelta(tournamentDeltaMin), liveByCourt };
}
