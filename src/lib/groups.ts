// Group-stage groups and their standings, shared by the admin screens and
// the public pages.
//
// group_idx restarts at 0 in every category, so a group is the pair
// (category_id, group_idx). Keying on group_idx alone merged every
// category's Group A into one table on /t/:slug.
//
// A group's matches are the group-stage matches between its own teams, so
// standings never need the group_idx/array-index pairing that callers pass.

import { isCancelledMatch } from "./matchOutcome";

type GroupTeam = { id: string; category_id: string };
type GroupMatch = {
  category_id: string;
  group_idx: number | null;
  team_a_id: string | null;
  team_b_id: string | null;
  score_a: number | null;
  score_b: number | null;
  winner_id: string | null;
  confirmed: boolean;
  is_bye: boolean;
};

export type GroupStanding<T> = { team: T; w: number; l: number; pts: number; pf: number; pa: number };

/**
 * Teams per group, ordered by `categoryOrder` (unknown categories last),
 * then group_idx. Within a group, teams keep the order they first appear in
 * `groupMatches` (as the admin screen always did).
 */
export function buildGroups<T extends GroupTeam>(
  groupMatches: GroupMatch[],
  teamById: Record<string, T | undefined>,
  categoryOrder: string[],
): T[][] {
  const byKey = new Map<string, { category_id: string; group_idx: number; ids: Set<string> }>();
  for (const m of groupMatches) {
    if (m.group_idx == null) continue;
    const key = `${m.category_id}|${m.group_idx}`;
    let g = byKey.get(key);
    if (!g) { g = { category_id: m.category_id, group_idx: m.group_idx, ids: new Set() }; byKey.set(key, g); }
    if (m.team_a_id) g.ids.add(m.team_a_id);
    if (m.team_b_id) g.ids.add(m.team_b_id);
  }
  const rank = (cid: string) => { const i = categoryOrder.indexOf(cid); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return [...byKey.values()]
    .sort((a, b) => rank(a.category_id) - rank(b.category_id) || a.category_id.localeCompare(b.category_id) || a.group_idx - b.group_idx)
    .map(g => [...g.ids].map(id => teamById[id]).filter((t): t is T => !!t))
    .filter(g => g.length > 0);
}

function inGroup(ids: Set<string>, m: GroupMatch): boolean {
  return !!m.team_a_id && !!m.team_b_id && ids.has(m.team_a_id) && ids.has(m.team_b_id);
}

/** Category and group_idx of a group, from any of its matches. */
export function groupKeyOf(group: GroupTeam[], groupMatches: GroupMatch[]): { category_id: string; group_idx: number } | null {
  const ids = new Set(group.map(t => t.id));
  const m = groupMatches.find(x => x.group_idx != null && inGroup(ids, x));
  return m ? { category_id: m.category_id, group_idx: m.group_idx! } : null;
}

/** "Group A" for group_idx 0. */
export function groupLetter(group_idx: number): string {
  return String.fromCharCode(65 + group_idx);
}

/**
 * Teams that finished level on wins and point difference, and how the rule
 * placed them. "head-to-head": the matches between them decided it. "coin
 * toss": they're still level, so the directors toss a coin; until a result
 * is recorded they stay in draw order.
 */
export type GroupTie<T> = {
  /** The level teams, in the order the table shows them. */
  teams: T[];
  /** The places they take, 1-based: first and last. */
  places: [number, number];
  decidedBy: "head-to-head" | "coin toss";
  /** Coin toss only: the toss result has been recorded (on this device). */
  tossed: boolean;
};

const diff = (s: { pf: number; pa: number }) => s.pf - s.pa;

/**
 * Order teams level on wins and point difference by the matches between
 * them (a mini-table of wins), again within any that stay level. Teams the
 * matches can't separate are returned as `level`, in draw order.
 */
function headToHead<S extends { team: GroupTeam }>(tied: S[], played: GroupMatch[]): { order: S[]; level: S[][] } {
  const ids = new Set(tied.map(x => x.team.id));
  const wins = new Map(tied.map(x => [x.team.id, 0]));
  for (const m of played) {
    if (!m.team_a_id || !m.team_b_id || !ids.has(m.team_a_id) || !ids.has(m.team_b_id)) continue;
    if (m.winner_id && wins.has(m.winner_id)) wins.set(m.winner_id, wins.get(m.winner_id)! + 1);
  }
  const sorted = [...tied].sort((x, y) => wins.get(y.team.id)! - wins.get(x.team.id)!);
  const order: S[] = [];
  const level: S[][] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && wins.get(sorted[j].team.id) === wins.get(sorted[i].team.id)) j++;
    const sub = sorted.slice(i, j);
    if (sub.length === 1) order.push(sub[0]);
    else if (sub.length === tied.length) { order.push(...sub); level.push(sub); }
    else { const r = headToHead(sub, played); order.push(...r.order); level.push(...r.level); }
    i = j;
  }
  return { order, level };
}

/**
 * Standings and ties for one group. The rule (QA review, Nov 4): 3 points
 * per win; then point difference; then head-to-head between the teams still
 * level; then a coin toss. `tossWinners` = team ids in the order they won
 * their coin tosses; it only reorders teams still level after head-to-head.
 * Cancelled matches count for nothing.
 */
