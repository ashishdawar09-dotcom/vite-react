import { describe, expect, it } from "vitest";
import type { Category } from "../../../types";
import {
  buildPayload, emptyFlow, emptyPartner, entryFee, firstInvalidStep, hasErrors, stepErrors, stepsFor, totalFee,
  type FlowContext, type FlowState,
} from "../multiEntry";

const cat = (id: string, over: Partial<Category> = {}): Category => ({
  id, tournament_id: "t", name: id, team_size: 2, allow_solo_signup: true, price: 40, price_basis: "per_player",
  age_band: "adult", min_age: null, sort_order: 0, ...over,
} as Category);

const singles = cat("Men's Singles", { team_size: 1, allow_solo_signup: false });
const md = cat("Men's Doubles 18–34");
const md35 = cat("Men's Doubles 35+", { min_age: 35 });
const youth = cat("Youth Boys' Singles", { team_size: 1, allow_solo_signup: false, price: 30, age_band: "teen" });
const strict = cat("Strict Doubles", { allow_solo_signup: false });

const ctx = (over: Partial<FlowContext> = {}): FlowContext => ({
  tournament: { id: "t", youth_price: 30, student_price: 30, waiver_text: "Waiver…", waiver_version: "v1" },
  categories: [singles, md, md35, youth, strict],
  payingShareFor: null,
  ...over,
});

const player = (over: Partial<FlowState> = {}): FlowState => ({
  ...emptyFlow(),
  player_name: "Gurmeet Singh",
  player_email: "gurmeet@gmail.com",
  player_phone: "6041234567",
  player_age: "40",
  ...over,
});

const withPartner = (s: FlowState, id: string, p: Partial<ReturnType<typeof emptyPartner>>): FlowState => ({
  ...s, partners: { ...s.partners, [id]: { ...emptyPartner(), ...p } },
});

describe("steps", () => {
  it("skips the partner step when only singles are picked", () => {
    expect(stepsFor(player({ category_ids: [singles.id] }), ctx())).toEqual(["you", "events", "waiver", "pay"]);
    expect(stepsFor(player({ category_ids: [singles.id, md.id] }), ctx())).toEqual(["you", "events", "partners", "waiver", "pay"]);
  });
  it("skips the waiver step when the tournament has none", () => {
    const c = ctx({ tournament: { id: "t", youth_price: null, student_price: null, waiver_text: null, waiver_version: null } });
    expect(stepsFor(player({ category_ids: [singles.id] }), c)).toEqual(["you", "events", "pay"]);
  });
});

describe("fees", () => {
  it("adds up every event, each priced for this player", () => {
    const s = withPartner(player({ category_ids: [singles.id, md.id, md35.id] }), md.id, { mode: "solo" });
    expect(totalFee(withPartner(s, md35.id, { mode: "named", name: "Raj", age: "41" }), ctx())).toBe(120);
  });
  it("charges both shares when paying for the partner", () => {
    let s = player({ category_ids: [md.id] });
    s = withPartner(s, md.id, { mode: "named", name: "Raj", email: "raj@x.ca", phone: "6045550000", age: "30", split: "full" });
    expect(entryFee(s, md, ctx())).toBe(80);
    expect(totalFee(s, ctx())).toBe(80);
  });
  it("gives the student rate to an adult student, and the youth rate to under-18s", () => {
    expect(totalFee(player({ category_ids: [singles.id], player_age: "21", player_student: true }), ctx())).toBe(30);
    expect(totalFee(player({ category_ids: [youth.id], player_age: "15" }), ctx())).toBe(30);
  });
  it("ignores pay-for-both on a solo entry", () => {
    const s = withPartner(player({ category_ids: [md.id] }), md.id, { mode: "solo", split: "full" });
    expect(totalFee(s, ctx())).toBe(40);
  });
});

