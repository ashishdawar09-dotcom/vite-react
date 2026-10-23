import { describe, expect, it } from "vitest";
import { emptyFormState, isValid, validate } from "../validate";
import type { Category } from "../../../types";

const singles: Category = {
  id: "s", tournament_id: "t", name: "Men's Singles", team_size: 1,
  match_minutes: 12, starts_at: null, phase: "none", rounds_per_pair: 1,
  groups_count: 0, top_n_advance: 0, sort_order: 0, created_at: "",
  age_band: "adult", allow_solo_signup: false, has_bronze_match: false,
  price: null, price_basis: "per_player",
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

describe("payment method", () => {
  it("requires an e-transfer reference only for e-transfer", () => {
    const base = { ...happyPath(), payment_reference: "" };
    expect(validate({ ...base, payment_method: "etransfer" }, singles).payment_reference).toBe("Required");
    expect(validate({ ...base, payment_method: "card" }, singles).payment_reference).toBeUndefined();
  });
});

describe("waiver and age", () => {
  const base = () => ({
    ...emptyFormState(),
    player_email: "a@b.co", player_name: "Sam Lee", player_phone: "6041234567",
    category_id: "c1", payment_reference: "REF1",
  });
  const opts = { requireMembership: false, requireAge: true, requireWaiver: true };

  it("requires age, all three acceptances and a signature", () => {
    const errs = validate(base(), null, opts);
    expect(errs.player_age).toBeDefined();
    expect(errs.accepted_rules).toBe("Required");
    expect(errs.accepted_waiver).toBe("Required");
    expect(errs.accepted_codes).toBe("Required");
    expect(errs.signature).toBeDefined();
  });

  it("an adult signs with their own name, case and spacing ignored", () => {
    const f = { ...base(), player_age: "30", accepted_rules: true, accepted_waiver: true, accepted_codes: true, signature: "  sam   LEE " };
    expect(validate(f, null, opts)).toEqual({});
    expect(validate({ ...f, signature: "Someone Else" }, null, opts).signature).toBe("Must match the player name above");
  });

  it("under 19 needs a parent or guardian, who signs", () => {
    const f = { ...base(), player_age: "18", accepted_rules: true, accepted_waiver: true, accepted_codes: true, signature: "Sam Lee" };
    expect(validate(f, null, opts).guardian_name).toBe("Required for players under 19");
    const g = { ...f, guardian_name: "Pat Lee", signature: "Pat Lee" };
    expect(validate(g, null, opts)).toEqual({});
  });

  it("asks for the partner's age only when it prices their share", () => {
    const f = { ...base(), player_age: "30" };
    expect(validate(f, null, { requireMembership: false, requireAge: true }).partner_age).toBeUndefined();
    expect(validate(f, null, { requireMembership: false, requireAge: true, requirePartnerAge: true }).partner_age).toBeDefined();
  });
});

describe("category age bands", () => {
  const boys: Category = { ...singles, id: "b", name: "Boys' Singles", age_band: "kid" };
  const youth: Category = { ...singles, id: "y", name: "Youth Boys' Singles", age_band: "teen" };

  it("rejects a 15-year-old in a junior (8–12) event and suggests youth", () => {
    const errs = validate({ ...happyPath(), category_id: "b", player_age: "15" }, boys);
    expect(errs.category_id).toMatch(/ages 8–12.*youth category/);
  });

  it("accepts the right age, and lets younger players play up", () => {
    expect(validate({ ...happyPath(), category_id: "b", player_age: "11" }, boys).category_id).toBeUndefined();
    expect(validate({ ...happyPath(), category_id: "y", player_age: "15" }, youth).category_id).toBeUndefined();
    expect(validate({ ...happyPath(), category_id: "s", player_age: "15" }, singles).category_id).toBeUndefined();
  });
});

describe("minimum-age doubles (35+)", () => {
  const md35: Category = { ...doublesSolo, id: "m35", name: "Men's Doubles 35+", min_age: 35 };
  const md1834: Category = { ...doublesSolo, id: "m18", name: "Men's Doubles 18–34" };
  const pair = (playerAge: string, partnerAge: string) => ({
    ...happyPath(), category_id: "m35", player_age: playerAge, partner_age: partnerAge,
    partner_name: "Raj Singh", partner_email: "raj@example.com", partner_phone: "6049876543",
    partner_is_member: true,
  });

  it("accepts 35 and over, with no upper limit", () => {
    expect(validate(pair("35", "35"), md35).category_id).toBeUndefined();
    expect(validate(pair("54", "61"), md35)).toEqual({});
  });

  it("rejects a player under 35", () => {
    expect(validate(pair("34", "40"), md35).category_id).toMatch(/35 and over/);
  });

  it("needs and checks the named partner's age: the younger partner decides", () => {
    expect(validate(pair("40", ""), md35).partner_age).toMatch(/partner's age/);
    expect(validate(pair("46", "28"), md35).partner_age).toMatch(/both partners must be 35\+/);
  });

  it("a solo entry is checked on the player's own age only", () => {
    const solo = { ...happyPath(), category_id: "m35", player_age: "46" };
    expect(validate(solo, md35)).toEqual({});
  });

  it("anyone can enter 18–34, including older players", () => {
    expect(validate({ ...pair("46", "28"), category_id: "m18" }, md1834)).toEqual({});
  });
});