function rankGroup<T extends GroupTeam>(group: T[], groupMatches: GroupMatch[], tossWinners: string[] = []) {
  const ids = new Set(group.map(t => t.id));
  const played = groupMatches.filter(m => m.confirmed && !m.is_bye && !isCancelledMatch(m) && inGroup(ids, m));
  const s: Record<string, GroupStanding<T>> = {};
  group.forEach(t => { s[t.id] = { team: t, w: 0, l: 0, pts: 0, pf: 0, pa: 0 }; });
  for (const m of played) {
    const a = s[m.team_a_id!], b = s[m.team_b_id!];
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    a.pf += sa; a.pa += sb;
    b.pf += sb; b.pa += sa;
    if (m.winner_id === m.team_a_id) { a.w++; a.pts += 3; b.l++; }
    else if (m.winner_id === m.team_b_id) { b.w++; b.pts += 3; a.l++; }
  }
  // Stable sort: teams still level keep draw order (the order they first
  // appear in the group's matches).
  const base = Object.values(s).sort((x, y) => y.pts - x.pts || diff(y) - diff(x));
  const standings: GroupStanding<T>[] = [];
  const ties: GroupTie<T>[] = [];
  const tossRank = (id: string) => { const i = tossWinners.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  for (let i = 0; i < base.length;) {
    let j = i + 1;
    while (j < base.length && base[j].pts === base[i].pts && diff(base[j]) === diff(base[i])) j++;
    const level = base.slice(i, j);
    i = j;
    if (level.length === 1) { standings.push(level[0]); continue; }
    const first = standings.length + 1;
    const h2h = headToHead(level, played);
    // Toss winners go first within each set head-to-head couldn't split.
    const order = [...h2h.order];
    for (const set of h2h.level) {
      const at = order.indexOf(set[0]);
      const tossed = [...set].sort((x, y) => tossRank(x.team.id) - tossRank(y.team.id));
      order.splice(at, set.length, ...tossed);
    }
    standings.push(...order);
    if (h2h.level.length === 0) {
      ties.push({ teams: order.map(x => x.team), places: [first, first + order.length - 1], decidedBy: "head-to-head", tossed: false });
    }
    for (const set of h2h.level) {
      const at = order.findIndex(x => set.includes(x));
      const teams = order.slice(at, at + set.length).map(x => x.team);
      const decided = teams.filter(t => tossWinners.includes(t.id)).length >= teams.length - 1;
      ties.push({ teams, places: [first + at, first + at + set.length - 1], decidedBy: "coin toss", tossed: decided });
    }
  }
  return { standings, ties };
}

/** Standings for one group, ranked by the rule in `rankGroup`. */
export function groupStandings<T extends GroupTeam>(group: T[], groupMatches: GroupMatch[], tossWinners: string[] = []): GroupStanding<T>[] {
  return rankGroup(group, groupMatches, tossWinners).standings;
}

/** Ties in a group's table and how they were decided (see `GroupTie`). */
export function groupTies<T extends GroupTeam>(group: T[], groupMatches: GroupMatch[], tossWinners: string[] = []): GroupTie<T>[] {
  return rankGroup(group, groupMatches, tossWinners).ties;
}

/** Every match in this one group is confirmed. */
export function groupComplete(group: GroupTeam[], groupMatches: GroupMatch[]): boolean {
  const ids = new Set(group.map(t => t.id));
  const ms = groupMatches.filter(m => inGroup(ids, m));
  return ms.length > 0 && ms.every(m => m.confirmed);
}

/** An event played as one group with no knockout: the group winner is the champion. */
export function isRoundRobinOnly(c: { groups_count: number | null; top_n_advance: number | null } | null | undefined): boolean {
  return !!c && c.groups_count === 1 && (c.top_n_advance ?? 0) === 0;
}

/**
 * Final places of a round-robin-only event once every match is confirmed;
 * null before that. A place still waiting on a coin toss is null, and the
 * toss is listed in `openTosses`.
 */
export function roundRobinPodium<T extends GroupTeam>(group: T[], groupMatches: GroupMatch[], tossWinners: string[] = []):
  { first: T | null; second: T | null; third: T | null; openTosses: GroupTie<T>[] } | null {
  if (!groupComplete(group, groupMatches)) return null;
  const { standings, ties } = rankGroup(group, groupMatches, tossWinners);
  const openTosses = ties.filter(t => t.decidedBy === "coin toss" && !t.tossed);
  const at = (place: number) => {
    if (openTosses.some(t => t.places[0] <= place && place <= t.places[1])) return null;
    return standings[place - 1]?.team ?? null;
  };
  return { first: at(1), second: at(2), third: at(3), openTosses };
}

/** Every group has matches and all of them are confirmed. */
export function groupsAllConfirmed(groups: GroupTeam[][], groupMatches: GroupMatch[]): boolean {
  return groups.length > 0 && groups.every(g => {
    const ids = new Set(g.map(t => t.id));
    const ms = groupMatches.filter(m => inGroup(ids, m));
    return ms.length > 0 && ms.every(m => m.confirmed);
  });
}
