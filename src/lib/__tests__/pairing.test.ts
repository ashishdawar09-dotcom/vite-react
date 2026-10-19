import { describe, expect, it } from "vitest";
import { partnerNeeds, planSinglesDraw } from "../pairing";

const SINGLES = { id: "S", team_size: 1 as const };
const DOUBLES = { id: "D", team_size: 2 as const };
const MIXED = { id: "M", team_size: 2 as const };
const categories = [SINGLES, DOUBLES, MIXED];

const cats = (entries: Record<string, string[]>) =>
  new Map(Object.entries(entries).map(([pid, cs]) => [pid, new Set(cs)]));

describe("partnerNeeds", () => {
  it("never asks a singles-only player for a partner", () => {
    const r = partnerNeeds([{ id: "p", active: true }], cats({ p: ["S"] }), categories, []);
    expect(r.size).toBe(0);
  });

  it("lists an unpaired doubles entry", () => {
    const r = partnerNeeds([{ id: "p", active: true }], cats({ p: ["D"] }), categories, []);
    expect(r.get("p")).toEqual(["D"]);
  });

  it("follows a player who adds doubles after singles", () => {
    const players = [{ id: "p", active: true }];
    // Singles only.
    expect(partnerNeeds(players, cats({ p: ["S"] }), categories, []).size).toBe(0);
    // Doubles added, no partner yet: only the doubles category is listed,
    // even once the singles draw has given them a solo team.
    const solo = { category_id: "S", p1_id: "p", p2_id: null };
    expect(partnerNeeds(players, cats({ p: ["S", "D"] }), categories, [solo]).get("p")).toEqual(["D"]);
    // Partnered in doubles.
    const team = { category_id: "D", p1_id: "q", p2_id: "p" };
    expect(partnerNeeds(players, cats({ p: ["S", "D"] }), categories, [solo, team]).size).toBe(0);
  });

  it("checks each doubles category separately", () => {
    const team = { category_id: "D", p1_id: "p", p2_id: "q" };
    const r = partnerNeeds([{ id: "p", active: true }], cats({ p: ["D", "M"] }), categories, [team]);
    expect(r.get("p")).toEqual(["M"]);
  });

  it("skips players sitting out", () => {
    const r = partnerNeeds([{ id: "p", active: false }], cats({ p: ["D"] }), categories, []);
    expect(r.size).toBe(0);
  });
});

describe("planSinglesDraw", () => {
  it("creates a solo team for every entrant without one", () => {
    expect(planSinglesDraw(["a", "b"], [])).toEqual({ existing: [], toCreate: ["a", "b"] });
  });

  it("reuses existing solo teams and never doubles anyone up", () => {
    const ta = { id: "ta", p1_id: "a", p2_id: null };
    const ta2 = { id: "ta2", p1_id: "a", p2_id: null };
    const r = planSinglesDraw(["a", "b", "a"], [ta, ta2]);
    expect(r.existing).toEqual([ta]);
    expect(r.toCreate).toEqual(["b"]);
  });

  it("leaves out teams of players who aren't entrants", () => {
    const gone = { id: "tx", p1_id: "x", p2_id: null };
    const r = planSinglesDraw(["a"], [gone]);
    expect(r.existing).toEqual([]);
    expect(r.toCreate).toEqual(["a"]);
  });
});
