import type { Category, Match, Player, Team } from "../../types";
import { buildGroups, groupStandings } from "../../lib/groups";

export type TeamView = Team & { p1: Player; p2: Player | null };

export type Standing = {
  team: TeamView;
  w: number;
  l: number;
  pts: number;
  pf: number;
  pa: number;
};

/**
 * Mirror of the derived collections App.tsx builds from raw tournament data,
 * extracted into a pure helper so the public spectator pages can reuse them
 * without depending on the admin shell. Kept minimal — only what LiveTab,
 * the venue TV hero, and the results page need.
 *
 * NOTE: When App.tsx is one day refactored into `useTournamentDerived`, this
 * helper and that hook should be unified. For now this is the public-only
 * copy — duplication is intentional to avoid risky changes to App.tsx.
 */
export function derivePublicTournamentState(
  players: Player[],
  teams: Team[],
  matches: Match[],
  categories: Category[],
) {
  const playerById = Object.fromEntries(players.map(p => [p.id, p]));

  // All teams (across categories) with embedded p1/p2 player objects.
  const teamsView: TeamView[] = teams
    .map(t => {
      const p1 = playerById[t.p1_id];
      const p2 = t.p2_id ? playerById[t.p2_id] : null;
      return { ...t, p1, p2 } as TeamView;
    })
    .filter(t => t.p1);

  const allTeamById: Record<string, TeamView | undefined> =
    Object.fromEntries(teamsView.map(t => [t.id, t]));

  // Sorted match slices — same tie-break on id so cards don't swap positions
  // between snapshot polls.
  const groupMatches = matches
    .filter(m => m.stage === "group")
    .sort((a, b) =>
      ((a.group_idx ?? 0) - (b.group_idx ?? 0)) ||
      (a.slot_idx - b.slot_idx) ||
      a.id.localeCompare(b.id),
    );

  const knockoutMatches = matches
    .filter(m => m.stage === "knockout")
    .sort((a, b) =>
      ((a.round_idx ?? 0) - (b.round_idx ?? 0)) ||
      (a.slot_idx - b.slot_idx) ||
      a.id.localeCompare(b.id),
    );

  // One group per (category, group_idx), in category order: group_idx
  // restarts at 0 in every category (lib/groups.ts).
  const categoryOrder = [...categories].sort((a, b) => a.sort_order - b.sort_order).map(c => c.id);
  const groups: TeamView[][] = buildGroups(groupMatches, allTeamById, categoryOrder);

  // Tournament-level phase — first non-none category drives the headline.
  const phase: "none" | "group" | "knockout" =
    categories.find(c => c.phase !== "none")?.phase ?? "none";

  // Per-group standings, same rule as the admin screen. The second
  // argument is ignored: the group's own matches decide its table.
  function getStandings(g: TeamView[]): Standing[] {
    return groupStandings(g, groupMatches);
  }

  return {
    playerById,
    teamsView,
    allTeamById,
    groupMatches,
    knockoutMatches,
    groups,
    phase,
    getStandings,
  };
}
