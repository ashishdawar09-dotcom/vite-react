import { describe, expect, it } from "vitest";
import { finalScorePatch } from "../scoring";

describe("finalScorePatch (report blocker 4)", () => {
  it("decides the winner from the scores it is given and writes them with the winner", () => {
    const r = finalScorePatch({ team_a_id: "A", team_b_id: "B" }, 15, 21, "2026-11-21T18:00:00.000Z");
    expect(r).toEqual({
      ok: true,
      winnerId: "B",
      patch: { score_a: 15, score_b: 21, winner_id: "B", confirmed: true, status: "completed", confirmed_at: "2026-11-21T18:00:00.000Z" },
    });
  });

  it("refuses 0-0 and ties", () => {
    expect(finalScorePatch({ team_a_id: "A", team_b_id: "B" }, 0, 0, "t")).toEqual({ ok: false, reason: "no-score" });
    expect(finalScorePatch({ team_a_id: "A", team_b_id: "B" }, 21, 21, "t")).toEqual({ ok: false, reason: "tie" });
  });

  it("treats a blank side as 0", () => {
    const r = finalScorePatch({ team_a_id: "A", team_b_id: "B" }, null, 18, "t");
    expect(r.ok && r.patch.score_a).toBe(0);
    expect(r.ok && r.winnerId).toBe("B");
  });
});

describe("timeOverPickerOpen (review N1)", () => {
  it("only shows the walkover/winner picker on a live, unconfirmed match", async () => {
    const { timeOverPickerOpen } = await import("../scoring");
    expect(timeOverPickerOpen({ status: "live", confirmed: false }, "winner")).toBe(true);
    expect(timeOverPickerOpen({ status: "live", confirmed: false }, null)).toBe(false);
    // Confirmed by this scorer or another admin while the picker was open.
    expect(timeOverPickerOpen({ status: "completed", confirmed: true }, "winner")).toBe(false);
    // Rescheduled or cancelled.
    expect(timeOverPickerOpen({ status: "pending", confirmed: false }, "walkover")).toBe(false);
  });
});
