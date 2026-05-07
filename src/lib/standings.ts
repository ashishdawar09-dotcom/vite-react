// Pure standings calculation extracted from App.tsx so it can be unit-tested.
// Inputs: completed group matches + the team list. Output: ranked rows.

export type StandingsMatch = {
  team_a_id: string | null;
  team_b_id: string | null;
  score_a: number | null;
  score_b: number | null;
  winner_id: string | null;
  confirmed: boolean | null;
  is_bye: boolean | null;
};

export type StandingsTeam = { id: string };

export type StandingsRow<T extends StandingsTeam = StandingsTeam> = {
  team: T;
  w: number;
  l: number;
  pts: number;
  pf: number; // points for
  pa: number; // points against
};

/**
 * Compute group standings.
 * - 3 points per win, 0 for loss.
 * - Ties broken by point differential (pf - pa), then points-for.
 */
export function computeStandings<T extends StandingsTeam>(
  teams: T[],
  matches: StandingsMatch[]
): StandingsRow<T>[] {
  const rows = new Map<string, StandingsRow<T>>();
  for (const t of teams) {
    rows.set(t.id, { team: t, w: 0, l: 0, pts: 0, pf: 0, pa: 0 });
  }
  for (const m of matches) {
    if (!m.confirmed || m.is_bye) continue;
    if (!m.team_a_id || !m.team_b_id) continue;
    const a = rows.get(m.team_a_id);
    const b = rows.get(m.team_b_id);
    if (!a || !b) continue;
    const sa = m.score_a ?? 0;
    const sb = m.score_b ?? 0;
    a.pf += sa; a.pa += sb;
    b.pf += sb; b.pa += sa;
    if (m.winner_id === m.team_a_id) { a.w++; b.l++; a.pts += 3; }
    else if (m.winner_id === m.team_b_id) { b.w++; a.l++; b.pts += 3; }
  }
  return [...rows.values()].sort((a, b) =>
    b.pts - a.pts ||
    (b.pf - b.pa) - (a.pf - a.pa) ||
    b.pf - a.pf
  );
}
