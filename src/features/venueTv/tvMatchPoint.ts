// When the venue TV says "Match point": the next rally can win the match.
//
// A Shuttle Storm game is to 15 (PR #94): at 14 all a side needs a two point
// lead, and 21 caps the game. A semifinal is one game to 21: two clear from
// 20 all, and 30 caps it. Each match carries its own target (TvMatch.gameTo,
// from lib/gameRules.ts), and when a game ends lives in lib/bestOf3.ts
// (gameOverAt), so the TV and the scorers' End Game agree.
//
// A one-game match is at match point whenever a side is at game point.
// A best-of-3 match is at match point only in a game that would win it: the
// side a game up in game 2, or either side in game 3. Game point in game 1,
// or for the side a game down, can't end the match, so the TV says nothing.

import { gameOverAt, gamesWon } from "../../lib/bestOf3";
import { GAME_TO, SEMIFINAL_TO } from "../../lib/gameRules";
import type { TvMatch } from "./tvModel";

export { GAME_TO, SEMIFINAL_TO };

/** Whether the side with `own` points wins a game to `target` with the next rally. */
function winsNextRally(own: number, other: number, target: number): boolean {
  return own + 1 > other && !gameOverAt(own, other, target) && gameOverAt(own + 1, other, target);
}

/** True when the next rally can win the match. Only a live match can be at match point. */
export function matchPointAt(m: Pick<TvMatch, "status" | "bestOf3" | "games" | "cur" | "gameTo">): boolean {
  if (m.status !== "live") return false;
  const [a, b] = m.cur;
  const aNext = winsNextRally(a, b, m.gameTo), bNext = winsNextRally(b, a, m.gameTo);
  if (!m.bestOf3) return aNext || bNext;
  const [wa, wb] = gamesWon(m.games);
  if (wa >= 2 || wb >= 2) return false;
  return (aNext && wa === 1) || (bNext && wb === 1);
}

/**
 * The match point the TV announces (and the Sports TV cuts to court for) once:
 * one per game, so a best-of-3 match point saved in game 2 is announced again
 * when game 3 gets there. A one-game match has a single key.
 */
export const matchPointKey = (m: Pick<TvMatch, "id" | "games">) => `${m.id}:${m.games.length}`;
