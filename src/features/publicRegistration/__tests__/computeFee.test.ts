import { describe, expect, it } from "vitest";
import { computeFee } from "../computeFee";
import type { Category, TournamentFees } from "../../../types";

const fees: TournamentFees = {
  kid:   { member: 12, non_member: 15 },
  teen:  { member: 15, non_member: 20 },
  adult: { member: 20, non_member: 25 },
};

const cat = (overrides: Partial<Category> = {}): Category => ({
  id: "c", tournament_id: "t", name: "X", team_size: 1, match_minutes: 12,
  starts_at: null, phase: "none", rounds_per_pair: 1, groups_count: 0,
  top_n_advance: 0, sort_order: 0, created_at: "", age_band: "adult",
  allow_solo_signup: false, has_bronze_match: false, ...overrides,
});

describe("computeFee", () => {
  it("returns null when category is null", () => {
    expect(computeFee(fees, null, true)).toBeNull();
  });

  it("returns null when isMember is null", () => {
    expect(computeFee(fees, cat(), null)).toBeNull();
  });

  it("returns null when age_band missing", () => {
    expect(computeFee(fees, cat({ age_band: null }), true)).toBeNull();
  });

  it("returns null when fees table missing the band", () => {
    expect(computeFee({}, cat({ age_band: "adult" }), true)).toBeNull();
  });

  it("returns member rate for member adult singles", () => {
    expect(computeFee(fees, cat({ team_size: 1, age_band: "adult" }), true)).toBe(20);
  });

  it("returns non-member rate for non-member adult singles", () => {
    expect(computeFee(fees, cat({ team_size: 1, age_band: "adult" }), false)).toBe(25);
  });

  it("returns kid member rate", () => {
    expect(computeFee(fees, cat({ age_band: "kid" }), true)).toBe(12);
  });

  it("returns teen non-member rate", () => {
    expect(computeFee(fees, cat({ age_band: "teen" }), false)).toBe(20);
  });

  it("doubles + separate split returns single share", () => {
    expect(computeFee(fees, cat({ team_size: 2, age_band: "adult" }), true, "separate")).toBe(20);
  });

  it("doubles + full split returns 2x", () => {
    expect(computeFee(fees, cat({ team_size: 2, age_band: "adult" }), true, "full")).toBe(40);
  });

  it("singles ignores paymentSplit", () => {
    expect(computeFee(fees, cat({ team_size: 1, age_band: "adult" }), false, "full")).toBe(25);
  });
});
