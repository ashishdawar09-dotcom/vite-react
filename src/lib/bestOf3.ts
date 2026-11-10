// Best-of-3 knockout matches (each event's "Best of 3 games from" setting;
// Shuttle Storm plays finals best of 3 games to 15, every other match one game to 15).
//
// How a best-of-3 match is stored (see the 20261109120000_best_of_3 migration):
// - matches.best_of = 3. Every screen asks isBestOf3(m), nothing else.
// - matches.games = the finished games in order, [[a, b], ...].
// - While live, score_a/score_b are the current game's points, so the +/−
//   taps and every live score display work unchanged.
// - Once confirmed, score_a/score_b are games won (2–0 or 2–1), so any screen
//   that prints score_a–score_b prints the match result.
//
// The one-game path (src/lib/scoring.ts finalScorePatch) is untouched.

import type { BestOf3From, Category, GameScore, Match } from "../types";
import type { FinalScore } from "./scoring";

export function isBestOf3(m: Pick<Match, "best_of">): boolean {
  return m.best_of === 3;
}

/** Points to win a game: 15 in a best-of-3 match, 21 in a one-game match. */
export function gameTarget(m: Pick<Match, "best_of">): number {
  return isBestOf3(m) ? 15 : 21;
}

/**
 * True when a game can end at this score under rally scoring: first to
 * `target`, at target−1 all a side must lead by 2, and the game is capped
 * (21 for games to 15, 30 for games to 21).
 */
export function gameOverAt(a: number, b: number, target = 15): boolean {
  const cap = target === 15 ? 21 : target + 9;
  const w = Math.max(a, b), l = Math.min(a, b);
  if (w === target) return l <= target - 2;
  if (w > target && w < cap) return w - l === 2;
  if (w === cap) return l === cap - 1 || l === cap - 2;
  return false;
}

/** The match's finished games. Anything malformed in the column is ignored. */
export function gamesOf(m: Pick<Match, "games">): GameScore[] {
  const g = m.games;
  if (!Array.isArray(g)) return [];
  return g.filter((x): x is GameScore =>
    Array.isArray(x) && x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]));
}

/** Games won by each side, [a, b]. */
export function gamesWon(games: GameScore[]): [number, number] {
  let a = 0, b = 0;
  for (const [x, y] of games) { if (x > y) a++; else if (y > x) b++; }
  return [a, b];
}

/** The game being played: 1, 2 or 3. */
export function currentGame(m: Pick<Match, "games">): number {
  return Math.min(3, gamesOf(m).length + 1);
}

export type EndGame =
  | { ok: true; decided: false; patch: Partial<Match> }
  | { ok: true; decided: true; winnerId: string | null; patch: Partial<Match> }
  | { ok: false; reason: "tie" | "not-over" | "decided" | "no-score" };

/**
 * End the current game at `a`–`b` (the numbers on screen). Not decided: the
 * game joins `games` and the boxes go back to 0–0. Decided (a side reaches 2
 * games): the same write confirms the match, with games won in
 * score_a/score_b. "not-over" means the score can't end a game to 15; pass
 * `force` once the scorer says save it anyway.
 */
export function endGamePatch(
  m: Pick<Match, "team_a_id" | "team_b_id" | "games" | "best_of">,
  a: number | null, b: number | null, confirmedAt: string, force = false,
): EndGame {
  const sa = a ?? 0, sb = b ?? 0;
  const done = gamesOf(m);
  const [wa0, wb0] = gamesWon(done);
  if (wa0 >= 2 || wb0 >= 2 || done.length >= 3) return { ok: false, reason: "decided" };
  if (sa === 0 && sb === 0) return { ok: false, reason: "no-score" };
  if (sa === sb) return { ok: false, reason: "tie" };
  if (!force && !gameOverAt(sa, sb, gameTarget(m))) return { ok: false, reason: "not-over" };
  const games: GameScore[] = [...done, [sa, sb]];
  const [wa, wb] = gamesWon(games);
  if (wa < 2 && wb < 2) {
    return { ok: true, decided: false, patch: { games, score_a: 0, score_b: 0 } };
  }
  const winnerId = wa > wb ? m.team_a_id : m.team_b_id;
  return {
    ok: true, decided: true, winnerId,
    patch: { games, score_a: wa, score_b: wb, winner_id: winnerId, confirmed: true, status: "completed", confirmed_at: confirmedAt },
  };
}

/** Undo the last finished game of a live match: its points go back into the boxes. */
export function undoGamePatch(m: Pick<Match, "games">): Partial<Match> | null {
  const done = gamesOf(m);
  const last = done[done.length - 1];
  if (!last) return null;
  const rest = done.slice(0, -1);
  return { games: rest.length ? rest : null, score_a: last[0], score_b: last[1] };
}

