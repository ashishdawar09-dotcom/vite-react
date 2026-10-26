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
 * Standings for one group: 3 points per win, ranked by points then point
 * difference (the rule knockout seeding has always used). Cancelled
 * matches count for nothing.
 */
export function groupStandings<T extends GroupTeam>(group: T[], groupMatches: GroupMatch[]): GroupStanding<T>[] {
  const ids = new Set(group.map(t => t.id));
  const s: Record<string, GroupStanding<T>> = {};
  group.forEach(t => { s[t.id] = { team: t, w: 0, l: 0, pts: 0, pf: 0, pa: 0 }; });
  for (const m of groupMatches) {
    if (!m.confirmed || m.is_bye || isCancelledMatch(m) || !inGroup(ids, m)) continue;
    const a = s[m.team_a_id!], b = s[m.team_b_id!];
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    a.pf += sa; a.pa += sb;
    b.pf += sb; b.pa += sa;
    if (m.winner_id === m.team_a_id) { a.w++; a.pts += 3; b.l++; }
    else if (m.winner_id === m.team_b_id) { b.w++; b.pts += 3; a.l++; }
  }
  return Object.values(s).sort((x, y) => y.pts - x.pts || (y.pf - y.pa) - (x.pf - x.pa));
}

/** Every group has matches and all of them are confirmed. */
export function groupsAllConfirmed(groups: GroupTeam[][], groupMatches: GroupMatch[]): boolean {
  return groups.length > 0 && groups.every(g => {
    const ids = new Set(g.map(t => t.id));
    const ms = groupMatches.filter(m => inGroup(ids, m));
    return ms.length > 0 && ms.every(m => m.confirmed);
  });
}
