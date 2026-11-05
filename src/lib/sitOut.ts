// Sit Out: taking a player out of the tournament at any point in the day.
//
// Before a category's draw, their teams there are removed (delete_team()
// logs each one with a reason). After the draw their teams stay, so results
// already played keep both teams and nobody's standings move. Each remaining
// match whose opponent is known goes to the opponent as a walkover; a
// knockout winner moves on as usual. A later-round match whose opponent
// isn't decided yet waits, and its card offers the walkover once both teams
// are in it (instead of ▶ Start). A match in play blocks Sit Out: the admin
// finishes that one first.
//
// Everything here is pure: it reads the rows passed in and writes nothing.

import type { Match, Player, Team } from "../types";

type Availability = Pick<Player, "active">;
/** Anything with the team's players attached, e.g. App's TeamView. */
export type TeamWithPlayers = { p1?: Availability | null; p2?: Availability | null };

/**
 * A team can't play if either of its players is sitting out. Only an explicit
 * active = false counts, so rows loaded without the column never look out.
 */
export function teamSittingOut(team: TeamWithPlayers | null | undefined): boolean {
  if (!team) return false;
  return team.p1?.active === false || team.p2?.active === false;
}

export type SitOutWalkover = {
  match: Match;
  /** The opponent, who wins the walkover. */
  winnerId: string;
  /** The match is holding a court (warming up): the walkover frees it. */
  freesCourt: boolean;
};

export type SitOutPlan = {
  /** Every team the player is on, in any category. */
  teams: Team[];
  /** Matches in play right now. Non-empty = refuse: finish them first. */
  live: Match[];
  /** Teams with no match yet (draw not made): removed. */
  removeTeams: Team[];
  /** Teams already in the draw: kept, so played results stay intact. */
  keepTeams: Team[];
  /** Unplayed matches with a known opponent: the opponent wins by walkover. */
  walkovers: SitOutWalkover[];
  /** Unplayed matches whose opponent isn't decided yet (later knockout rounds). */
  waiting: Match[];
  /** Unplayed matches whose opponent is sitting out too: the admin decides. */
  bothOut: Match[];
};

function unplayed(m: Match): boolean {
  return !m.confirmed && m.status !== "completed" && !m.is_bye;
}

/**
 * What sitting out `playerId` does. `teams` and `matches` are the whole
 * tournament's rows; `opponentOut` says whether a team (by id) is already
 * sitting out.
 */
export function planSitOut(
  playerId: string,
  teams: Team[],
  matches: Match[],
  opponentOut: (teamId: string) => boolean,
): SitOutPlan {
  const mine = teams.filter(t => t.p1_id === playerId || t.p2_id === playerId);
  const inAMatch = (teamId: string) =>
    matches.some(m => m.team_a_id === teamId || m.team_b_id === teamId || m.winner_id === teamId);
  const removeTeams = mine.filter(t => !inAMatch(t.id));
  const keepTeams = mine.filter(t => inAMatch(t.id));
  const keepIds = new Set(keepTeams.map(t => t.id));

  const plan: SitOutPlan = { teams: mine, live: [], removeTeams, keepTeams, walkovers: [], waiting: [], bothOut: [] };
  for (const m of matches) {
    const side = m.team_a_id && keepIds.has(m.team_a_id) ? "a"
      : m.team_b_id && keepIds.has(m.team_b_id) ? "b"
      : null;
    if (!side || !unplayed(m)) continue;
    if (m.status === "live") { plan.live.push(m); continue; }
    const opponent = side === "a" ? m.team_b_id : m.team_a_id;
    if (!opponent) { plan.waiting.push(m); continue; }
    if (opponentOut(opponent)) { plan.bothOut.push(m); continue; }
    plan.walkovers.push({ match: m, winnerId: opponent, freesCourt: !!m.court_allocated_at || m.court_number != null });
  }
  return plan;
}

/**
 * For an unplayed match where exactly one team is sitting out: the team that
 * wins the walkover. Null when both teams can play, both are out, a team
 * isn't decided yet, or the match is in play or finished.
 */
export function sitOutWalkoverWinner(
  m: Match,
  teamById: Record<string, TeamWithPlayers | undefined>,
): string | null {
  if (!unplayed(m) || m.status === "live" || !m.team_a_id || !m.team_b_id) return null;
  const aOut = teamSittingOut(teamById[m.team_a_id]);
  const bOut = teamSittingOut(teamById[m.team_b_id]);
  if (aOut === bOut) return null;
  return aOut ? m.team_b_id : m.team_a_id;
}

/**
 * Knockout qualifiers: the top `topN` of each group's table, skipping teams
 * that are sitting out, so the next team in that group goes through instead.
 * `skipped` = teams that finished in a qualifying place but are out;
 * `promoted` = teams that go through only because of that.
 */
export function pickQualifiers<T>(
  tables: { team: T }[][],
  topN: number,
  out: (team: T) => boolean,
): { qualifiers: T[][]; skipped: T[]; promoted: T[] } {
  const skipped: T[] = [];
  const promoted: T[] = [];
  const qualifiers = tables.map(table => {
    const ranked = table.map(s => s.team);
    const placed = ranked.slice(0, topN);
    const through = ranked.filter(t => !out(t)).slice(0, topN);
    skipped.push(...placed.filter(out));
    promoted.push(...through.filter(t => !placed.includes(t)));
    return through;
  }).filter(q => q.length > 0);
  return { qualifiers, skipped, promoted };
}
