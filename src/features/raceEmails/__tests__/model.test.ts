import { describe, expect, it } from "vitest";
import { briefingCounts, courtCallSettled, summarizeCourtCall, type EmailLogRow } from "../model";

const names = new Map([["p1", "Amar"], ["p2", "Raj"], ["p3", "Kim"], ["p4", "Jo"]]);
const at = "2026-11-21T17:00:00.000Z";
const row = (player_id: string, over: Partial<EmailLogRow> = {}): EmailLogRow => ({
  player_id, status: "sent", error_message: null, delivery_status: null, delivery_detail: null,
  sent_at: "2026-11-21T17:00:02.000Z", ...over,
});
const now = Date.parse("2026-11-21T17:00:30.000Z");

describe("summarizeCourtCall", () => {
  it("waits for the first minute, then says nothing went out", () => {
    expect(summarizeCourtCall([], at, names, now)).toEqual({ kind: "waiting" });
    expect(summarizeCourtCall([], at, names, Date.parse("2026-11-21T17:01:30Z"))).toEqual({ kind: "none" });
    expect(courtCallSettled({ kind: "none" })).toBe(true);
  });

  it("counts delivered and delayed while waiting on the rest", () => {
    const s = summarizeCourtCall([
      row("p1", { delivery_status: "delivered" }), row("p2", { delivery_status: "delivery_delayed" }), row("p3"), row("p4", { delivery_status: "delivered" }),
    ], at, names, now);
    expect(s).toEqual({ kind: "ok", delivered: 2, total: 4, delayed: 1 });
    expect(courtCallSettled(s)).toBe(false);
    const all = summarizeCourtCall(["p1", "p2", "p3", "p4"].map(p => row(p, { delivery_status: "delivered" })), at, names, now);
    expect(courtCallSettled(all)).toBe(true);
  });

  it("names every player the call didn't reach", () => {
    const s = summarizeCourtCall([
      row("p1", { delivery_status: "bounced", delivery_detail: "Mailbox full" }),
      row("p2", { status: "failed", error_message: "429 quota" }),
      row("p3", { status: "skipped", error_message: "no email on file" }),
      row("p4", { delivery_status: "suppressed" }),
      row("p9", { delivery_status: "complained" }),
    ], at, names, now);
    expect(s).toEqual({
      kind: "problem", total: 5, problems: [
        { name: "Amar", reason: "bounced" },
        { name: "Raj", reason: "couldn't send" },
        { name: "Kim", reason: "no email on file" },
        { name: "Jo", reason: "blocked (bounced before)" },
        { name: "A player", reason: "marked as spam" },
      ],
    });
    expect(courtCallSettled(s)).toBe(false);
  });

  it("ignores an earlier allocation of the same match and keeps each player's latest row", () => {
    const s = summarizeCourtCall([
      row("p1", { sent_at: "2026-11-21T16:20:00.000Z", delivery_status: "bounced" }), // last time this match was called
      row("p1", { sent_at: "2026-11-21T17:00:01.000Z", status: "failed" }),
      row("p1", { sent_at: "2026-11-21T17:00:03.000Z", delivery_status: "delivered" }), // a retry that worked
    ], at, names, now);
    expect(s).toEqual({ kind: "ok", delivered: 1, total: 1, delayed: 0 });
  });
});

describe("briefingCounts", () => {
  const b = (player_id: string, over: Record<string, unknown> = {}) => ({
    player_id, kind: "day_before", status: "sent", error_message: null, scheduled_at: null,
    delivery_status: null, delivery_detail: null, ...over,
  });
  it("tallies one kind and lists the problems", () => {
    const c = briefingCounts([
      b("p1", { delivery_status: "delivered" }),
      b("p2", { delivery_status: "bounced", delivery_detail: "No such user" }),
      b("p3", { status: "failed", error_message: "422 bad address" }),
      b("p4", { kind: "morning_of", status: "scheduled", scheduled_at: "2026-11-21T14:00:00.000Z" }),
      b("p1", { kind: "morning_of", status: "scheduled", scheduled_at: "2026-11-21T13:30:00.000Z" }),
      b("p2", { kind: "morning_of", status: "cancelled" }),
    ], "day_before");
    expect(c).toMatchObject({ sent: 2, failed: 1, delivered: 1, scheduled: 0 });
    expect(c.problems).toEqual([
      { player_id: "p2", reason: "bounced: No such user" },
      { player_id: "p3", reason: "couldn't send (422 bad address)" },
    ]);
    const m = briefingCounts([
      b("p4", { kind: "morning_of", status: "scheduled", scheduled_at: "2026-11-21T14:00:00.000Z" }),
      b("p1", { kind: "morning_of", status: "scheduled", scheduled_at: "2026-11-21T13:30:00.000Z" }),
      b("p2", { kind: "morning_of", status: "cancelled" }),
    ], "morning_of");
    expect(m).toMatchObject({ scheduled: 2, cancelled: 1, scheduledFor: "2026-11-21T13:30:00.000Z" });
  });
});
