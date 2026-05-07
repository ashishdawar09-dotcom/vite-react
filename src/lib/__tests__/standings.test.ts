import { describe, expect, it } from "vitest";
import { computeStandings } from "../standings";

describe("computeStandings", () => {
  const teams = [{ id: "A" }, { id: "B" }, { id: "C" }];

  it("ranks all-wins above losses", () => {
    const m = [
      { team_a_id: "A", team_b_id: "B", score_a: 21, score_b: 15, winner_id: "A", confirmed: true, is_bye: false },
      { team_a_id: "A", team_b_id: "C", score_a: 21, score_b: 17, winner_id: "A", confirmed: true, is_bye: false },
      { team_a_id: "B", team_b_id: "C", score_a: 21, score_b: 19, winner_id: "B", confirmed: true, is_bye: false },
    ];
    const r = computeStandings(teams, m);
    expect(r.map(x => x.team.id)).toEqual(["A", "B", "C"]);
    expect(r[0].pts).toBe(6);
    expect(r[1].pts).toBe(3);
    expect(r[2].pts).toBe(0);
  });

  it("breaks ties by point differential", () => {
    const m = [
      // A beats B by 1, B beats C by 10, C beats A by 5 → all 1-1, but diff differs.
      { team_a_id: "A", team_b_id: "B", score_a: 21, score_b: 20, winner_id: "A", confirmed: true, is_bye: false },
      { team_a_id: "B", team_b_id: "C", score_a: 21, score_b: 11, winner_id: "B", confirmed: true, is_bye: false },
      { team_a_id: "C", team_b_id: "A", score_a: 21, score_b: 16, winner_id: "C", confirmed: true, is_bye: false },
    ];
    const r = computeStandings(teams, m);
    // All have 3 pts. Diffs: A: (21+16) - (20+21) = -4; B: (20+21) - (21+11) = +9; C: (11+21)-(21+16) = -5
    expect(r[0].team.id).toBe("B");
    expect(r[2].team.id).toBe("C");
  });

  it("ignores unconfirmed and bye matches", () => {
    const m = [
      { team_a_id: "A", team_b_id: "B", score_a: 21, score_b: 0, winner_id: "A", confirmed: false, is_bye: false },
      { team_a_id: "A", team_b_id: "C", score_a: 0, score_b: 0, winner_id: null, confirmed: true, is_bye: true },
    ];
    const r = computeStandings(teams, m);
    expect(r.every(x => x.w === 0 && x.l === 0)).toBe(true);
  });

  it("counts both score_for and score_against per match", () => {
    const m = [
      { team_a_id: "A", team_b_id: "B", score_a: 21, score_b: 18, winner_id: "A", confirmed: true, is_bye: false },
    ];
    const r = computeStandings(teams, m);
    const a = r.find(x => x.team.id === "A")!;
    const b = r.find(x => x.team.id === "B")!;
    expect(a.pf).toBe(21); expect(a.pa).toBe(18);
    expect(b.pf).toBe(18); expect(b.pa).toBe(21);
  });
});
