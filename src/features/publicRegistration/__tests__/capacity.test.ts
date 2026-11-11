import { describe, expect, it } from "vitest";
import type { Category } from "../../../types";
import { overCapacityMessage, parseCapacity, spotsNeeded, spotsWord, urgencyLine } from "../capacity";
import { eventWhen, parseContacts, phoneHref, taglineText, waitlistErrors } from "../atCapacity";
import { emptyFlow, stepErrors, type FlowContext, type FlowState } from "../multiEntry";

const cat = (id: string, over: Partial<Category> = {}): Category => ({
  id, tournament_id: "t", name: id, team_size: 2, allow_solo_signup: true, price: 40, price_basis: "per_player",
  age_band: "adult", min_age: null, sort_order: 0, ...over,
} as Category);

const singles = cat("Men's Singles", { team_size: 1, allow_solo_signup: false });
const md = cat("Men's Doubles 18–34");
const xd = cat("Mixed Doubles 18–34");

describe("parseCapacity", () => {
  it("reads the RPC's answer and works out what's left", () => {
    expect(parseCapacity({ cap: 150, taken: 131, remaining: 19, full: false })).toEqual({ cap: 150, taken: 131, remaining: 19, full: false });
  });
  it("is full at or over the cap, never below zero left", () => {
    expect(parseCapacity({ cap: 150, taken: 150 })).toMatchObject({ remaining: 0, full: true });
    expect(parseCapacity({ cap: 150, taken: 152 })).toMatchObject({ remaining: 0, full: true });
  });
  it("means no cap for nulls, junk or nothing", () => {
    expect(parseCapacity({ cap: null, taken: null, remaining: null, full: false })).toBeNull();
    expect(parseCapacity(null)).toBeNull();
    expect(parseCapacity("150")).toBeNull();
    expect(parseCapacity({ cap: 0, taken: 0 })).toBeNull();
    expect(parseCapacity({ cap: 150, taken: -1 })).toBeNull();
  });
});

describe("spotsNeeded", () => {
  const cats = [singles, md, xd];
  it("counts two per doubles event and one per singles event", () => {
    expect(spotsNeeded(cats, [md.id])).toBe(2);
    expect(spotsNeeded(cats, [singles.id])).toBe(1);
    expect(spotsNeeded(cats, [md.id, xd.id, singles.id])).toBe(5);
  });
  it("counts nothing for the event whose share is being paid", () => {
    expect(spotsNeeded(cats, [md.id], md.id)).toBe(0);
    expect(spotsNeeded(cats, [md.id, singles.id], md.id)).toBe(1);
  });
  it("ignores events that no longer exist", () => {
    expect(spotsNeeded(cats, ["gone", singles.id])).toBe(1);
  });
});

describe("copy", () => {
  const c = (taken: number) => parseCapacity({ cap: 150, taken })!;
  it("gets more urgent as spots run out, with no hyphens or exclamation marks", () => {
    const lines = [100, 131, 140, 147, 149, 150].map((t) => urgencyLine(c(t)));
    expect(lines).toEqual([
      "Entries close for good at 150.",
      "Almost full. When these 19 go, entries close.",
      "Final 10 spots. When they're gone, entries close.",
      "Only 3 spots left. When they're gone, entries close.",
      "Last spot. When it's gone, entries close.",
      "All 150 spots are taken.",
    ]);
    for (const l of lines) expect(l).not.toMatch(/[!-]/);
  });
  it("explains a selection that doesn't fit", () => {
    expect(overCapacityMessage(3, 3)).toBeNull();
    expect(overCapacityMessage(2, 3)).toBe("Only 2 spots are left and your events need 3. A doubles event takes 2 (you and your partner), singles 1. Remove an event to continue.");
    expect(overCapacityMessage(1, 2)).toMatch(/^Only 1 spot is left/);
    expect(spotsWord(1)).toBe("spot");
    expect(spotsWord(0)).toBe("spots");
  });
});

