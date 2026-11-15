// How many points win a game, and how long a match is expected to take.
//
// Shuttle Storm's rules (the director's decision of Nov 15, 2026):
// - every match is one game to 15: two clear from 14 all, 21 caps it;
// - a semifinal is one game to 21: two clear from 20 all, 30 caps it;
// - a best-of-3 match (the finals; each event's "Best of 3 games from"
//   setting, src/lib/bestOf3.ts) plays every game to 15.
//
// A semifinal isn't stored on the match. It is read from the bracket: the
// knockout round just before the event's last round, bronze match excluded.
// A semifinal the event's setting makes best of 3 plays games to 15 like any
// other best-of-3 match, so only a one-game semifinal goes to 21.
//
// Screens build the set once (semifinalsTo21) and ask it per match, so the TV,
// the scorers' cards, TIME OVER and the projected times all agree.

import type { Match } from "../types";

/** Points to win a game, in one-game and best-of-3 matches. */
export const GAME_TO = 15;
/** Points to win a one-game semifinal. */
export const SEMIFINAL_TO = 21;
/** A semifinal's time on court against a game to 15: 21/15, so 15 minutes becomes 21. */
export const SEMIFINAL_TIME_FACTOR = SEMIFINAL_TO / GAME_TO;

type BracketRow = Pick<Match, "category_id" | "stage" | "round_idx" | "is_bronze">;

/** Each event's last knockout round (the final's round_idx), by category id. */
export function finalRounds(matches: BracketRow[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const m of matches) {
    if (m.stage !== "knockout" || m.is_bronze) continue;
    last.set(m.category_id, Math.max(last.get(m.category_id) ?? 0, m.round_idx ?? 0));
  }
  return last;
}

/** A semifinal: the knockout round one before the final. `finalRound` is the event's entry in finalRounds. */
export function isSemifinal(m: BracketRow, finalRound: number | undefined): boolean {
  return m.stage === "knockout" && !m.is_bronze && finalRound != null && finalRound - (m.round_idx ?? 0) === 1;
}

/** Ids of the semifinals played as one game to 21 (every semifinal that isn't best of 3). */
export function semifinalsTo21(matches: (BracketRow & Pick<Match, "id" | "best_of">)[]): Set<string> {
  const last = finalRounds(matches);
  const ids = new Set<string>();
  for (const m of matches) if (m.best_of !== 3 && isSemifinal(m, last.get(m.category_id))) ids.add(m.id);
  return ids;
}

/** Points to win a game of this match. `semifinal`: the match is in semifinalsTo21. */
export function gameTarget(m: Pick<Match, "best_of">, semifinal = false): number {
  return semifinal && m.best_of !== 3 ? SEMIFINAL_TO : GAME_TO;
}

/**
 * How many one-game matches to 15 this match counts as on court: `bestOf3Factor`
 * for a best-of-3 match, 21/15 for a one-game semifinal, 1 otherwise.
 */
export function playFactor(m: Pick<Match, "best_of">, semifinal = false, bestOf3Factor = 2): number {
  if (m.best_of === 3) return bestOf3Factor;
  return semifinal ? SEMIFINAL_TIME_FACTOR : 1;
}
