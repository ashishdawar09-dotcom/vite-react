import type { Category, Match, Player, Team } from "../../types";

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

  // Groups by group_idx — uses the set of team ids that appear in any
  // group match. Skips groups that have no teams (e.g. while a category
  // is still pre-stage).
  const groupSets = new Map<number, Set<string>>();
  groupMatches.forEach(m => {
    if (m.group_idx == null) return;
    if (!groupSets.has(m.group_idx)) groupSets.set(m.group_idx, new Set());
    if (m.team_a_id) groupSets.get(m.group_idx)!.add(m.team_a_id);
    if (m.team_b_id) groupSets.get(m.group_idx)!.add(m.team_b_id);
  });
  const groups: TeamView[][] = [...groupSets.keys()].sort((a, b) => a - b).map(gi => {
    const ids = groupSets.get(gi)!;
    return teamsView.filter(t => ids.has(t.id));
  });

  // Tournament-level phase — first non-none category drives the headline.
  const phase: "none" | "group" | "knockout" =
    categories.find(c => c.phase !== "none")?.phase ?? "none";

  // Per-group standings — same scoring rule as App.tsx (3 pts per win,
  // pf/pa tracked for diff tie-break, no points for losses).
  function getStandings(g: TeamView[], gi: number): Standing[] {
    const s: Record<string, Standing> = {};
    g.forEach(t => { s[t.id] = { team: t, w: 0, l: 0, pts: 0, pf: 0, pa: 0 }; });
    groupMatches.filter(m => m.group_idx === gi && m.confirmed).forEach(m => {
      const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
      if (m.team_a_id && s[m.team_a_id]) { s[m.team_a_id].pf += sa; s[m.team_a_id].pa += sb; }
      if (m.team_b_id && s[m.team_b_id]) { s[m.team_b_id].pf += sb; s[m.team_b_id].pa += sa; }
      if (m.winner_id && s[m.winner_id]) {
        s[m.winner_id].w++; s[m.winner_id].pts += 3;
        const loserId = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id;
        if (loserId && s[loserId]) s[loserId].l++;
      }
    });
    return Object.values(s).sort((a, b) => b.pts - a.pts || (b.pf - b.pa) - (a.pf - a.pa));
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
