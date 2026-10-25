import { describe, expect, it } from "vitest";
import type { Match } from "../../types";
import { finalOnlyRows, hasStageRows, isStageAlreadyStarted, planStart } from "../stageStart";

describe("planStart", () => {
  it("starts a 2-entry category as a single Final (report blocker 5)", () => {
    expect(planStart(2, undefined, { groups_count: 0, top_n_advance: 0 })).toEqual({ kind: "final" });
    // The Teams tab passes the "Final only" card as an override with groupsCount 0.
    expect(planStart(2, { groupsCount: 0, topNAdvance: 0 }, { groups_count: 0, top_n_advance: 0 })).toEqual({ kind: "final" });
  });

  it("refuses fewer than 2 entries", () => {
    expect(planStart(1, undefined, { groups_count: 0, top_n_advance: 0 })).toEqual({ kind: "too-few" });
    expect(planStart(0, undefined, { groups_count: 2, top_n_advance: 2 })).toEqual({ kind: "too-few" });
  });

  it("uses the planner default for 3+ entries", () => {
    const p = planStart(5, undefined, { groups_count: 0, top_n_advance: 0 });
    expect(p.kind).toBe("groups");
    if (p.kind === "groups") {
      expect(p.groupsCount).toBeGreaterThan(0);
      expect(p.groupSizes.reduce((a, b) => a + b, 0)).toBe(5);
      expect(p.topNAdvance).toBeGreaterThan(0);
    }
  });

  it("honours the saved format, then an explicit override", () => {
    expect(planStart(9, undefined, { groups_count: 3, top_n_advance: 1 })).toEqual({ kind: "groups", groupsCount: 3, groupSizes: [3, 3, 3], topNAdvance: 1 });
    expect(planStart(9, { groupsCount: 1, topNAdvance: 4 }, { groups_count: 3, top_n_advance: 1 })).toEqual({ kind: "groups", groupsCount: 1, groupSizes: [9], topNAdvance: 4 });
  });
});

describe("finalOnlyRows", () => {
  it("is one knockout match between the two entrants", () => {
    expect(finalOnlyRows("A", "B")).toEqual([{
      group_idx: null, round_idx: 0, slot_idx: 0, team_a_id: "A", team_b_id: "B",
      winner_id: null, confirmed: false, is_bye: false, status: "pending", is_bronze: false,
    }]);
  });
});

describe("hasStageRows", () => {
  const m = (category_id: string, stage: string) => ({ category_id, stage }) as Match;
  it("checks one category and stage", () => {
    const all = [m("x", "group"), m("y", "knockout")];
    expect(hasStageRows(all, "x", "group")).toBe(true);
    expect(hasStageRows(all, "x", "knockout")).toBe(false);
    expect(hasStageRows(all, "y", "knockout")).toBe(true);
    expect(hasStageRows(all, "y", "any")).toBe(true);
    expect(hasStageRows(all, "z", "any")).toBe(false);
  });
});

describe("isStageAlreadyStarted", () => {
  it("recognises the start_category_stage refusal", () => {
    expect(isStageAlreadyStarted({ message: "stage_already_started" })).toBe(true);
    expect(isStageAlreadyStarted(new Error("stage_already_started"))).toBe(true);
    expect(isStageAlreadyStarted({ message: "forbidden" })).toBe(false);
    expect(isStageAlreadyStarted(null)).toBe(false);
  });
});
