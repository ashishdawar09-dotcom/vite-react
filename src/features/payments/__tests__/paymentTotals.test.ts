import { describe, expect, it } from "vitest";
import { paymentTotals, splitPaidTeams } from "../paymentTotals";

type R = Parameters<typeof paymentTotals>[0][number];
const row = (o: Partial<R> & { id: string; player_email: string }): R => ({
  approved_team_id: null, partner_name: null, partner_email: null, payment_method: "etransfer", amount_due_cents: 4000, ...o,
});

// Ana and Ben each paid their own share: two payments, one team.
const ana = row({ id: "a", player_email: "ana@x.com", partner_name: "Ben", partner_email: "ben@x.com", approved_team_id: "t1" });
const ben = row({ id: "b", player_email: "Ben@x.com", partner_name: "Ana", partner_email: "ana@x.com", approved_team_id: "t1", payment_method: "card", amount_due_cents: 4120 });
// Cy paid for both of a pair.
const cy = row({ id: "c", player_email: "cy@x.com", partner_name: "Di", partner_email: "di@x.com", approved_team_id: "t2", amount_due_cents: 8000 });
// A singles entry and a solo doubles entry: no team.
const ed = row({ id: "d", player_email: "ed@x.com" });
const flo = row({ id: "e", player_email: "flo@x.com" });

describe("paymentTotals", () => {
  it("counts a pair who paid separately as one entry and two payments", () => {
    expect(paymentTotals([ana, ben])).toMatchObject({ entries: 1, players: 2, payments: 2, total: 8120, etransfer: 4000, card: 4120 });
  });

  it("counts everything else as before", () => {
    expect(paymentTotals([ana, ben, cy, ed, flo])).toMatchObject({ entries: 4, players: 6, payments: 5, total: 24120 });
  });

  it("counts a player in two events once", () => {
    const anaMixed = row({ id: "f", player_email: "ANA@x.com ", partner_name: "Gus", partner_email: "gus@x.com", approved_team_id: "t3" });
    expect(paymentTotals([ana, ben, anaMixed])).toMatchObject({ entries: 2, players: 3, payments: 3 });
  });

  it("still counts a named partner without an email", () => {
    expect(paymentTotals([row({ id: "g", player_email: "hal@x.com", partner_name: "Ivy" })])).toMatchObject({ entries: 1, players: 2 });
  });

  it("is all zeros with nothing approved", () => {
    expect(paymentTotals([])).toEqual({ entries: 0, players: 0, payments: 0, total: 0, etransfer: 0, card: 0 });
  });
});

describe("splitPaidTeams", () => {
  it("finds only teams with more than one payment", () => {
    expect([...splitPaidTeams([ana, ben, cy, ed])]).toEqual(["t1"]);
  });
});
