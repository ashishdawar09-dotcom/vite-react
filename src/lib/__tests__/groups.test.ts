import { describe, expect, it } from "vitest";
import { buildGroups, groupComplete, groupKeyOf, groupStandings, groupTies, groupsAllConfirmed, isRoundRobinOnly, roundRobinPodium } from "../groups";

type T = { id: string; category_id: string };
type M = {
  category_id: string; group_idx: number | null; team_a_id: string | null; team_b_id: string | null;
  score_a: number | null; score_b: number | null; winner_id: string | null; confirmed: boolean; is_bye: boolean;
};

const team = (id: string, category_id: string): T => ({ id, category_id });
function m(category_id: string, group_idx: number, a: string, b: string, result?: [number, number]): M {
  return {
    category_id, group_idx, team_a_id: a, team_b_id: b,
    score_a: result?.[0] ?? null, score_b: result?.[1] ?? null,
    winner_id: result ? (result[0] > result[1] ? a : b) : null,
    confirmed: !!result, is_bye: false,
  };
}

// Two categories that both have a Group A (group_idx 0): the bug merged them.
const teams = [team("ms1", "MS"), team("ms2", "MS"), team("ms3", "MS"), team("xd1", "XD"), team("xd2", "XD"), team("xd3", "XD"), team("xd4", "XD")];
const byId = Object.fromEntries(teams.map(t => [t.id, t]));
const matches: M[] = [
  m("XD", 0, "xd1", "xd2", [21, 10]),
  m("XD", 1, "xd3", "xd4", [5, 21]),
  m("MS", 0, "ms1", "ms2", [21, 19]),
  m("MS", 0, "ms2", "ms3"),
  m("MS", 0, "ms1", "ms3", [15, 21]),
];

describe("buildGroups", () => {
  it("keeps each category's groups apart and orders by category, then group", () => {
    const groups = buildGroups(matches, byId, ["MS", "XD"]);
    expect(groups.map(g => g.map(t => t.id))).toEqual([
      ["ms1", "ms2", "ms3"],
      ["xd1", "xd2"],
      ["xd3", "xd4"],
    ]);
  });

  it("gives the same groups as before for a single category", () => {
    const ms = matches.filter(x => x.category_id === "MS");
    expect(buildGroups(ms, byId, ["MS"]).map(g => g.map(t => t.id))).toEqual([["ms1", "ms2", "ms3"]]);
  });

  it("puts categories missing from the order last and skips unknown teams", () => {
    const groups = buildGroups(matches, { ...byId, xd1: undefined }, ["XD"]);
    expect(groups.map(g => g.map(t => t.id))).toEqual([["xd2"], ["xd3", "xd4"], ["ms1", "ms2", "ms3"]]);
  });
});

describe("groupKeyOf", () => {
  it("finds the category and group letter of a group", () => {
    expect(groupKeyOf([byId.xd3, byId.xd4], matches)).toEqual({ category_id: "XD", group_idx: 1 });
    expect(groupKeyOf([], matches)).toBeNull();
  });
});

describe("groupStandings", () => {
  it("only counts the group's own matches", () => {
    const st = groupStandings([byId.xd1, byId.xd2], matches);
    expect(st.map(s => [s.team.id, s.w, s.l, s.pts, s.pf, s.pa])).toEqual([
      ["xd1", 1, 0, 3, 21, 10],
      ["xd2", 0, 1, 0, 10, 21],
    ]);
  });

  it("ranks by points, then point difference", () => {
    const st = groupStandings([byId.ms1, byId.ms2, byId.ms3], matches);
    expect(st.map(s => s.team.id)).toEqual(["ms3", "ms1", "ms2"]);
  });

  it("ignores a cancelled match entirely (no win, no loss, no points)", () => {
    const cancelled: M = { ...m("MS", 0, "ms2", "ms3"), confirmed: true, score_a: 0, score_b: 0 };
    const st = groupStandings([byId.ms2, byId.ms3], [cancelled]);
    expect(st.every(s => s.w === 0 && s.l === 0 && s.pts === 0 && s.pf === 0 && s.pa === 0)).toBe(true);
  });
});

describe("groupsAllConfirmed", () => {
  it("is true only when every group has matches and all are confirmed", () => {
    const xdGroups = buildGroups(matches, byId, ["XD"]).filter(g => g[0].category_id === "XD");
    expect(groupsAllConfirmed(xdGroups, matches)).toBe(true);
    const msGroups = buildGroups(matches, byId, ["MS"]).filter(g => g[0].category_id === "MS");
    expect(groupsAllConfirmed(msGroups, matches)).toBe(false);
    expect(groupsAllConfirmed([], matches)).toBe(false);
  });
});

