// Result options from the start of a match, Undo result and Replace team (Ashish, Nov 15 2026).
import { describe, expect, it } from "vitest";
import type { Match } from "../../types";
import { applyPlan, planKnockoutAdvance, type KnockoutPlan } from "../knockout";
import { finalScorePatch } from "../scoring";
import { stopEarlyPatch } from "../bestOf3";
import { planSitOut } from "../sitOut";
import { behindWarning, pickedFields, pickedWinnerPatch, planUndoResult, resultConfirmText, resultOptions, retiredFields, retiredPatch, undoRefusedText, walkoverFields, walkoverPatch } from "../resultOptions";
import { countsForPoints, groupStandings } from "../groups";
import { resultLabel } from "../matchOutcome";
import { planReplaceGroup, planReplaceKnockout } from "../replaceTeam";

let n = 0;
const M = (p: Partial<Match>): Match => ({
  id: `m${++n}`, tournament_id: "t", category_id: "C", stage: "knockout", group_idx: null, round_idx: 0, slot_idx: 0,
  team_a_id: null, team_b_id: null, score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false,
  is_walkover: false, is_retired: false, status: "pending", started_at: null, scheduled_at: null, confirmed_at: null,
  court_number: null, court_allocated_at: null, queue_position: null, extended_minutes: 0, is_bronze: false, best_of: 1, games: null, ...p,
});
const T = "2026-11-21T20:00:00Z";
const applyTo = async (rows: Match[], plan: KnockoutPlan) => {
  const byId = new Map(rows.map(r => [r.id, r]));
  await applyPlan(plan, async (id, patch) => { byId.set(id, { ...byId.get(id)!, ...patch }); });
  return rows.map(r => byId.get(r.id)!);
};

// A bracket: QF0 (X v Z) and QF1 (P v Q) feed SF0.
const bracket = () => {
  const qf0 = M({ round_idx: 0, slot_idx: 0, team_a_id: "X", team_b_id: "Z" });
  const qf1 = M({ round_idx: 0, slot_idx: 1, team_a_id: "P", team_b_id: "Q" });
  const sf = M({ round_idx: 1, slot_idx: 0 });
  return { qf0, qf1, sf };
};

describe("result options", () => {
  it("offers Walkover before play, all three during play, nothing after", () => {
    expect(resultOptions(M({ team_a_id: "A", team_b_id: "B" }))).toEqual(["walkover"]);
    expect(resultOptions(M({ team_a_id: "A", team_b_id: "B", court_number: 2, court_allocated_at: T }))).toEqual(["walkover"]);
    expect(resultOptions(M({ team_a_id: "A", team_b_id: "B", status: "live" }))).toEqual(["walkover", "retired", "winner"]);
    expect(resultOptions(M({ team_a_id: "A", team_b_id: "B", status: "completed", confirmed: true }))).toEqual([]);
    expect(resultOptions(M({ team_a_id: "A", team_b_id: null }))).toEqual([]);
    expect(resultOptions(M({ team_a_id: "A", is_bye: true, confirmed: true, status: "completed" }))).toEqual([]);
  });
  it("walkover keeps no score and frees a warming court", () => {
    const m = M({ team_a_id: "A", team_b_id: "B", court_number: 3, court_allocated_at: T });
    expect(walkoverPatch(m, "B", T)).toMatchObject({ winner_id: "B", is_walkover: true, score_a: null, score_b: null, court_number: null, court_allocated_at: null });
    expect(walkoverPatch(m, "Nobody", T)).toBeNull();
  });
  it("retired: the other side wins with the score so far, even from behind", () => {
    const m = M({ team_a_id: "A", team_b_id: "B", status: "live" });
    expect(retiredPatch(m, "A", { a: 10, b: 5 }, T)).toMatchObject({ winner_id: "B", score_a: 10, score_b: 5, is_retired: true, is_walkover: false });
    expect(behindWarning(m, "B", { a: 10, b: 5 })).toBe("behind 5–10");
    expect(retiredPatch(M({ team_a_id: "A", team_b_id: "B" }), "A", { a: 1, b: 0 }, T)).toBeNull();   // not before play
  });
  it("retired in a best-of-3 final writes games won, like Select Winner at time over", () => {
    const m = M({ team_a_id: "A", team_b_id: "B", status: "live", best_of: 3, games: [[15, 9]], score_a: 3, score_b: 8 });
    const p = retiredPatch(m, "A", { a: 3, b: 8 }, T, stopEarlyPatch(m))!;
    expect(p.winner_id).toBe("B");
    expect(p.is_retired).toBe(true);
    expect([p.score_a, p.score_b]).toEqual([1, 0]);   // games won: A had won game 1
  });
  it("select winner warns when the pick is behind, never refuses", () => {
    const m = M({ team_a_id: "A", team_b_id: "B", status: "live" });
    expect(behindWarning(m, "A", { a: 9, b: 12 })).toBe("behind 9–12");
    expect(behindWarning(m, "B", { a: 9, b: 12 })).toBeNull();
    expect(pickedWinnerPatch(m, "A", { a: 9, b: 12 }, T)).toMatchObject({ winner_id: "A", score_a: 9, score_b: 12 });
  });
});

