import { describe, expect, it } from "vitest";
import type { Match } from "../../types";
import { gameOverAt, playMinutes } from "../bestOf3";
import { GAME_TO, SEMIFINAL_TIME_FACTOR, SEMIFINAL_TO, finalRounds, gameTarget, isSemifinal, playFactor, semifinalsTo21 } from "../gameRules";

// Shuttle Storm (Nov 15, 2026): one game to 15, semifinals one game to 21,
// finals best of 3 games to 15.

type Row = Pick<Match, "id" | "category_id" | "stage" | "round_idx" | "is_bronze" | "best_of">;
const group = (id: string, cat = "a"): Row => ({ id, category_id: cat, stage: "group", round_idx: null, is_bronze: false, best_of: 1 });
const ko = (id: string, round: number, over: Partial<Row> = {}): Row => ({ id, category_id: "a", stage: "knockout", round_idx: round, is_bronze: false, best_of: 1, ...over });

/** Quarterfinals, semifinals, a best-of-3 final and a bronze match, after a group stage. */
const bracket: Row[] = [
  group("g1"), group("g2"),
  ko("qf1", 0), ko("qf2", 0), ko("qf3", 0), ko("qf4", 0),
  ko("sf1", 1), ko("sf2", 1),
  ko("final", 2, { best_of: 3 }), ko("bronze", 2, { is_bronze: true, best_of: 3 }),
];

describe("the points that win a game", () => {
  it("are 15, and 21 in a semifinal", () => {
    expect(GAME_TO).toBe(15);
    expect(SEMIFINAL_TO).toBe(21);
  });

  it("a one-game match is to 15, a one-game semifinal to 21, every best-of-3 game to 15", () => {
    expect(gameTarget({ best_of: 1 })).toBe(15);
    expect(gameTarget({})).toBe(15);
    expect(gameTarget({ best_of: 1 }, true)).toBe(21);
    expect(gameTarget({}, true)).toBe(21);
    expect(gameTarget({ best_of: 3 })).toBe(15);
    // An event set to "Best of 3 games from: Semifinals" keeps its semifinals at games to 15.
    expect(gameTarget({ best_of: 3 }, true)).toBe(15);
  });

  it("a semifinal ends at 21, two clear from 20 all, and 30 caps it", () => {
    const over = (a: number, b: number) => gameOverAt(a, b, gameTarget({ best_of: 1 }, true));
    for (const [a, b] of [[21, 0], [21, 19], [19, 21], [22, 20], [25, 23], [30, 28], [30, 29], [29, 30]]) expect(over(a, b)).toBe(true);
    // 15 doesn't end it, 21–20 isn't two clear, and nothing goes past 30.
    for (const [a, b] of [[15, 10], [20, 18], [21, 20], [22, 21], [29, 29], [31, 29], [22, 19]]) expect(over(a, b)).toBe(false);
  });
});

describe("which matches are semifinals", () => {
  it("the knockout round one before the final, in each event's own bracket", () => {
    expect(finalRounds(bracket).get("a")).toBe(2);
    expect([...semifinalsTo21(bracket)].sort()).toEqual(["sf1", "sf2"]);
  });

  it("never a group match, a quarterfinal, the final or the bronze match", () => {
    const last = finalRounds(bracket).get("a");
    for (const id of ["g1", "qf1", "final", "bronze"]) expect(isSemifinal(bracket.find(m => m.id === id)!, last)).toBe(false);
    expect(isSemifinal(bracket.find(m => m.id === "sf1")!, last)).toBe(true);
  });

  it("a bracket of semifinals and a final: round 0 is the semifinals", () => {
    const four = [ko("sf1", 0), ko("sf2", 0), ko("final", 1, { best_of: 3 })];
    expect([...semifinalsTo21(four)].sort()).toEqual(["sf1", "sf2"]);
  });

  it("an event with only a final, or only a round robin, has none", () => {
    expect(semifinalsTo21([group("g1"), group("g2"), ko("final", 0, { best_of: 3 })]).size).toBe(0);
    expect(semifinalsTo21([group("g1"), group("g2"), group("g3")]).size).toBe(0);
    expect(isSemifinal(ko("x", 0), undefined)).toBe(false);
  });

  it("a best-of-3 semifinal isn't one of them: it plays games to 15", () => {
    const set = semifinalsTo21([ko("sf1", 0, { best_of: 3 }), ko("sf2", 0, { best_of: 3 }), ko("final", 1, { best_of: 3 })]);
    expect(set.size).toBe(0);
  });

  it("each event is counted on its own", () => {
    const two = [
      ko("a-sf", 0), ko("a-final", 1),
      ko("b-qf", 0, { category_id: "b" }), ko("b-sf", 1, { category_id: "b" }), ko("b-final", 2, { category_id: "b" }),
    ];
    expect([...semifinalsTo21(two)].sort()).toEqual(["a-sf", "b-sf"]);
  });
});

describe("time on court", () => {
  it("a semifinal to 21 gets 21/15 of a game to 15", () => {
    expect(SEMIFINAL_TIME_FACTOR).toBeCloseTo(1.4, 10);
    expect(playFactor({ best_of: 1 })).toBe(1);
    expect(playFactor({ best_of: 1 }, true)).toBeCloseTo(1.4, 10);
    expect(playFactor({ best_of: 3 })).toBe(2);
    expect(playFactor({ best_of: 3 }, true)).toBe(2);
    expect(playFactor({ best_of: 3 }, false, 3)).toBe(3);
  });

  it("TIME OVER: 15-minute events give a semifinal 21 minutes, a final 30, everything else 15", () => {
    expect(playMinutes({ best_of: 1, extended_minutes: 0 }, 15)).toBe(15);
    expect(playMinutes({ best_of: 1, extended_minutes: 0 }, 15, true)).toBe(21);
    expect(playMinutes({ best_of: 3, extended_minutes: 0 }, 15)).toBe(30);
    expect(playMinutes({ best_of: 3, extended_minutes: 0 }, 15, true)).toBe(30);
    // An extension is added on top, and other match lengths round to whole minutes.
    expect(playMinutes({ best_of: 1, extended_minutes: 5 }, 15, true)).toBe(26);
    expect(playMinutes({ best_of: 1, extended_minutes: 0 }, 12, true)).toBe(17);
  });
});