/**
 * What End Game would do with `a`–`b` on screen: confirm the match (the score
 * ends the game that gives a side its second game) or end game N.
 */
export function endGameAction(m: Pick<Match, "games" | "best_of">, a: number, b: number):
  { decides: true; score: string } | { decides: false; game: number } {
  if (a !== b && gameOverAt(a, b, gameTarget(m))) {
    const [wa, wb] = gamesWon(gamesOf(m));
    const lead = a > b ? wa : wb, other = a > b ? wb : wa;
    if (lead === 1) return { decides: true, score: `2–${other}` };
  }
  return { decides: false, game: currentGame(m) };
}

/**
 * Saving `a`–`b` as a game would give the leading side its second game, so
 * the save confirms the match (whether or not the score can end a game).
 * "2–1" etc., or null.
 */
export function decidingScore(m: Pick<Match, "games">, a: number, b: number): string | null {
  if (a === b) return null;
  const [wa, wb] = gamesWon(gamesOf(m));
  const lead = a > b ? wa : wb, other = a > b ? wb : wa;
  return lead === 1 ? `2–${other}` : null;
}

export type GamesCheck = { ok: true } | { ok: false; reason: string };

/** Whether `games` is a complete best-of-3 result: no tied game, and it ends the moment a side wins its second game. */
export function checkGames(games: GameScore[]): GamesCheck {
  if (games.length < 2) return { ok: false, reason: "Enter at least two games." };
  let a = 0, b = 0;
  for (let i = 0; i < games.length; i++) {
    const [x, y] = games[i];
    if (x === y) return { ok: false, reason: `Game ${i + 1} is a tie. Every game needs a winner.` };
    if (a === 2 || b === 2) return { ok: false, reason: `The match was over after game ${i}. Clear game ${i + 1}.` };
    if (x > y) a++; else b++;
  }
  if (a < 2 && b < 2) return { ok: false, reason: "Nobody has won two games yet." };
  return { ok: true };
}

/** Save an edited best-of-3 result (Edit Score on a confirmed match). */
export function editedGamesPatch(
  m: Pick<Match, "team_a_id" | "team_b_id">, games: GameScore[], confirmedAt: string,
): (FinalScore & { ok: true }) | { ok: false; reason: string } {
  const check = checkGames(games);
  if (!check.ok) return check;
  const [wa, wb] = gamesWon(games);
  const winnerId = wa > wb ? m.team_a_id : m.team_b_id;
  return {
    ok: true, winnerId,
    patch: { games, score_a: wa, score_b: wb, winner_id: winnerId, confirmed: true, status: "completed", confirmed_at: confirmedAt },
  };
}

/**
 * A best-of-3 match stopped early (time-over winner, walkover): score_a/score_b
 * become games won so far, not the unfinished game's points.
 */
export function stopEarlyPatch(m: Pick<Match, "games" | "best_of">): Partial<Match> {
  if (!isBestOf3(m)) return {};
  const [wa, wb] = gamesWon(gamesOf(m));
  return { score_a: wa, score_b: wb };
}

/** "15–12, 13–15, 15–9", or "" when there are no games. */
export function gamesLine(m: Pick<Match, "games">, sep = ", "): string {
  return gamesOf(m).map(([x, y]) => `${x}–${y}`).join(sep);
}

/** "Best of 3 · Game 2 · games 1–0" for a live best-of-3 match, else "". */
export function liveGameTag(m: Pick<Match, "games" | "best_of">): string {
  if (!isBestOf3(m)) return "";
  const [wa, wb] = gamesWon(gamesOf(m));
  return `Best of 3 · Game ${currentGame(m)} · games ${wa}–${wb}`;
}

/** Minutes a match is expected to take on court: a best-of-3 match counts as two one-game matches. */
export function playMinutes(m: Pick<Match, "best_of" | "extended_minutes">, matchMinutes: number | null | undefined): number {
  const base = matchMinutes || 12;
  return base * (isBestOf3(m) ? 2 : 1) + (m.extended_minutes ?? 0);
}

/** Labels for the event setting, in the order Edit Event shows them. */
export const BEST_OF_3_OPTIONS: { value: BestOf3From | null; label: string }[] = [
  { value: null, label: "Never" },
  { value: "final", label: "Final" },
  { value: "sf", label: "Semifinals" },
  { value: "qf", label: "Quarterfinals" },
];

/** Rounds counted back from the final: the final (and bronze) is 0, semifinals 1, quarterfinals 2. Mirrors apply_knockout_format. */
export function roundBestOf(fromFinal: number, setting: Category["best_of_3_from"]): 1 | 3 {
  const depth = setting === "final" ? 0 : setting === "sf" ? 1 : setting === "qf" ? 2 : -1;
  return fromFinal <= depth ? 3 : 1;
}
