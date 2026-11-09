import { describe, expect, it } from "vitest";
import {
  checkGames, currentGame, decidingScore, editedGamesPatch, endGamePatch, gameOverAt, gamesLine, gamesOf, gamesWon,
  isBestOf3, playMinutes, roundBestOf, stopEarlyPatch, undoGamePatch,
} from "../bestOf3";
import type { GameScore, Match } from "../../types";

const AT = "2026-11-21T20:00:00.000Z";
const bo3 = (games: GameScore[] | null = null): Pick<Match, "team_a_id" | "team_b_id" | "games" | "best_of"> =>
  ({ team_a_id: "A", team_b_id: "B", games, best_of: 3 });

describe("game rules (games to 15, setting at 14-all, capped at 21)", () => {
  it.each([
    [15, 13, true], [15, 0, true], [13, 15, true],
    [15, 14, false], [14, 12, false], [16, 14, true], [16, 15, false], [17, 15, true],
    [20, 18, true], [21, 20, true], [21, 19, true], [21, 18, false], [22, 20, false], [0, 0, false],
  ])("%i–%i ends a game: %s", (a, b, ok) => {
    expect(gameOverAt(a, b, 15)).toBe(ok);
  });
  it("games to 21 cap at 30", () => {
    expect(gameOverAt(21, 19, 21)).toBe(true);
    expect(gameOverAt(21, 20, 21)).toBe(false);
    expect(gameOverAt(30, 29, 21)).toBe(true);
  });
});

describe("ending games", () => {
  it("game 1 joins the games and the boxes go back to 0–0", () => {
    const r = endGamePatch(bo3(), 15, 12, AT);
    expect(r).toEqual({ ok: true, decided: false, patch: { games: [[15, 12]], score_a: 0, score_b: 0 } });
  });

  it("2–0 confirms the match with games won in the score", () => {
    const r = endGamePatch(bo3([[15, 12]]), 15, 10, AT);
    expect(r).toEqual({
      ok: true, decided: true, winnerId: "A",
      patch: { games: [[15, 12], [15, 10]], score_a: 2, score_b: 0, winner_id: "A", confirmed: true, status: "completed", confirmed_at: AT },
    });
  });

  it("1–1 goes to a third game; the third decides it 2–1", () => {
    const g2 = endGamePatch(bo3([[15, 12]]), 13, 15, AT);
    expect(g2.ok && !g2.decided && g2.patch.games).toEqual([[15, 12], [13, 15]]);
    const g3 = endGamePatch(bo3([[15, 12], [13, 15]]), 9, 15, AT);
    expect(g3.ok && g3.decided && g3.winnerId).toBe("B");
    expect(g3.ok && g3.patch).toMatchObject({ score_a: 1, score_b: 2, winner_id: "B" });
  });

  it("refuses a tie, an empty game, and a decided match", () => {
    expect(endGamePatch(bo3(), 10, 10, AT)).toEqual({ ok: false, reason: "tie" });
    expect(endGamePatch(bo3(), 0, 0, AT)).toEqual({ ok: false, reason: "no-score" });
    expect(endGamePatch(bo3([[15, 1], [15, 2]]), 3, 1, AT)).toEqual({ ok: false, reason: "decided" });
  });

  it("asks before saving a score that can't end a game, and saves it when forced", () => {
    expect(endGamePatch(bo3(), 15, 14, AT)).toEqual({ ok: false, reason: "not-over" });
    const r = endGamePatch(bo3(), 15, 14, AT, true);
    expect(r.ok && r.patch.games).toEqual([[15, 14]]);
  });

  it("undo puts the last game's points back", () => {
    expect(undoGamePatch({ games: [[15, 12], [13, 15]] })).toEqual({ games: [[15, 12]], score_a: 13, score_b: 15 });
    expect(undoGamePatch({ games: [[15, 12]] })).toEqual({ games: null, score_a: 15, score_b: 12 });
    expect(undoGamePatch({ games: null })).toBeNull();
  });

  it("knows the game being played", () => {
    expect(currentGame({ games: null })).toBe(1);
    expect(currentGame({ games: [[15, 3]] })).toBe(2);
    expect(currentGame({ games: [[15, 3], [3, 15]] })).toBe(3);
  });
});

