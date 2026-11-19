import { describe, expect, it } from "vitest";
import type { GameScore } from "../../types";
import { GAME_TO, SEMIFINAL_TO, matchPointAt, matchPointKey } from "./tvMatchPoint";
import type { TvMatch, TvStatus } from "./tvModel";

type M = Pick<TvMatch, "status" | "bestOf3" | "games" | "cur" | "gameTo">;
const one = (a: number, b: number, status: TvStatus = "live"): M => ({ status, bestOf3: false, gameTo: GAME_TO, games: [], cur: [a, b] });
/** A semifinal: one game to 21. */
const semi = (a: number, b: number, status: TvStatus = "live"): M => ({ status, bestOf3: false, gameTo: SEMIFINAL_TO, games: [], cur: [a, b] });
const bo3 = (games: GameScore[], a: number, b: number, status: TvStatus = "live"): M => ({ status, bestOf3: true, gameTo: GAME_TO, games, cur: [a, b] });

describe("match point in a one-game match (to 15, two clear from 14 all, 21 caps it)", () => {
  it("plays a game to 15", () => {
    expect(GAME_TO).toBe(15);
  });

  it.each([
    // The bug: the TV waited for 20 (games to 21), so none of these showed.
    [14, 10], [10, 14], [14, 0], [0, 14], [14, 13], [13, 14],
    // From 14 all a side needs two clear.
    [15, 14], [14, 15], [16, 15], [17, 16], [19, 18],
    // 21 caps the game: at 20 all the next rally wins it.
    [20, 19], [19, 20], [20, 20],
  ])("%i–%i is match point", (a, b) => {
    expect(matchPointAt(one(a, b))).toBe(true);
  });

  it.each([
    // Not there yet.
    [0, 0], [13, 10], [10, 13], [13, 13], [12, 13],
    // Level from 14 all: nobody wins with the next rally.
    [14, 14], [15, 15], [19, 19],
    // The game is over: the desk confirms it next, then the TV shows "Final score".
    [15, 10], [15, 13], [13, 15], [16, 14], [17, 15], [21, 20], [21, 19],
    // Scores a game to 15 can't reach (a slip on the score buttons) show nothing.
    [13, 16], [22, 20], [20, 17],
  ])("%i–%i is not match point", (a, b) => {
    expect(matchPointAt(one(a, b))).toBe(false);
  });

  it("only on a live match", () => {
    for (const st of ["queued", "called", "done"] as const) expect(matchPointAt(one(14, 10, st))).toBe(false);
  });
});

describe("match point in a semifinal (one game to 21, two clear from 20 all, 30 caps it)", () => {
  it("plays to 21", () => {
    expect(SEMIFINAL_TO).toBe(21);
  });

  it.each([
    // Match point is at 20, not 14.
    [20, 10], [10, 20], [20, 0], [20, 19], [19, 20],
    // From 20 all a side needs two clear.
    [21, 20], [20, 21], [22, 21], [25, 24], [28, 27],
    // 30 caps the game: at 29 all the next rally wins it.
    [29, 28], [28, 29], [29, 29],
  ])("%i–%i is match point", (a, b) => {
    expect(matchPointAt(semi(a, b))).toBe(true);
  });

  it.each([
    // What would be match point in a game to 15 is nothing here.
    [14, 10], [10, 14], [14, 13], [15, 14], [16, 15], [19, 18],
    // A game to 15 would be over; the semifinal plays on.
    [15, 10], [17, 15], [19, 12],
    // Level from 20 all: nobody wins with the next rally.
    [20, 20], [21, 21], [28, 28],
    // The game is over: the desk confirms it next.
    [21, 10], [21, 19], [22, 20], [30, 29], [30, 28],
    // Scores a game to 21 can't reach show nothing.
    [22, 19], [31, 29],
  ])("%i–%i is not match point", (a, b) => {
    expect(matchPointAt(semi(a, b))).toBe(false);
  });

  it("only on a live match", () => {
    for (const st of ["queued", "called", "done"] as const) expect(matchPointAt(semi(20, 10, st))).toBe(false);
  });
});

describe("match point in a best-of-3 match: only in a game that can win the match", () => {
  it("never in game 1: game point there can't end the match", () => {
    for (const [a, b] of [[14, 10], [10, 14], [20, 20], [15, 14]]) expect(matchPointAt(bo3([], a, b))).toBe(false);
  });

  it("in game 2, for the side that won game 1 only", () => {
    const aUp: GameScore[] = [[15, 12]], bUp: GameScore[] = [[11, 15]];
    expect(matchPointAt(bo3(aUp, 14, 10))).toBe(true);
    expect(matchPointAt(bo3(aUp, 15, 14))).toBe(true);
    expect(matchPointAt(bo3(aUp, 10, 14))).toBe(false); // game point for B, who would only level it at 1–1
    expect(matchPointAt(bo3(aUp, 14, 14))).toBe(false);
    expect(matchPointAt(bo3(aUp, 20, 20))).toBe(true); // A can win it with the next rally
    expect(matchPointAt(bo3(bUp, 10, 14))).toBe(true);
    expect(matchPointAt(bo3(bUp, 14, 10))).toBe(false);
  });

  it("in game 3, for either side", () => {
    const level: GameScore[] = [[15, 12], [13, 15]];
    expect(matchPointAt(bo3(level, 14, 10))).toBe(true);
    expect(matchPointAt(bo3(level, 10, 14))).toBe(true);
    expect(matchPointAt(bo3(level, 20, 19))).toBe(true);
    expect(matchPointAt(bo3(level, 14, 14))).toBe(false);
    expect(matchPointAt(bo3(level, 13, 13))).toBe(false);
    expect(matchPointAt(bo3(level, 15, 13))).toBe(false); // game over, the match is decided
  });

  it("never once a side has two games, or when the match isn't live", () => {
    expect(matchPointAt(bo3([[15, 12], [15, 13]], 14, 10))).toBe(false);
    expect(matchPointAt(bo3([[15, 12]], 14, 10, "done"))).toBe(false);
    expect(matchPointAt(bo3([[15, 12]], 14, 10, "called"))).toBe(false);
  });
});

describe("match point announcements", () => {
  it("are once per match for one game, once per game for best of 3", () => {
    expect(matchPointKey({ id: "m1", games: [] })).toBe("m1:0");
    expect(matchPointKey({ id: "m2", games: [[15, 12]] })).not.toBe(matchPointKey({ id: "m2", games: [[15, 12], [13, 15]] }));
  });
});
