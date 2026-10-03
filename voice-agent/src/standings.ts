import type { Match, Team } from "./types";

export interface StandingRow {
  team: Team;
  w: number;
  l: number;
  pts: number;
  pf: number;
  pa: number;
}

// Same ranking as the app (src/lib/standings.ts): 3 points per win, then
// point differential, then points scored. Byes and unconfirmed matches don't count.
export function computeStandings(teams: Team[], matches: Match[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
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
    a.pf += sa;
    a.pa += sb;
    b.pf += sb;
    b.pa += sa;
    if (m.winner_id === m.team_a_id) {
      a.w++;
      b.l++;
      a.pts += 3;
    } else if (m.winner_id === m.team_b_id) {
      b.w++;
      a.l++;
      b.pts += 3;
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.pts - a.pts || b.pf - b.pa - (a.pf - a.pa) || b.pf - a.pf,
  );
}
