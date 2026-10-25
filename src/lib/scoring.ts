import type { Match } from "../types";

export type FinalScore =
  | { ok: true; winnerId: string | null; patch: Partial<Match> }
  | { ok: false; reason: "no-score" | "tie" };

/**
 * The write for confirming a match from the scores the scorer can see. The
 * scores go in the same update as the winner, so a score still being saved
 * (typed, then Confirm tapped before the box's own save landed) can't leave
 * the row with one side's score and the other side as winner.
 */
export function finalScorePatch(
  m: Pick<Match, "team_a_id" | "team_b_id">,
  scoreA: number | null, scoreB: number | null, confirmedAt: string,
): FinalScore {
  const sa = scoreA ?? 0, sb = scoreB ?? 0;
  if (sa === 0 && sb === 0) return { ok: false, reason: "no-score" };
  if (sa === sb) return { ok: false, reason: "tie" };
  const winnerId = sa > sb ? m.team_a_id : m.team_b_id;
  return {
    ok: true,
    winnerId,
    patch: { score_a: sa, score_b: sb, winner_id: winnerId, confirmed: true, status: "completed", confirmed_at: confirmedAt },
  };
}