describe("undo result", () => {
  it("puts a knockout walkover back and empties the next slot", async () => {
    const { qf0, qf1, sf } = bracket();
    let rows = [qf0, qf1, sf];
    const adv = planKnockoutAdvance(rows, qf0, "X");
    rows = await applyTo(rows, { updates: [{ id: qf0.id, patch: walkoverPatch(qf0, "X", T)! }, ...adv.updates], cleared: [] });
    expect(rows[2].team_a_id).toBe("X");
    const u = planUndoResult(rows, rows[0]);
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    rows = await applyTo(rows, u.plan);
    expect(rows[0]).toMatchObject({ winner_id: null, confirmed: false, status: "pending", is_walkover: false, is_retired: false, score_a: null });
    expect(rows[2].team_a_id).toBeNull();
  });
  it("asks before resetting a next-round match that already started", async () => {
    const { qf0, qf1, sf } = bracket();
    let rows = [{ ...qf0, winner_id: "X", confirmed: true, status: "completed" as const, is_walkover: true }, qf1,
      { ...sf, team_a_id: "X", team_b_id: "P", status: "live" as const, started_at: T, court_number: 1 }];
    const u = planUndoResult(rows, rows[0]);
    expect(u.ok && u.plan.cleared.map(m => m.id)).toEqual([sf.id]);
    if (u.ok) rows = await applyTo(rows, u.plan);
    expect(rows[2]).toMatchObject({ team_a_id: null, team_b_id: "P", status: "pending", court_number: null });
  });
  it("refuses byes, group matches once the knockout exists, and a next slot holding a replacement", () => {
    const bye = M({ team_a_id: "A", is_bye: true, confirmed: true, status: "completed", winner_id: "A" });
    expect(planUndoResult([bye], bye)).toMatchObject({ ok: false, reason: "bye" });
    const g = M({ stage: "group", group_idx: 0, round_idx: null, team_a_id: "A", team_b_id: "B", confirmed: true, status: "completed", winner_id: "A" });
    expect(planUndoResult([g], g).ok).toBe(true);
    expect(planUndoResult([g, M({ team_a_id: "A", team_b_id: "C" })], g)).toMatchObject({ ok: false, reason: "knockout-started" });
    const { qf0, qf1, sf } = bracket();
    const rows = [{ ...qf0, winner_id: "X", confirmed: true, status: "completed" as const }, qf1, { ...sf, team_a_id: "Y" }];
    expect(planUndoResult(rows, rows[0])).toMatchObject({ ok: false, reason: "replacement-next" });
  });
});