describe("editing a finished best-of-3 result", () => {
  it("accepts 2–0 and 2–1 results", () => {
    expect(checkGames([[15, 3], [15, 4]])).toEqual({ ok: true });
    expect(checkGames([[3, 15], [15, 4], [21, 20]])).toEqual({ ok: true });
  });
  it("rejects a tied game, a third game after 2–0, and an unfinished match", () => {
    expect(checkGames([[15, 15], [15, 4]]).ok).toBe(false);
    expect(checkGames([[15, 3], [15, 4], [15, 9]]).ok).toBe(false);
    expect(checkGames([[15, 3], [4, 15]]).ok).toBe(false);
    expect(checkGames([[15, 3]]).ok).toBe(false);
  });
  it("writes games, games won and the winner together", () => {
    const r = editedGamesPatch({ team_a_id: "A", team_b_id: "B" }, [[15, 3], [10, 15], [15, 13]], AT);
    expect(r).toEqual({
      ok: true, winnerId: "A",
      patch: { games: [[15, 3], [10, 15], [15, 13]], score_a: 2, score_b: 1, winner_id: "A", confirmed: true, status: "completed", confirmed_at: AT },
    });
  });
});

describe("helpers", () => {
  it("reads only well-formed games", () => {
    expect(gamesOf({ games: [[15, 3], [1] as unknown as GameScore, [4, 15]] })).toEqual([[15, 3], [4, 15]]);
    expect(gamesOf({ games: undefined })).toEqual([]);
    expect(gamesWon([[15, 3], [4, 15], [15, 13]])).toEqual([2, 1]);
    expect(gamesLine({ games: [[15, 12], [13, 15]] })).toBe("15–12, 13–15");
  });
  it("only best_of 3 is best of 3 (rows cached before the column existed are one game)", () => {
    expect(isBestOf3({ best_of: 3 })).toBe(true);
    expect(isBestOf3({ best_of: 1 })).toBe(false);
    expect(isBestOf3({})).toBe(false);
  });
  it("a time-over winner or walkover shows games won, not the unfinished game's points", () => {
    expect(stopEarlyPatch({ best_of: 3, games: [[15, 9]] })).toEqual({ score_a: 1, score_b: 0 });
    expect(stopEarlyPatch({ best_of: 1, games: null })).toEqual({});
  });
  it("a best-of-3 match counts as two one-game matches on the clock", () => {
    expect(playMinutes({ best_of: 3, extended_minutes: 5 }, 12)).toBe(29);
    expect(playMinutes({ best_of: 1, extended_minutes: 0 }, 12)).toBe(12);
    expect(playMinutes({ extended_minutes: 0 }, null)).toBe(12);
  });
  it("matches the database's round rule", () => {
    // fromFinal: final/bronze 0, semifinals 1, quarterfinals 2, round of 16 3.
    expect([0, 1, 2, 3].map(d => roundBestOf(d, "sf"))).toEqual([3, 3, 1, 1]);
    expect([0, 1, 2, 3].map(d => roundBestOf(d, "qf"))).toEqual([3, 3, 3, 1]);
    expect([0, 1, 2, 3].map(d => roundBestOf(d, "final"))).toEqual([3, 1, 1, 1]);
    expect([0, 1, 2, 3].map(d => roundBestOf(d, null))).toEqual([1, 1, 1, 1]);
  });
});

describe("saving a game that decides the match", () => {
  it("names the result when the save would give a side its second game", () => {
    expect(decidingScore({ games: [[15, 3]] }, 14, 12)).toBe("2–0");
    expect(decidingScore({ games: [[15, 3], [3, 15]] }, 12, 14)).toBe("2–1");
    expect(decidingScore({ games: [[15, 3]] }, 10, 14)).toBeNull();
    expect(decidingScore({ games: null }, 15, 14)).toBeNull();
    expect(decidingScore({ games: [[15, 3]] }, 9, 9)).toBeNull();
  });
});
