import type { Category, Player, Team } from "../types";

/**
 * Doubles categories each active player still needs a partner in: categories
 * with team_size 2 that the player is registered for, where no team in that
 * category contains them. Singles categories never appear — singles players
 * are entered on their own when the group stage starts, not paired.
 *
 * Only players with at least one such category are in the returned map.
 */
export function partnerNeeds(
  players: Pick<Player, "id" | "active">[],
  playerCategoryMap: Map<string, Set<string>>,
  categories: Pick<Category, "id" | "team_size">[],
  teams: Pick<Team, "category_id" | "p1_id" | "p2_id">[],
): Map<string, string[]> {
  const doubles = categories.filter(c => c.team_size === 2).map(c => c.id);
  const onTeam = new Set<string>(); // `${categoryId}|${playerId}`
  for (const t of teams) {
    onTeam.add(`${t.category_id}|${t.p1_id}`);
    if (t.p2_id) onTeam.add(`${t.category_id}|${t.p2_id}`);
  }
  const needs = new Map<string, string[]>();
  for (const p of players) {
    if (!p.active) continue;
    const cats = playerCategoryMap.get(p.id);
    if (!cats) continue;
    const missing = doubles.filter(cid => cats.has(cid) && !onTeam.has(`${cid}|${p.id}`));
    if (missing.length > 0) needs.set(p.id, missing);
  }
  return needs;
}

/**
 * Who goes into a singles draw. Every entrant gets exactly one solo team:
 * players who already have one in this category keep it, the rest are
 * returned in `toCreate`. Teams belonging to non-entrants (e.g. a player
 * since removed from the category) are left out of the draw.
 */
export function planSinglesDraw<T extends Pick<Team, "id" | "p1_id" | "p2_id">>(
  entrantIds: string[],
  teamsInCategory: T[],
): { existing: T[]; toCreate: string[] } {
  const soloByPlayer = new Map<string, T>();
  for (const t of teamsInCategory) {
    if (t.p2_id === null && !soloByPlayer.has(t.p1_id)) soloByPlayer.set(t.p1_id, t);
  }
  const existing: T[] = [];
  const toCreate: string[] = [];
  for (const pid of new Set(entrantIds)) {
    const t = soloByPlayer.get(pid);
    if (t) existing.push(t); else toCreate.push(pid);
  }
  return { existing, toCreate };
}