describe("replace team", () => {
  it("knockout: swaps one slot of an unplayed match; played results never change", () => {
    const { qf0, qf1, sf } = bracket();
    const rows = [{ ...qf0, winner_id: "X", confirmed: true, status: "completed" as const, score_a: 15, score_b: 9 }, qf1, { ...sf, team_a_id: "X" }];
    const r = planReplaceKnockout(rows, rows[2], "team_a_id", "Z", "C");    // lucky loser Z replaces X in the SF
    expect(r.ok && r.plan.updates).toEqual([{ id: sf.id, patch: { team_a_id: "Z" } }]);
  });
  it("correcting the QF score (same winner) keeps the replacement and leaves a live SF alone", async () => {
    // Before Nov 15 this put X back into the SF and reset the live match.
    const { qf0, qf1, sf } = bracket();
    let rows = [{ ...qf0, winner_id: "X", confirmed: true, status: "completed" as const, score_a: 15, score_b: 9 }, qf1,
      { ...sf, team_a_id: "Y", team_b_id: "P", status: "live" as const, started_at: T, court_number: 2, score_a: 6, score_b: 4 }];
    const fs = finalScorePatch(rows[0], 15, 12, T);
    if (!fs.ok) throw new Error("x");
    const guarded = planKnockoutAdvance(rows, rows[0], fs.winnerId);
    expect(guarded).toEqual({ updates: [], cleared: [] });
    rows = await applyTo(rows, guarded);
    expect(rows[2]).toMatchObject({ team_a_id: "Y", status: "live", score_a: 6 });
  });
  it("a corrected QF with a DIFFERENT winner still moves the real winner on (with the usual question)", () => {
    const { qf0, qf1, sf } = bracket();
    const rows = [{ ...qf0, winner_id: "X", confirmed: true, status: "completed" as const, score_a: 15, score_b: 9 }, qf1, { ...sf, team_a_id: "Y" }];
    const p = planKnockoutAdvance(rows, rows[0], "Z");
    expect(p.updates).toEqual([{ id: sf.id, patch: { team_a_id: "Z" } }]);
  });
  it("an empty next slot is still filled when a result is re-confirmed (repairs a lost advance)", () => {
    const { qf0, qf1, sf } = bracket();
    const rows = [{ ...qf0, winner_id: "X", confirmed: true, status: "completed" as const }, qf1, sf];
    expect(planKnockoutAdvance(rows, rows[0], "X").updates).toEqual([{ id: sf.id, patch: { team_a_id: "X" } }]);
  });
  it("a team that came through a bye: the bye row moves with the slot", () => {
    const bye = M({ round_idx: 0, slot_idx: 0, team_a_id: "S1", is_bye: true, confirmed: true, status: "completed", winner_id: "S1" });
    const qf = M({ round_idx: 0, slot_idx: 1, team_a_id: "P", team_b_id: "Q" });
    const sf = M({ round_idx: 1, slot_idx: 0, team_a_id: "S1" });
    const r = planReplaceKnockout([bye, qf, sf], sf, "team_a_id", "NEW", "C");
    expect(r.ok && r.plan.updates).toEqual([
      { id: bye.id, patch: { team_a_id: "NEW", winner_id: "NEW" } },
      { id: sf.id, patch: { team_a_id: "NEW" } },
    ]);
  });
  it("refuses: on court or live, already played, another event, still in the draw, sitting out, a bye row", () => {
    const { qf0, qf1, sf } = bracket();
    const rows = [qf0, qf1, sf];
    expect(planReplaceKnockout(rows, { ...qf0, court_number: 1, court_allocated_at: T }, "team_a_id", "N", "C")).toMatchObject({ reason: "in-play" });
    expect(planReplaceKnockout(rows, { ...qf0, status: "live" }, "team_a_id", "N", "C")).toMatchObject({ reason: "in-play" });
    expect(planReplaceKnockout(rows, { ...qf0, confirmed: true, status: "completed", winner_id: "X" }, "team_a_id", "N", "C")).toMatchObject({ reason: "already-played" });
    expect(planReplaceKnockout(rows, qf0, "team_a_id", "N", "OTHER")).toMatchObject({ reason: "wrong-category" });
    expect(planReplaceKnockout(rows, qf0, "team_a_id", "P", "C")).toMatchObject({ reason: "still-in-draw" });
    expect(planReplaceKnockout(rows, qf0, "team_a_id", "N", "C", () => true)).toMatchObject({ reason: "sitting-out" });
    expect(planReplaceKnockout(rows, sf, "team_a_id", "N", "C")).toMatchObject({ reason: "empty-slot" });
  });
  it("group: swaps every match of a team that hasn't played; refuses once it has", () => {
    const g = (a: string, b: string, p: Partial<Match> = {}) => M({ stage: "group", group_idx: 0, round_idx: null, team_a_id: a, team_b_id: b, ...p });
    const rows = [g("A", "B"), g("A", "C"), g("B", "C")];
    const r = planReplaceGroup(rows, "C", "A", "N", "C");
    expect(r.ok && r.plan.updates.map(u => u.patch)).toEqual([{ team_a_id: "N" }, { team_a_id: "N" }]);
    expect(planReplaceGroup([g("A", "B", { confirmed: true, status: "completed", winner_id: "A" }), rows[1], rows[2]], "C", "A", "N", "C")).toMatchObject({ reason: "has-played" });
    expect(planReplaceGroup([g("A", "B", { court_number: 2, court_allocated_at: T }), rows[1], rows[2]], "C", "A", "N", "C")).toMatchObject({ reason: "has-played" });
    expect(planReplaceGroup(rows, "C", "A", "B", "C")).toMatchObject({ reason: "already-in-group" });
    expect(planReplaceGroup([...rows, M({ team_a_id: "B", team_b_id: "C" })], "C", "A", "N", "C")).toMatchObject({ reason: "knockout-started" });
  });
  it("Sit Out of the replaced team's player afterwards gives nobody a walkover", () => {
    const { qf0, qf1, sf } = bracket();
    const rows = [{ ...qf0, winner_id: "X", confirmed: true, status: "completed" as const }, qf1, { ...sf, team_a_id: "Y", team_b_id: "P" }];
    const teams = [{ id: "X", tournament_id: "t", category_id: "C", name: "X", p1_id: "px", p2_id: null, sort_order: 0 }];
    const plan = planSitOut("px", teams, rows, () => false);
    expect(plan.walkovers).toEqual([]);
    expect(plan.removeTeams).toEqual([]);   // X has a played match, so it is kept (its results stay)
  });
});

