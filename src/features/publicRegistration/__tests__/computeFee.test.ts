import { describe, expect, it } from "vitest";
import { cardAmount, computeFee, fmtMoney, priceBasis, priceDescription, priceLabel } from "../computeFee";
import type { Category } from "../../../types";

const cat = (overrides: Partial<Category> = {}): Category => ({
  id: "c", tournament_id: "t", name: "X", team_size: 1, match_minutes: 12,
  starts_at: null, phase: "none", rounds_per_pair: 1, groups_count: 0,
  top_n_advance: 0, sort_order: 0, created_at: "", age_band: "adult",
  allow_solo_signup: false, has_bronze_match: false,
  price: 25, price_basis: "per_player", ...overrides,
});

describe("computeFee", () => {
  it("returns null when category is null", () => {
    expect(computeFee(null)).toBeNull();
  });

  it("returns null when the category has no price", () => {
    expect(computeFee(cat({ price: null }))).toBeNull();
  });

  it("singles: the category price, ignoring payment split", () => {
    expect(computeFee(cat({ team_size: 1, price: 25 }), "separate")).toBe(25);
    expect(computeFee(cat({ team_size: 1, price: 25 }), "full")).toBe(25);
  });

  it("singles: treated as per player even if stored per team", () => {
    expect(priceBasis(cat({ team_size: 1, price_basis: "per_team" }))).toBe("per_player");
    expect(computeFee(cat({ team_size: 1, price_basis: "per_team" }), "full")).toBe(25);
  });

  it("doubles per player + separate: one share", () => {
    expect(computeFee(cat({ team_size: 2, price: 20 }), "separate")).toBe(20);
  });

  it("doubles per player + full: both shares", () => {
    expect(computeFee(cat({ team_size: 2, price: 20 }), "full")).toBe(40);
  });

  it("doubles per team: one price whatever the split", () => {
    expect(computeFee(cat({ team_size: 2, price: 40, price_basis: "per_team" }), "separate")).toBe(40);
    expect(computeFee(cat({ team_size: 2, price: 40, price_basis: "per_team" }), "full")).toBe(40);
  });

  it("accepts numeric strings from the API", () => {
    expect(computeFee(cat({ price: "12.50" as unknown as number }))).toBe(12.5);
  });

  it("zero is a valid price", () => {
    expect(computeFee(cat({ price: 0 }))).toBe(0);
  });
});

describe("price labels", () => {
  it("formats whole and fractional amounts", () => {
    expect(fmtMoney(25)).toBe("$25");
    expect(fmtMoney(12.5)).toBe("$12.50");
  });

  it("short labels name the basis", () => {
    expect(priceLabel(cat({ team_size: 1, price: 25 }))).toBe("$25 per player");
    expect(priceLabel(cat({ team_size: 2, price: 20 }))).toBe("$20 per player");
    expect(priceLabel(cat({ team_size: 2, price: 40, price_basis: "per_team" }))).toBe("$40 per team");
    expect(priceLabel(cat({ price: null }))).toBeNull();
  });

  it("descriptions spell out what the payment covers", () => {
    expect(priceDescription(cat({ team_size: 1, price: 25 }))).toBe("$25 per player.");
    expect(priceDescription(cat({ team_size: 2, price: 40, price_basis: "per_team" })))
      .toBe("$40 per team. One payment covers both players.");
    expect(priceDescription(cat({ team_size: 2, price: 20 }))).toContain("$20 per player ($40 for the team)");
    expect(priceDescription(cat({ price: null }))).toBeNull();
  });
});

describe("cardAmount", () => {
  it("adds 3% and rounds to the cent, matching the server", () => {
    expect(cardAmount(40)).toBe(41.2);
    expect(cardAmount(25)).toBe(25.75);
    expect(cardAmount(12.5)).toBe(12.88); // 1287.5 cents rounds up
    expect(cardAmount(20 * 2)).toBe(41.2); // pay for both, per player
    expect(cardAmount(0)).toBe(0);
  });
});