describe("events step with a cap", () => {
  const ctx = (spotsLeft: number | null, payingShareFor: string | null = null): FlowContext => ({
    tournament: { id: "t", youth_price: 30, student_price: 30, waiver_text: "Waiver…", waiver_version: "v1" },
    categories: [singles, md, xd],
    payingShareFor,
    spotsLeft,
  });
  const flow = (ids: string[]): FlowState => ({
    ...emptyFlow(), player_name: "Gurmeet Singh", player_email: "g@example.com", player_phone: "6041234567", player_age: "30", category_ids: ids,
  });
  it("blocks picks that need more spots than are left", () => {
    expect(stepErrors("events", flow([md.id, singles.id]), ctx(2)).fields.events).toMatch(/^Only 2 spots are left and your events need 3/);
  });
  it("lets picks through that fit exactly, or when there is no cap", () => {
    expect(stepErrors("events", flow([md.id, singles.id]), ctx(3)).fields.events).toBeUndefined();
    expect(stepErrors("events", flow([md.id, xd.id, singles.id]), ctx(null)).fields.events).toBeUndefined();
  });
  it("doesn't count the event a partner is paying their share of", () => {
    expect(stepErrors("events", flow([md.id]), ctx(0, md.id)).fields.events).toBeUndefined();
  });
});

describe("parseContacts", () => {
  it("reads the directors' contact block", () => {
    const info = "Tournament directors\nAshish Dawar · 778 964 6999 · ashishdawar09@gmail.com\nDr. Rakesh Arya · 778 878 5015 · aryark@hotmail.com";
    expect(parseContacts(info)).toEqual({
      heading: "Tournament directors",
      people: [
        { name: "Ashish Dawar", phone: "778 964 6999", email: "ashishdawar09@gmail.com" },
        { name: "Dr. Rakesh Arya", phone: "778 878 5015", email: "aryark@hotmail.com" },
      ],
    });
  });
  it("copes with other separators, missing parts and nothing at all", () => {
    expect(parseContacts("Jas | jas@example.com").people).toEqual([{ name: "Jas", phone: null, email: "jas@example.com" }]);
    expect(parseContacts("Phone: 604-555-0123").people).toEqual([{ name: "604-555-0123", phone: "604-555-0123", email: null }]);
    expect(parseContacts(null)).toEqual({ heading: null, people: [] });
  });
  it("makes call and text links from the digits", () => {
    expect(phoneHref("tel", "778 964 6999")).toBe("tel:7789646999");
    expect(phoneHref("sms", "+1 (778) 964-6999")).toBe("sms:+17789646999");
  });
});

describe("waitlist form checks", () => {
  it("needs a name, a 10 to 15 digit number, a real email and an event", () => {
    expect(waitlistErrors({ name: "", phone: "", email: "", category_id: "" })).toEqual({
      name: "Enter your full name.", phone: "Enter your mobile number.", email: "Enter your email address.",
      category_id: "Choose the event you'd like to play.",
    });
    expect(waitlistErrors({ name: "Jas Gill", phone: "604555", email: "jas@", category_id: "c1" })).toEqual({
      phone: "Enter a mobile number with 10 to 15 digits.", email: "Enter an email address like name@example.com.",
    });
    expect(waitlistErrors({ name: "Jas Gill", phone: "6045550123", email: "jas@example.com", category_id: "c1" })).toEqual({});
  });
});

describe("tournament lines", () => {
  const t = { event_date: "2026-11-21", event_time: "09:30:00", venue_name: "UFV Athletic Centre – North Gym" };
  it("builds the tagline from the tournament's own data", () => {
    expect(taglineText(t, 150, 10)).toBe("150 entries. 10 events. One Saturday at UFV Athletic Centre. Thank you for filling every spot.");
    expect(taglineText({ event_date: null, venue_name: null }, 150, 1)).toBe("150 entries. 1 event. Thank you for filling every spot.");
  });
  it("says when it starts", () => {
    expect(eventWhen(t)).toBe("Saturday, November 21 from 9:30 am");
    expect(eventWhen({ event_date: "2026-11-21", event_time: null })).toBe("Saturday, November 21");
    expect(eventWhen({ event_date: null, event_time: "09:30:00" })).toBeNull();
  });
});
