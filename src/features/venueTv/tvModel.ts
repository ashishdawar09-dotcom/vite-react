// Turns one live snapshot into what the venue TV shows: who is on each
// court, the venue wide queue with estimated times, results, groups,
// brackets, champions, players and the desk's announcements.
//
// Pure functions only, so they can be tested without a browser.

import type { Category, Match, Player, ProjectedMatch, Team, Tournament } from "../../types";
import { buildGroups, groupLetter, groupStandings, isRoundRobinOnly, roundRobinPodium } from "../../lib/groups";
import { isCancelledMatch } from "../../lib/matchOutcome";

const MIN = 60_000;
/** A finished match stays on its court as "Final score" this long, unless the next match is called there first. */
export const FINAL_SCORE_HOLD_MS = 20_000;
/** Courts the TV layouts are drawn for. */
export const MAX_TV_COURTS = 8;
/** Changeover between two matches on the same court. */
const CHANGEOVER_MIN = 2;
/** Time from the call to the first serve: the rules allow 10 minutes to arrive plus a 3 minute warm up; most players are quicker. */
const CALL_TO_START_MIN = 5;

export type TvStatus = "queued" | "called" | "live" | "done";
export type TvKind = "group" | "round" | "qf" | "sf" | "final" | "bronze";

export type TvTeam = { id: string; category_id: string; names: string[] };

export type TvMatch = {
  id: string;
  cat: string;
  kind: TvKind;
  /** "Group A", "Round robin", "Quarterfinal 2", "Semifinal 1", "Final", "Bronze match", "Round 1". */
  label: string;
  groupIdx: number | null;
  roundIdx: number | null;
  slot: number;
  /** Semifinals and finals are best of 3 under the tournament rules. */
  bestOf3: boolean;
  a: string | null;
  b: string | null;
  cur: [number, number];
  status: TvStatus;
  /** Just finished and still shown on its court. */
  ending: boolean;
  court: number | null;
  calledAt: number | null;
  startedAt: number | null;
  doneAt: number | null;
  winner: string | null;
  walkover: boolean;
  cancelled: boolean;
  /** Estimated start, venue wide, for queued matches. */
  eta: number | null;
};

export type TvGroup = { idx: number; letter: string; teamIds: string[] };

export type TvCategory = {
  id: string;
  name: string;
  short: string;
  order: number;
  teamSize: 1 | 2;
  groups: TvGroup[];
  /** Places per group that go through to the knockout (0 = round robin only or unknown). */
  advance: number;
  roundRobinOnly: boolean;
  hasKnockout: boolean;
  finished: boolean;
  champion: string | null;
  runnerUp: string | null;
  /** Games or points of the final, winner first, when there was one. */
  finalScore: [number, number] | null;
};

export type TvMessage = { id: string; text: string; style: "line" | "full"; postedAt: number; until: number | null };

export type TvPlayer = { name: string; teamIds: string[] };

export type TvStanding = { teamId: string; played: number; won: number; diff: number; pts: number };

export type TvModel = {
  tournament: { id: string; name: string; slug: string; numCourts: number; venue: string | null };
  now: number;
  generatedAt: number | null;
  categories: TvCategory[];
  catById: Record<string, TvCategory>;
  teams: Record<string, TvTeam>;
  matches: TvMatch[];
  byId: Record<string, TvMatch>;
  /** Index 0 is court 1. */
  courts: (TvMatch | null)[];
  /** Queued matches with both sides known, in the order they should be called. */
  queue: TvMatch[];
  /** Finished matches with a winner, newest first. */
  results: TvMatch[];
  players: TvPlayer[];
  messages: TvMessage[];
  played: number;
  total: number;
  /** Estimated end of the last match, when anything is still to play. */
  finish: number | null;
  /** Raw group matches, for the shared standings rule. */
  groupMatches: Match[];
};

export type TvSnapshot = {
  tournament: (Tournament & { tv_messages?: unknown }) | null;
  players: Player[];
  teams: Team[];
  matches: Match[];
  categories: Category[];
  generated_at?: number | null;
};

const parseT = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = new Date(s).getTime();
  return Number.isFinite(n) ? n : null;
};