describe("points rule: a walkover or a retirement gives the win but no points", () => {
  const g = (p: Partial<Match>) => M({ stage: "group", group_idx: 0, round_idx: null, confirmed: true, status: "completed", ...p });
  const teams = [{ id: "A", category_id: "C" }, { id: "B", category_id: "C" }, { id: "D", category_id: "C" }];
  it("group tables count the win and leave the score out", () => {
    const ms = [
      g({ team_a_id: "A", team_b_id: "B", winner_id: "B", score_a: 12, score_b: 8, is_retired: true }),   // A retired leading
      g({ team_a_id: "A", team_b_id: "D", winner_id: "D", score_a: 9, score_b: 4, is_walkover: true }),   // old partial walkover
      g({ team_a_id: "B", team_b_id: "D", winner_id: "B", score_a: 15, score_b: 10 }),
    ];
    const st = Object.fromEntries(groupStandings(teams, ms).map(x => [x.team.id, x]));
    expect([st.A.w, st.A.pf, st.A.pa]).toEqual([0, 0, 0]);
    expect([st.B.w, st.B.pf, st.B.pa]).toEqual([2, 15, 10]);
    expect([st.D.w, st.D.pf, st.D.pa]).toEqual([1, 10, 15]);
    expect(countsForPoints({ is_walkover: false, is_retired: false })).toBe(true);
    expect(countsForPoints({})).toBe(true);
  });
  it("labels and wording", () => {
    expect(resultLabel(M({ team_a_id: "A", team_b_id: "B", winner_id: "B", confirmed: true, is_retired: true }))).toBe("Ret.");
    expect(resultLabel(M({ team_a_id: "A", team_b_id: "B", winner_id: "B", confirmed: true, is_walkover: true }))).toBe("W/O");
    const name = (id: string | null) => id ?? "?";
    const m = M({ team_a_id: "A", team_b_id: "B", stage: "knockout" });
    expect(resultConfirmText("walkover", m, "B", { a: null, b: null }, name)).toBe("Walkover: B win and goes through.\nA forfeit. No points count either way.");
    expect(resultConfirmText("retired", m, "A", { a: 10, b: 5 }, name)).toContain("B win and goes through. The score so far (10–5) is shown, but no points count either way.");
    expect(resultConfirmText("winner", m, "A", { a: 9, b: 12 }, name)).toContain("⚠️ A are behind 9–12");
    expect(resultConfirmText("winner", m, "B", { a: 9, b: 12 }, name)).not.toContain("⚠️");
    expect(undoRefusedText("knockout-started")).toContain("knockout has started");
  });
  it("the shared write fields", () => {
    expect(walkoverFields(T)).toEqual({ score_a: null, score_b: null, confirmed: true, status: "completed", confirmed_at: T, is_walkover: true, is_retired: false });
    expect(retiredFields(T)).toMatchObject({ is_walkover: false, is_retired: true });
    expect(pickedFields(T)).toMatchObject({ is_walkover: false, is_retired: false });
    expect(finalScorePatch(M({ team_a_id: "A", team_b_id: "B" }), 15, 3, T)).toMatchObject({ ok: true, patch: { is_walkover: false, is_retired: false } });
  });
});
