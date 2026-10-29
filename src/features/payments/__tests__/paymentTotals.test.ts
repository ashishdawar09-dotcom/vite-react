import { describe, expect, it } from "vitest";
import { paymentNotes, paymentTotals } from "../paymentTotals";

type R = Parameters<typeof paymentTotals>[0][number];
const row = (o: Partial<R> & { id: string; player_email: string }): R => ({
  category_id: "mixed", status: "approved", approved_team_id: null, partner_name: null, partner_email: null,
  payment_method: "etransfer", amount_due_cents: 4000, payment_paid_full_for_partner: false, ...o,
});

// Ana and Ben each paid their own share: two payments, one team.
const ana = row({ id: "a", player_email: "ana@x.com", partner_name: "Ben", partner_email: "ben@x.com", approved_team_id: "t1" });
const ben = row({ id: "b", player_email: "Ben@x.com", partner_name: "Ana", partner_email: "ana@x.com", approved_team_id: "t1", payment_method: "card", amount_due_cents: 4120 });
// Cy paid for both of a pair.
const cy = row({ id: "c", player_email: "cy@x.com", partner_name: "Di", partner_email: "di@x.com", approved_team_id: "t2", amount_due_cents: 8000, payment_paid_full_for_partner: true });
// A singles entry and a solo doubles entry: no team, no partner.
const ed = row({ id: "d", category_id: "singles", player_email: "ed@x.com" });
const flo = row({ id: "e", player_email: "flo@x.com" });

const categories = [
  { id: "mixed", team_size: 2 as const, price_basis: "per_player" as const },
  { id: "mens", team_size: 2 as const, price_basis: "per_player" as const },
  { id: "singles", team_size: 1 as const, price_basis: "per_player" as const },
  { id: "team-priced", team_size: 2 as const, price_basis: "per_team" as const },
];

describe("paymentTotals", () => {
  it("counts a pair who paid separately as one entry and two payments", () => {
    expect(paymentTotals([ana, ben])).toMatchObject({ entries: 1, players: 2, payments: 2, total: 8120, etransfer: 4000, card: 4120 });
  });

  it("counts everything else as before", () => {
    expect(paymentTotals([ana, ben, cy, ed, flo])).toMatchObject({ entries: 4, players: 6, payments: 5, total: 24120 });
  });

  it("still counts the pair once after their team is deleted", () => {
    const noTeam = [{ ...ana, approved_team_id: null }, { ...ben, approved_team_id: null }];
    expect(paymentTotals(noTeam)).toMatchObject({ entries: 1, payments: 2 });
  });

  it("counts a player in two events once", () => {
    const anaMens = row({ id: "f", category_id: "mens", player_email: "ANA@x.com ", partner_name: "Gus", partner_email: "gus@x.com", approved_team_id: "t3" });
    expect(paymentTotals([ana, ben, anaMens])).toMatchObject({ entries: 2, players: 3, payments: 3 });
  });

  it("still counts a named partner without an email", () => {
    expect(paymentTotals([row({ id: "g", player_email: "hal@x.com", partner_name: "Ivy" })])).toMatchObject({ entries: 1, players: 2 });
  });

  it("is all zeros with nothing approved", () => {
    expect(paymentTotals([])).toEqual({ entries: 0, players: 0, payments: 0, total: 0, etransfer: 0, card: 0 });
  });
});

describe("solo halves", () => {
  // Bea entered solo; Al then named her.
  const bea = row({ id: "s1", player_email: "bea@x.com" });
  const alOwn = row({ id: "s2", player_email: "al@x.com", partner_name: "Bea", partner_email: "Bea@x.com", approved_team_id: "t9" });

  it("counts a solo entry and the entry naming that player as one entry", () => {
    expect(paymentTotals([bea, alOwn])).toMatchObject({ entries: 1, players: 2, payments: 2 });
    expect(Object.fromEntries(paymentNotes([bea, alOwn], [bea, alOwn], categories))).toEqual({ s1: "paid separately", s2: "paid separately" });
  });

  it("flags a share paid twice when the entry naming them paid for both", () => {
    const alBoth = { ...alOwn, payment_paid_full_for_partner: true, amount_due_cents: 8000 };
    expect(Object.fromEntries(paymentNotes([bea, alBoth], [bea, alBoth], categories))).toEqual({ s1: "share paid twice", s2: "share paid twice" });
  });
});

describe("paymentNotes", () => {
  const notesFor = (approved: R[], pending: R[] = []) =>
    Object.fromEntries(paymentNotes(approved, [...approved, ...pending], categories));

  it("marks a pair who each paid their own share", () => {
    expect(notesFor([ana, ben, cy, ed])).toEqual({ a: "paid separately", b: "paid separately", c: "paid for both" });
  });

  it("marks both payments when one of them had paid for both", () => {
    const benBoth = { ...ben, payment_paid_full_for_partner: true, amount_due_cents: 8240 };
    expect(notesFor([ana, benBoth])).toEqual({ a: "share paid twice", b: "share paid twice" });
  });

  it("flags an own-share entry whose partner hasn't registered", () => {
    expect(notesFor([ana])).toEqual({ a: "partner's share not paid yet" });
  });

  it("doesn't flag it once the partner has an entry, even one awaiting approval or a solo one", () => {
    expect(notesFor([ana], [{ ...ben, status: "pending" }])).toEqual({});
    expect(notesFor([ana], [row({ id: "s", player_email: "ben@x.com" })])).toEqual({});
  });

  it("doesn't flag paid-for-both, per-team or singles entries", () => {
    const perTeam = row({ id: "p", category_id: "team-priced", player_email: "jo@x.com", partner_name: "Kim", partner_email: "kim@x.com" });
    expect(notesFor([cy, perTeam, ed])).toEqual({ c: "paid for both" });
  });

  it("only counts the partner's entry in the same event", () => {
    const benMens = row({ id: "m", category_id: "mens", player_email: "ben@x.com" });
    expect(notesFor([ana, benMens])).toEqual({ a: "partner's share not paid yet" });
  });
});