/** "Men's Doubles 35+" → "Men's 35+", "Youth Boys' Singles" → "Youth Boys'", "Super Doubles 50+" → "Super 50+". */
export function shortCategoryName(name: string): string {
  const n = name.trim();
  let m = /^(Men['’]s|Women['’]s|Mixed)\s+Doubles\s+(.+)$/i.exec(n);
  if (m) return `${m[1]} ${m[2]}`;
  m = /^Super\s+Doubles\s+(.+)$/i.exec(n);
  if (m) return `Super ${m[1]}`;
  m = /^Youth\s+(Boys['’]?|Girls['’]?)\s+Singles$/i.exec(n);
  if (m) return `Youth ${m[1]}`;
  return n;
}

/** Desk announcements as stored on the tournament row, keeping only valid, current ones. */
export function parseMessages(raw: unknown, now: number): TvMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: TvMessage[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    const id = typeof o.id === "string" ? o.id : "";
    if (!text || !id) continue;
    const postedAt = parseT(typeof o.posted_at === "string" ? o.posted_at : null) ?? now;
    const until = typeof o.until === "string" ? parseT(o.until) : null;
    if (until != null && until <= now) continue;
    out.push({ id, text: text.slice(0, 160), style: o.style === "full" ? "full" : "line", postedAt, until });
  }
  return out.sort((x, y) => y.postedAt - x.postedAt);
}

function kindOf(m: Match, lastRound: number, groupsInCat: number): { kind: TvKind; label: string } {
  if (m.stage === "group") {
    return { kind: "group", label: groupsInCat > 1 ? `Group ${groupLetter(m.group_idx ?? 0)}` : "Round robin" };
  }
  if (m.is_bronze) return { kind: "bronze", label: "Bronze match" };
  const fromFinal = lastRound - (m.round_idx ?? 0);
  if (fromFinal <= 0) return { kind: "final", label: "Final" };
  if (fromFinal === 1) return { kind: "sf", label: `Semifinal ${m.slot_idx + 1}` };
  if (fromFinal === 2) return { kind: "qf", label: `Quarterfinal ${m.slot_idx + 1}` };
  return { kind: "round", label: `Round ${(m.round_idx ?? 0) + 1} · ${m.slot_idx + 1}` };
}

/** Status the TV uses. A court call (court_number with court_allocated_at) on a pending match is "called". */
export function tvStatus(m: Pick<Match, "status" | "confirmed" | "court_number" | "court_allocated_at">): TvStatus {
  if (m.confirmed || m.status === "completed") return "done";
  if (m.status === "live") return "live";
  if (m.court_number != null && m.court_allocated_at) return "called";
  return "queued";
}

type Projections = Record<string, Pick<ProjectedMatch, "projected_start_at">> | undefined;

/** How far down the queue the desk looks for a match whose players are all free. */
const LOOKAHEAD = 8;

/**
 * Venue wide estimate, the way the desk works: whichever court frees first
 * takes the next match in the queue whose players are all free (someone
 * still on another court can't start). The app's own projection treats each
 * category as if it had every court, so it only decides the order the desk
 * works through; the times come from here. Returns the queue in the order
 * the matches should start.
 */
