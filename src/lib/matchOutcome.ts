// How a finished match ended. A cancelled match (Cancel on a time-over
// match) is confirmed with no winner: nobody wins or loses it, and it must
// not count anywhere standings, Scoreboard or played counters look.
//
// Rows cancelled before Oct 2026 also have is_walkover = true, so the test
// is "confirmed, no winner, not a bye", never the walkover flag.

import type { Match } from "../types";

type Outcome = Pick<Match, "team_a_id" | "team_b_id" | "winner_id" | "confirmed" | "is_bye" | "is_walkover">;

export function isCancelledMatch(m: Pick<Outcome, "winner_id" | "confirmed" | "is_bye">): boolean {
  return !!m.confirmed && !m.winner_id && !m.is_bye;
}

/** The losing side, or null when there's no winner (cancelled, unfinished). */
export function matchLoserId(m: Pick<Outcome, "team_a_id" | "team_b_id" | "winner_id">): string | null {
  if (!m.winner_id) return null;
  if (m.winner_id === m.team_a_id) return m.team_b_id;
  if (m.winner_id === m.team_b_id) return m.team_a_id;
  return null;
}

/** Badge for a finished match: "Cancelled", "W/O", or null for a played result. */
export function resultLabel(m: Outcome): "Cancelled" | "W/O" | null {
  if (isCancelledMatch(m)) return "Cancelled";
  if (m.confirmed && m.is_walkover) return "W/O";
  return null;
}
