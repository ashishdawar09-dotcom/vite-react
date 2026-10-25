import { describe, expect, it } from "vitest";
import { buildGroups, groupKeyOf, groupStandings, groupsAllConfirmed } from "../groups";

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