describe("step errors", () => {
  it("you: needs name, email and a full phone number", () => {
    const e = stepErrors("you", { ...emptyFlow(), player_phone: "604" }, ctx());
    expect(Object.keys(e.fields).sort()).toEqual(["player_email", "player_name", "player_phone"]);
    expect(hasErrors(stepErrors("you", player(), ctx()))).toBe(false);
  });
  it("events: needs an age and at least one event the player is old enough for", () => {
    expect(stepErrors("events", player({ player_age: "" }), ctx()).fields.player_age).toBeTruthy();
    expect(stepErrors("events", player(), ctx()).fields.events).toBe("Pick at least one event");
    const young = stepErrors("events", player({ player_age: "30", category_ids: [md35.id] }), ctx());
    expect(young.events[md35.id]).toMatch(/35 and over/);
    const old = stepErrors("events", player({ player_age: "40", category_ids: [youth.id] }), ctx());
    expect(old.events[youth.id]).toMatch(/13–17/);
  });
  it("partners: asks for a choice, then the partner's details", () => {
    const base = player({ category_ids: [md.id] });
    expect(stepErrors("partners", base, ctx()).partners[md.id]?.mode).toBe("Choose one");
    expect(hasErrors(stepErrors("partners", withPartner(base, md.id, { mode: "solo" }), ctx()))).toBe(false);
    expect(stepErrors("partners", withPartner(base, md.id, { mode: "named" }), ctx()).partners[md.id]?.partner_name).toBe("Required");
    // A name alone is enough when they pay their own share (as before)...
    expect(hasErrors(stepErrors("partners", withPartner(base, md.id, { mode: "named", name: "Raj" }), ctx()))).toBe(false);
    // ...but paying for both needs the partner's email, phone and age.
    const full = stepErrors("partners", withPartner(base, md.id, { mode: "named", name: "Raj", split: "full" }), ctx()).partners[md.id];
    expect(Object.keys(full ?? {}).sort()).toEqual(["partner_age", "partner_email", "partner_phone"]);
  });
  it("partners: events without solo entries always need a named partner with email", () => {
    const e = stepErrors("partners", player({ category_ids: [strict.id] }), ctx()).partners[strict.id];
    expect(e?.mode).toBeUndefined();
    expect(e?.partner_name).toBe("Required");
    expect(e?.partner_email).toBe("Required");
  });
  it("partners: in 35+ doubles a named partner must be 35+", () => {
    const s = withPartner(player({ category_ids: [md35.id] }), md35.id, { mode: "named", name: "Raj" });
    expect(stepErrors("partners", s, ctx()).partners[md35.id]?.partner_age).toMatch(/age/);
    const tooYoung = stepErrors("partners", withPartner(s, md35.id, { mode: "named", name: "Raj", age: "30" }), ctx());
    expect(tooYoung.partners[md35.id]?.partner_age).toMatch(/too young/);
  });
  it("waiver: the signature must match the player, or the guardian for under-19s", () => {
    const ok = player({ category_ids: [singles.id], accepted_rules: true, accepted_waiver: true, accepted_codes: true, signature: "gurmeet  singh" });
    expect(hasErrors(stepErrors("waiver", ok, ctx()))).toBe(false);
    const minor = { ...ok, player_age: "16", category_ids: [youth.id] };
    expect(stepErrors("waiver", minor, ctx()).fields.guardian_name).toBeTruthy();
    const signedByPlayer = stepErrors("waiver", { ...minor, guardian_name: "Harpreet Singh" }, ctx());
    expect(signedByPlayer.fields.signature).toMatch(/guardian/);
    expect(hasErrors(stepErrors("waiver", { ...minor, guardian_name: "Harpreet Singh", signature: "Harpreet Singh" }, ctx()))).toBe(false);
  });
  it("pay: e-Transfer needs the reference, card doesn't", () => {
    expect(stepErrors("pay", player(), ctx()).fields.payment_reference).toBe("Required");
    expect(hasErrors(stepErrors("pay", player({ payment_method: "card" }), ctx()))).toBe(false);
  });
  it("finds the first step that isn't complete", () => {
    expect(firstInvalidStep(player({ category_ids: [singles.id] }), ctx())).toBe("waiver");
  });
});

describe("payload", () => {
  it("sends one entry per event, with that event's partner", () => {
    let s = player({
      category_ids: [md35.id, singles.id, md.id],
      accepted_rules: true, accepted_waiver: true, accepted_codes: true, signature: "Gurmeet Singh",
      payment_reference: " CA123 ", comments: " see you ", heard_from: "friend",
    });
    s = withPartner(s, md35.id, { mode: "named", name: "Raj Patel", email: "raj@x.ca", phone: "6045550000", age: "44", split: "full" });
    s = withPartner(s, md.id, { mode: "solo" });
    const p = buildPayload(s, ctx(), { website: "", attribution: { utm_source: "meta" }, payMethod: "etransfer" });
    expect(p.category_id).toBeUndefined();
    // In the tournament's order, not the order they were ticked.
    expect(p.entries).toEqual([
      { category_id: singles.id },
      { category_id: md.id, payment_paid_full_for_partner: false },
      {
        category_id: md35.id, payment_paid_full_for_partner: true,
        partner_name: "Raj Patel", partner_email: "raj@x.ca", partner_phone: "6045550000", partner_age: 44, partner_student: false,
      },
    ]);
    expect(p).toMatchObject({
      tournament_id: "t", player_name: "Gurmeet Singh", player_email: "gurmeet@gmail.com", player_is_member: false,
      payment_method: "etransfer", payment_reference: "CA123", comments: "see you", heard_from: "friend",
      player_age: 40, player_student: false, attribution: { utm_source: "meta" },
    });
    expect(p.consent).toMatchObject({ signature: "Gurmeet Singh", accepted_waiver: true, waiver_version: "v1", guardian_name: undefined });
  });
  it("sends a named partner's age in 35+ doubles even when they pay their own share", () => {
    const s = withPartner(player({ category_ids: [md35.id] }), md35.id, { mode: "named", name: "Raj", age: "50" });
    const p = buildPayload(s, ctx(), { website: "", attribution: undefined, payMethod: "card" });
    expect(p.entries?.[0]).toEqual({ category_id: md35.id, payment_paid_full_for_partner: false, partner_name: "Raj", partner_age: 50 });
    expect(p.payment_reference).toBeUndefined();
  });
  it("claims the student rate only where it's offered", () => {
    const s = player({ category_ids: [singles.id], player_age: "21", player_student: true });
    expect(buildPayload(s, ctx(), { website: "", attribution: undefined, payMethod: "card" }).player_student).toBe(true);
    const noStudentRate = ctx({ tournament: { id: "t", youth_price: 30, student_price: null, waiver_text: "W", waiver_version: "v1" } });
    expect(buildPayload(s, noStudentRate, { website: "", attribution: undefined, payMethod: "card" }).player_student).toBe(false);
  });
});
