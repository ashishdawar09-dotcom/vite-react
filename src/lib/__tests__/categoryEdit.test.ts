import { describe, expect, it } from "vitest";
import { categoryStarted, categoryUpdatePatch, savedFormatText, type CategoryFields } from "../categoryEdit";

const fields: CategoryFields = {
  name: "Men's Doubles 18–34", team_size: 2, match_minutes: 15, starts_at: "2026-11-21T16:30:00.000Z",
  age_band: null, min_age: null, allow_solo_signup: false, has_bronze_match: true, price: 40, price_basis: "per_player",
};
const compact = { groupsCount: 2, topNAdvance: 2, roundsPerPair: 1 as const };

describe("categoryUpdatePatch", () => {
  it("before the draw, an untouched format is left as saved", () => {
    const patch = categoryUpdatePatch({ phase: "none" }, fields, null);
    expect(patch).not.toHaveProperty("groups_count");
    expect(patch).not.toHaveProperty("top_n_advance");
    expect(patch).not.toHaveProperty("rounds_per_pair");
    expect(patch.match_minutes).toBe(15);
    expect(patch.team_size).toBe(2);
  });

  it("before the draw, a format the admin picked is saved", () => {
    const patch = categoryUpdatePatch({ phase: "none" }, fields, compact);
    expect(patch).toMatchObject({ groups_count: 2, top_n_advance: 2, rounds_per_pair: 1 });
  });

  it("once the group stage has started, Save never writes the format or singles/doubles", () => {
    for (const phase of ["group", "knockout"] as const) {
      const patch = categoryUpdatePatch({ phase }, fields, compact);
      expect(patch).not.toHaveProperty("groups_count");
      expect(patch).not.toHaveProperty("top_n_advance");
      expect(patch).not.toHaveProperty("rounds_per_pair");
      expect(patch).not.toHaveProperty("team_size");
      // Everything else still saves: the rehearsal only changed the match length.
      expect(patch).toMatchObject({ match_minutes: 15, starts_at: "2026-11-21T16:30:00.000Z", name: "Men's Doubles 18–34" });
    }
  });
});

describe("categoryStarted", () => {
  it("is true from the group stage on", () => {
    expect(categoryStarted({ phase: "none" })).toBe(false);
    expect(categoryStarted({ phase: "group" })).toBe(true);
    expect(categoryStarted({ phase: "knockout" })).toBe(true);
    expect(categoryStarted(null)).toBe(false);
  });
});

describe("savedFormatText", () => {
  it("describes the saved format in words", () => {
    expect(savedFormatText({ groups_count: 3, top_n_advance: 1, rounds_per_pair: 1 })).toBe("3 groups, top 1 each go through");
    expect(savedFormatText({ groups_count: 1, top_n_advance: 4, rounds_per_pair: 2 })).toBe("1 group, top 4 go through, everyone plays twice");
    expect(savedFormatText({ groups_count: 1, top_n_advance: 0, rounds_per_pair: 1 })).toBe("1 group, no knockout");
    expect(savedFormatText({ groups_count: 0, top_n_advance: 0, rounds_per_pair: 1 })).toBe("knockout only");
  });
});
