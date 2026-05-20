import { describe, expect, it } from "vitest";
import { emptyFormState, hasMemberDiscount, isValid, validate } from "../validate";
import type { Category, TournamentFees } from "../../../types";

const singles: Category = {
  id: "s", tournament_id: "t", name: "Men's Singles", team_size: 1,
  match_minutes: 12, starts_at: null, phase: "none", rounds_per_pair: 1,
  groups_count: 0, top_n_advance: 0, sort_order: 0, created_at: "",
  age_band: "adult", allow_solo_signup: false,
};
const doubles: Category = { ...singles, id: "d", name: "MD", team_size: 2 };
const doublesSolo: Category = { ...doubles, id: "ds", allow_solo_signup: true };

const happyPath = () => ({
  ...emptyFormState(),
  player_email: "ashish@example.com",
  player_name: "Ashish Dawar",
  player_phone: "6041234567",
  player_is_member: true,
  category_id: "s",
  payment_reference: "ABC123",
});

describe("validate", () => {
  it("empty form fails every required field", () => {
    const errs = validate(emptyFormState(), null);
    expect(errs.player_email).toBeDefined();
    expect(errs.player_name).toBeDefined();
    expect(errs.player_phone).toBeDefined();
    expect(errs.player_is_member).toBeDefined();
    expect(errs.category_id).toBeDefined();
    expect(errs.payment_reference).toBeDefined();
  });

  it("rejects invalid email format", () => {
    const f = { ...happyPath(), player_email: "not-an-email" };
    expect(validate(f, singles).player_email).toBe("Invalid email");
  });

  it("rejects phone with fewer than 10 digits", () => {
    const f = { ...happyPath(), player_phone: "604123" };
    expect(validate(f, singles).player_phone).toBe("At least 10 digits");
  });

  it("happy path singles is valid", () => {
    expect(isValid(validate(happyPath(), singles))).toBe(true);
  });

  it("doubles without partner fails when allow_solo_signup=false", () => {
    const f = { ...happyPath(), category_id: "d" };
    const errs = validate(f, doubles);
    expect(errs.partner_name).toBeDefined();
    expect(errs.partner_email).toBeDefined();
    expect(errs.partner_phone).toBeDefined();
    expect(errs.partner_is_member).toBeDefined();
  });

  it("doubles with full partner data is valid", () => {
    const f = {
      ...happyPath(),
      category_id: "d",
      partner_name: "Summit Grover",
      partner_email: "summit@example.com",
      partner_phone: "6048320717",
      partner_is_member: false,
    };
    expect(isValid(validate(f, doubles))).toBe(true);
  });

  it("doubles with allow_solo_signup=true is valid without partner", () => {
    const f = { ...happyPath(), category_id: "ds" };
    expect(isValid(validate(f, doublesSolo))).toBe(true);
  });

  it("doubles with allow_solo_signup=true still validates partner email if provided", () => {
    const f = { ...happyPath(), category_id: "ds", partner_email: "bad" };
    expect(validate(f, doublesSolo).partner_email).toBe("Invalid email");
  });

  it("rejects identical submitter and partner emails", () => {
    const f = {
      ...happyPath(),
      category_id: "d",
      partner_name: "X",
      partner_email: "ashish@example.com",
      partner_phone: "6048320717",
      partner_is_member: true,
    };
    expect(validate(f, doubles).partner_email).toBe("Must differ from your email");
  });

  it("rejects comments over 500 chars", () => {
    const f = { ...happyPath(), comments: "x".repeat(501) };
    expect(validate(f, singles).comments).toBe("Max 500 characters");
  });

  it("does NOT require player_is_member when requireMembership=false", () => {
    const f = { ...emptyFormState(),
      player_email: "a@b.co", player_name: "A", player_phone: "6041234567",
      category_id: "s", payment_reference: "REF",
    };
    const errs = validate(f, singles, { requireMembership: false });
    expect(errs.player_is_member).toBeUndefined();
    expect(isValid(errs)).toBe(true);
  });

  it("does NOT require partner_is_member when requireMembership=false (doubles)", () => {
    const f = { ...emptyFormState(),
      player_email: "a@b.co", player_name: "A", player_phone: "6041234567",
      category_id: "d", payment_reference: "REF",
      partner_name: "P", partner_email: "p@b.co", partner_phone: "6049999999",
    };
    const errs = validate(f, doubles, { requireMembership: false });
    expect(errs.partner_is_member).toBeUndefined();
    expect(isValid(errs)).toBe(true);
  });
});

describe("hasMemberDiscount", () => {
  it("returns false for empty fees", () => {
    expect(hasMemberDiscount({} as TournamentFees)).toBe(false);
  });

  it("returns false when all bands have equal member and non_member", () => {
    const fees: TournamentFees = {
      adult: { member: 20, non_member: 20 },
      teen: { member: 15, non_member: 15 },
    };
    expect(hasMemberDiscount(fees)).toBe(false);
  });

  it("returns true when any band differs", () => {
    const fees: TournamentFees = {
      adult: { member: 20, non_member: 25 },
      teen: { member: 15, non_member: 15 },
    };
    expect(hasMemberDiscount(fees)).toBe(true);
  });
});