// Ties (QA review, Nov 4): wins, then point difference, then head-to-head,
// then a coin toss. They used to be settled silently by draw order.
describe("tie-breaks", () => {
  const g3 = [team("x", "C"), team("y", "C"), team("z", "C")];
  const ids = (st: { team: T }[]) => st.map(s => s.team.id);

  it("two teams level on wins and point difference: head-to-head decides, not draw order", () => {
    // x +4; y and z both -2 with one win each; z beat y.
    const ms = [m("C", 0, "x", "y", [19, 21]), m("C", 0, "x", "z", [21, 15]), m("C", 0, "y", "z", [17, 21])];
    expect(ids(groupStandings(g3, ms))).toEqual(["x", "z", "y"]);
    expect(groupTies(g3, ms)).toEqual([{ teams: [g3[2], g3[1]], places: [2, 3], decidedBy: "head-to-head", tossed: false }]);
  });

  it("point difference still comes before head-to-head", () => {
    // One win each; point differences 0, +14 and -14.
    const ms = [m("C", 0, "x", "y", [21, 19]), m("C", 0, "y", "z", [21, 5]), m("C", 0, "z", "x", [21, 19])];
    expect(ids(groupStandings(g3, ms))).toEqual(["y", "x", "z"]);
    expect(groupTies(g3, ms)).toEqual([]);
  });

  it("three teams level on everything need a coin toss, shown in draw order until it's recorded", () => {
    const ms = [m("C", 0, "x", "y", [21, 19]), m("C", 0, "y", "z", [21, 19]), m("C", 0, "z", "x", [21, 19])];
    expect(ids(groupStandings(g3, ms))).toEqual(["x", "y", "z"]);
    expect(groupTies(g3, ms)).toEqual([{ teams: g3, places: [1, 3], decidedBy: "coin toss", tossed: false }]);
    // z wins the first toss: z goes top, x and y still level.
    expect(ids(groupStandings(g3, ms, ["z"]))).toEqual(["z", "x", "y"]);
    expect(groupTies(g3, ms, ["z"])[0].tossed).toBe(false);
    // Then y wins the second.
    expect(ids(groupStandings(g3, ms, ["z", "y"]))).toEqual(["z", "y", "x"]);
    expect(groupTies(g3, ms, ["z", "y"])[0].tossed).toBe(true);
  });

  it("everyone plays twice and splits 1–1: coin toss", () => {
    const g2 = [team("a", "C"), team("b", "C")];
    const ms = [m("C", 0, "a", "b", [21, 19]), m("C", 0, "a", "b", [19, 21])];
    expect(groupTies(g2, ms)).toEqual([{ teams: g2, places: [1, 2], decidedBy: "coin toss", tossed: false }]);
  });
});

describe("round-robin-only events", () => {
  const g3 = [team("x", "C"), team("y", "C"), team("z", "C")];

  it("is one group with no knockout", () => {
    expect(isRoundRobinOnly({ groups_count: 1, top_n_advance: 0 })).toBe(true);
    expect(isRoundRobinOnly({ groups_count: 1, top_n_advance: 2 })).toBe(false);
    expect(isRoundRobinOnly({ groups_count: 0, top_n_advance: 0 })).toBe(false);
    expect(isRoundRobinOnly(null)).toBe(false);
  });

  it("names the podium once every match is confirmed", () => {
    const done = [m("C", 0, "x", "y", [21, 10]), m("C", 0, "x", "z", [21, 12]), m("C", 0, "y", "z", [21, 18])];
    const p = roundRobinPodium(g3, done);
    expect([p?.first?.id, p?.second?.id, p?.third?.id]).toEqual(["x", "y", "z"]);
    expect(p?.openTosses).toEqual([]);
    const unfinished = [...done.slice(0, 2), m("C", 0, "y", "z")];
    expect(groupComplete(g3, unfinished)).toBe(false);
    expect(roundRobinPodium(g3, unfinished)).toBeNull();
  });

  it("leaves places open while a coin toss decides them", () => {
    const circle = [m("C", 0, "x", "y", [21, 19]), m("C", 0, "y", "z", [21, 19]), m("C", 0, "z", "x", [21, 19])];
    const open = roundRobinPodium(g3, circle);
    expect([open?.first, open?.second, open?.third]).toEqual([null, null, null]);
    expect(open?.openTosses).toHaveLength(1);
    const tossed = roundRobinPodium(g3, circle, ["z", "y"]);
    expect([tossed?.first?.id, tossed?.second?.id, tossed?.third?.id]).toEqual(["z", "y", "x"]);
  });
});