export function projectQueue(
  queued: TvMatch[],
  courts: (TvMatch | null)[],
  now: number,
  minutesOf: (m: TvMatch) => number,
  playersOf: (m: TvMatch) => string[] = () => [],
): { order: TvMatch[]; finish: number | null } {
  const free = courts.map(m => {
    if (!m || m.status === "done") return now;
    const dur = minutesOf(m) * MIN;
    if (m.status === "live") return Math.max(now + MIN, (m.startedAt ?? now) + dur);
    if (m.status === "called") return Math.max(now + MIN, (m.calledAt ?? now) + CALL_TO_START_MIN * MIN + dur);
    return now;
  });
  // Players on court are free when their match ends.
  const busy = new Map<string, number>();
  courts.forEach((m, i) => { if (m && m.status !== "done") for (const p of playersOf(m)) busy.set(p, Math.max(busy.get(p) ?? 0, free[i])); });
  for (let i = 0; i < free.length; i++) free[i] += CHANGEOVER_MIN * MIN;
  if (!free.length) free.push(now);
  const ready = (m: TvMatch) => playersOf(m).reduce((t, p) => Math.max(t, busy.get(p) ?? 0), now);

  const waiting = [...queued], order: TvMatch[] = [];
  while (waiting.length) {
    let k = 0;
    for (let i = 1; i < free.length; i++) if (free[i] < free[k]) k = i;
    let pick = 0, start = Infinity;
    for (let i = 0; i < Math.min(LOOKAHEAD, waiting.length); i++) {
      const s = Math.max(free[k], ready(waiting[i]));
      if (s < start - 1000) { start = s; pick = i; }
    }
    const m = waiting.splice(pick, 1)[0];
    m.eta = start;
    const end = start + minutesOf(m) * MIN;
    free[k] = end + CHANGEOVER_MIN * MIN;
    for (const p of playersOf(m)) busy.set(p, end);
    order.push(m);
  }
  order.sort((x, y) => (x.eta ?? 0) - (y.eta ?? 0));
  const anything = courts.some(m => m && m.status !== "done") || queued.length > 0;
  return { order, finish: anything ? Math.max(...free) - CHANGEOVER_MIN * MIN : null };
}

export function buildTvModel(snap: TvSnapshot, now: number, projections?: Projections): TvModel | null {
  const t = snap.tournament;
  if (!t) return null;
  const numCourts = Math.max(1, Math.min(MAX_TV_COURTS, t.num_courts || 1));
  const players = new Map(snap.players.map(p => [p.id, p]));

  const categoriesRaw = [...snap.categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const catRaw = new Map(categoriesRaw.map(c => [c.id, c]));

  const teams: Record<string, TvTeam> = {};
  // Player ids per team, so a player in two events is never on two courts at once in the estimates.
  const snapTeamPlayers = new Map(snap.teams.map(tm => [tm.id, [tm.p1_id, tm.p2_id].filter((x): x is string => !!x)]));
  for (const tm of snap.teams) {
    const names = [tm.p1_id, tm.p2_id].filter((x): x is string => !!x).map(id => players.get(id)?.name?.trim()).filter((x): x is string => !!x);
    teams[tm.id] = { id: tm.id, category_id: tm.category_id, names: names.length ? names : [tm.name || "To be decided"] };
  }

  const real = snap.matches.filter(m => !m.is_bye && catRaw.has(m.category_id));
  const lastRound = new Map<string, number>();
  for (const m of real) if (m.stage === "knockout" && !m.is_bronze) lastRound.set(m.category_id, Math.max(lastRound.get(m.category_id) ?? 0, m.round_idx ?? 0));
  const groupsInCat = new Map<string, number>();
  for (const m of real) if (m.stage === "group") groupsInCat.set(m.category_id, Math.max(groupsInCat.get(m.category_id) ?? 0, (m.group_idx ?? 0) + 1));

  const matches: TvMatch[] = real.map(m => {
    const { kind, label } = kindOf(m, lastRound.get(m.category_id) ?? 0, groupsInCat.get(m.category_id) ?? 1);
    const status = tvStatus(m);
    const cancelled = isCancelledMatch(m);
    return {
      id: m.id,
      cat: m.category_id,
      kind,
      label,
      groupIdx: m.group_idx,
      roundIdx: m.round_idx,
      slot: m.slot_idx,
      bestOf3: kind === "sf" || kind === "final",
      a: m.team_a_id && teams[m.team_a_id] ? m.team_a_id : null,
      b: m.team_b_id && teams[m.team_b_id] ? m.team_b_id : null,
      cur: [m.score_a ?? 0, m.score_b ?? 0],
      status,
      ending: false,
      court: m.court_number != null && m.court_number >= 1 && m.court_number <= numCourts ? m.court_number : null,
      calledAt: parseT(m.court_allocated_at),
      startedAt: parseT(m.started_at),
      doneAt: parseT(m.confirmed_at),
      winner: m.winner_id && teams[m.winner_id] ? m.winner_id : null,
      walkover: !!m.is_walkover && !cancelled,
      cancelled,
      eta: null,
    };
  });
  const byId: Record<string, TvMatch> = Object.fromEntries(matches.map(m => [m.id, m]));

  // Who is on each court: playing first, then called, then a match that has just finished there.
  const courts: (TvMatch | null)[] = Array.from({ length: numCourts }, () => null);
  const rank = (m: TvMatch) => (m.status === "live" ? 3 : m.status === "called" ? 2 : 1);
  for (const m of matches) {
    if (m.court == null) continue;
    let candidate = m.status === "live" || m.status === "called";
    if (m.status === "done" && !m.cancelled && !m.walkover && m.doneAt != null && now - m.doneAt < FINAL_SCORE_HOLD_MS && now - m.doneAt >= -FINAL_SCORE_HOLD_MS) candidate = true;
    if (!candidate) continue;
    const cur = courts[m.court - 1];
    if (!cur || rank(m) > rank(cur) || (rank(m) === rank(cur) && (m.calledAt ?? m.startedAt ?? m.doneAt ?? 0) > (cur.calledAt ?? cur.startedAt ?? cur.doneAt ?? 0))) {
      courts[m.court - 1] = m;
    }
  }
  for (const m of courts) if (m && m.status === "done") m.ending = true;

  // Queue: matches waiting for a court, in the order the app projects them
  // (group stage before knockout within a category, admin's queue order).
  const rawById = new Map(snap.matches.map(m => [m.id, m]));
  const orderKey = new Map<string, number[]>();
  for (const m of matches) {
    const p = parseT(projections?.[m.id]?.projected_start_at ?? null);
    const raw = rawById.get(m.id);
    orderKey.set(m.id, [
      p ?? Number.MAX_SAFE_INTEGER,
      catRaw.get(m.cat)?.sort_order ?? 0,
      m.kind === "group" ? 0 : 1,
      m.groupIdx ?? m.roundIdx ?? 0,
      raw?.queue_position ?? m.slot,
    ]);
  }
  const cmp = (x: TvMatch, y: TvMatch) => {
    const a = orderKey.get(x.id)!, b = orderKey.get(y.id)!;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return x.id.localeCompare(y.id);
  };
  const waiting = matches.filter(m => m.status === "queued" && !m.cancelled).sort(cmp);
  const known = waiting.filter(m => m.a && m.b);
  const later = waiting.filter(m => !(m.a && m.b));
  const minutesOf = (m: TvMatch) => {
    const base = catRaw.get(m.cat)?.match_minutes || 12;
    const extra = rawById.get(m.id)?.extended_minutes ?? 0;
    return (m.bestOf3 ? base * 2 : base) + (m.status === "live" ? extra : 0);
  };
  const playersOf = (m: TvMatch) => [m.a, m.b].flatMap(id => (id ? snapTeamPlayers.get(id) ?? [] : []));
  const { order: started, finish } = projectQueue([...known, ...later], courts, now, minutesOf, playersOf);
  const queue = started.filter(m => m.a && m.b);

  const results = matches.filter(m => m.status === "done" && m.winner && !m.cancelled).sort((x, y) => (y.doneAt ?? 0) - (x.doneAt ?? 0));

  // Groups, using the same grouping and ranking as the admin screens.
  const groupMatches = snap.matches.filter(m => m.stage === "group" && catRaw.has(m.category_id));
  const allGroups = buildGroups(groupMatches, teams, categoriesRaw.map(c => c.id));
  const categories: TvCategory[] = categoriesRaw.map((c, i) => {
    const groups: TvGroup[] = allGroups
      .filter(g => g[0]?.category_id === c.id)
      .map(g => {
        const gm = groupMatches.find(m => m.category_id === c.id && m.group_idx != null && (g.some(x => x.id === m.team_a_id) || g.some(x => x.id === m.team_b_id)));
        const idx = gm?.group_idx ?? 0;
        return { idx, letter: groupLetter(idx), teamIds: g.map(x => x.id) };
      })
      .sort((x, y) => x.idx - y.idx);
    const ko = matches.filter(m => m.cat === c.id && m.kind !== "group");
    const fin = ko.find(m => m.kind === "final") ?? null;
    let champion: string | null = null, runnerUp: string | null = null, finalScore: [number, number] | null = null;
    if (fin && fin.status === "done" && fin.winner) {
      champion = fin.winner;
      runnerUp = fin.winner === fin.a ? fin.b : fin.a;
      finalScore = fin.winner === fin.a ? [fin.cur[0], fin.cur[1]] : [fin.cur[1], fin.cur[0]];
    } else if (isRoundRobinOnly(c) && groups.length === 1) {
      const podium = roundRobinPodium(groups[0].teamIds.map(id => teams[id]).filter(Boolean), groupMatches.filter(m => m.category_id === c.id));
      if (podium?.first) { champion = podium.first.id; runnerUp = podium.second?.id ?? null; }
    }
    return {
      id: c.id,
      name: c.name,
      short: shortCategoryName(c.name),
      order: i,
      teamSize: c.team_size,
      groups,
      advance: c.top_n_advance || 0,
      roundRobinOnly: isRoundRobinOnly(c),
      hasKnockout: ko.length > 0,
      finished: !!champion,
      champion,
      runnerUp,
      finalScore,
    };
  });
  const catById: Record<string, TvCategory> = Object.fromEntries(categories.map(c => [c.id, c]));

  // Players A to Z, each with their teams.
  const pmap = new Map<string, string[]>();
  for (const tm of Object.values(teams)) {
    if (!catById[tm.category_id]) continue;
    for (const n of tm.names) {
      if (!pmap.has(n)) pmap.set(n, []);
      pmap.get(n)!.push(tm.id);
    }
  }
  const playerList: TvPlayer[] = [...pmap.entries()].map(([name, teamIds]) => ({ name, teamIds })).sort((a, b) => a.name.localeCompare(b.name));

  const played = matches.filter(m => m.status === "done" && !m.cancelled).length;
  const generatedAt = typeof snap.generated_at === "number" && Number.isFinite(snap.generated_at) ? snap.generated_at * 1000 : null;

  return {
    tournament: { id: t.id, name: t.name, slug: t.slug, numCourts, venue: t.venue_name ?? null },
    now,
    generatedAt,
    categories,
    catById,
    teams,
    matches,
    byId,
    courts,
    queue,
    results,
    players: playerList,
    messages: parseMessages(t.tv_messages, now),
    played,
    total: matches.filter(m => !m.cancelled).length,
    finish,
    groupMatches,
  };
}

/** Standings of one group, ranked by the same rule as the Groups tab (coin tosses are only on the admin's device, so a tie stays in table order). */
export function standingsOf(model: TvModel, catId: string, groupIdx: number): TvStanding[] {
  const cat = model.catById[catId];
  const g = cat?.groups.find(x => x.idx === groupIdx);
  if (!g) return [];
  const teams = g.teamIds.map(id => model.teams[id]).filter(Boolean);
  return groupStandings(teams, model.groupMatches.filter(m => m.category_id === catId)).map(s => ({
    teamId: s.team.id,
    played: s.w + s.l,
    won: s.w,
    diff: s.pf - s.pa,
    pts: s.pts,
  }));
}

/** Knockout rounds of a category, first round first; the bronze match sits with the final. */
export function bracketOf(model: TvModel, catId: string): { title: string; matches: TvMatch[] }[] {
  const ko = model.matches.filter(m => m.cat === catId && m.kind !== "group");
  if (!ko.length) return [];
  const rounds = new Map<number, TvMatch[]>();
  for (const m of ko) {
    const r = m.roundIdx ?? 0;
    if (!rounds.has(r)) rounds.set(r, []);
    rounds.get(r)!.push(m);
  }
  return [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([, ms]) => {
    ms.sort((x, y) => (x.kind === "bronze" ? 1 : 0) - (y.kind === "bronze" ? 1 : 0) || x.slot - y.slot);
    const k = ms.find(m => m.kind !== "bronze")?.kind ?? "final";
    const title = k === "final" ? "Final" : k === "sf" ? "Semifinals" : k === "qf" ? "Quarterfinals" : `Round ${(ms[0].roundIdx ?? 0) + 1}`;
    return { title, matches: ms };
  });
}
