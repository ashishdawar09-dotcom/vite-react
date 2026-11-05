import { describe, expect, it } from "vitest";
import type { Match, Team } from "../../types";
import { pickQualifiers, planSitOut, sitOutWalkoverWinner, teamSittingOut } from "../sitOut";
import { planKnockoutAdvance } from "../knockout";

let seq = 0;
function match(extra: Partial<Match>): Match {
  seq += 1;
  return {
    id: `m${seq}`, tournament_id: "t1", category_id: "c1", stage: "group", group_idx: 0,
    round_idx: null, slot_idx: seq, team_a_id: null, team_b_id: null, score_a: null, score_b: null,
    winner_id: null, confirmed: false, is_bye: false, is_walkover: false, status: "pending",
    started_at: null, scheduled_at: null, confirmed_at: null, court_number: null, court_allocated_at: null,
    queue_position: null, extended_minutes: 0, is_bronze: false,
    ...extra,
  };
}
function team(id: string, p1: string, p2: string | null = null, category_id = "c1"): Team {
  return { id, tournament_id: "t1", category_id, name: id, p1_id: p1, p2_id: p2, sort_order: 0 };
}
const played = (a: string, b: string, winner: string, extra: Partial<Match> = {}) =>
  match({ team_a_id: a, team_b_id: b, winner_id: winner, confirmed: true, status: "completed", score_a: 21, score_b: 15, ...extra });
const nobodyOut = () => false;

describe("teamSittingOut", () => {
  it("is true when either player of a doubles team is out", () => {
    expect(teamSittingOut({ p1: { active: true }, p2: { active: false } })).toBe(true);
    expect(teamSittingOut({ p1: { active: false }, p2: null })).toBe(true);
    expect(teamSittingOut({ p1: { active: true }, p2: { active: true } })).toBe(false);
    expect(teamSittingOut({ p1: { active: true }, p2: null })).toBe(false);
    expect(teamSittingOut(undefined)).toBe(false);
  });
  it("never counts a player loaded without the active column as out", () => {
    expect(teamSittingOut({ p1: {} as { active: boolean }, p2: null })).toBe(false);
  });
});

describe("planSitOut", () => {
  it("before the draw: removes the player's teams and records nothing", () => {
    const teams = [team("T1", "sam", "pat"), team("T2", "kim", "lee")];
    const plan = planSitOut("sam", teams, [], nobodyOut);
    expect(plan.removeTeams.map(t => t.id)).toEqual(["T1"]);
    expect(plan.keepTeams).toEqual([]);
    expect(plan.walkovers).toEqual([]);
    expect(plan.live).toEqual([]);
  });

  it("mid group stage: keeps the team, leaves played results alone, and gives every remaining match to the opponent", () => {
    const teams = [team("T1", "sam", "pat"), team("T2", "a", "b"), team("T3", "c", "d"), team("T4", "e", "f")];
    const done = played("T1", "T2", "T1");
    const next1 = match({ team_a_id: "T3", team_b_id: "T1" });
    const next2 = match({ team_a_id: "T1", team_b_id: "T4" });
    const others = match({ team_a_id: "T2", team_b_id: "T3" });
    const plan = planSitOut("pat", teams, [done, next1, next2, others], nobodyOut);
    expect(plan.removeTeams).toEqual([]);
    expect(plan.keepTeams.map(t => t.id)).toEqual(["T1"]);
    expect(plan.walkovers.map(w => [w.match.id, w.winnerId])).toEqual([[next1.id, "T3"], [next2.id, "T4"]]);
    expect(plan.walkovers.every(w => !w.freesCourt)).toBe(true);
  });

  it("removes teams in categories not drawn yet and keeps those already drawn", () => {
    const teams = [team("D1", "sam", "pat", "doubles"), team("S1", "sam", null, "singles"), team("D2", "x", "y", "doubles")];
    const m = match({ category_id: "doubles", team_a_id: "D1", team_b_id: "D2" });
    const plan = planSitOut("sam", teams, [m], nobodyOut);
    expect(plan.removeTeams.map(t => t.id)).toEqual(["S1"]);
    expect(plan.keepTeams.map(t => t.id)).toEqual(["D1"]);
    expect(plan.walkovers.map(w => w.winnerId)).toEqual(["D2"]);
  });

  it("refuses while a match is in play", () => {
    const teams = [team("T1", "sam"), team("T2", "kim")];
    const live = match({ team_a_id: "T1", team_b_id: "T2", status: "live", started_at: "2026-11-21T17:00:00Z", court_number: 2 });
    const plan = planSitOut("sam", teams, [live], nobodyOut);
    expect(plan.live.map(m => m.id)).toEqual([live.id]);
    expect(plan.walkovers).toEqual([]);
  });

  it("a match warming up on a court becomes a walkover that frees the court", () => {
    const teams = [team("T1", "sam"), team("T2", "kim")];
    const warming = match({ team_a_id: "T1", team_b_id: "T2", court_number: 3, court_allocated_at: "2026-11-21T17:00:00Z" });
    const plan = planSitOut("sam", teams, [warming], nobodyOut);
    expect(plan.walkovers).toEqual([{ match: warming, winnerId: "T2", freesCourt: true }]);
  });

  it("a knockout match whose opponent isn't decided yet waits", () => {
    const teams = [team("T1", "sam"), team("T2", "kim"), team("T3", "x"), team("T4", "y")];
    const qf = played("T1", "T2", "T1", { stage: "knockout", round_idx: 0, slot_idx: 0, group_idx: null });
    const qf2 = match({ stage: "knockout", round_idx: 0, slot_idx: 1, group_idx: null, team_a_id: "T3", team_b_id: "T4" });
    const sf = match({ stage: "knockout", round_idx: 1, slot_idx: 0, group_idx: null, team_a_id: "T1", team_b_id: null });
    const plan = planSitOut("sam", teams, [qf, qf2, sf], nobodyOut);
    expect(plan.waiting.map(m => m.id)).toEqual([sf.id]);
    expect(plan.walkovers).toEqual([]);
  });

  it("leaves a match to the admin when the opponent is sitting out too", () => {
    const teams = [team("T1", "sam"), team("T2", "kim")];
    const m = match({ team_a_id: "T1", team_b_id: "T2" });
    const plan = planSitOut("sam", teams, [m], id => id === "T2");
    expect(plan.bothOut.map(x => x.id)).toEqual([m.id]);
    expect(plan.walkovers).toEqual([]);
  });

  it("ignores byes and cancelled or finished matches", () => {
    const teams = [team("T1", "sam"), team("T2", "kim")];
    const bye = match({ stage: "knockout", round_idx: 0, group_idx: null, team_a_id: "T1", winner_id: "T1", is_bye: true, confirmed: true, status: "completed" });
    const cancelled = match({ team_a_id: "T1", team_b_id: "T2", confirmed: true, status: "completed", score_a: 0, score_b: 0 });
    const plan = planSitOut("sam", teams, [bye, cancelled], nobodyOut);
    expect(plan.walkovers).toEqual([]);
    expect(plan.waiting).toEqual([]);
    expect(plan.keepTeams.map(t => t.id)).toEqual(["T1"]);
  });

  it("a knockout walkover moves the opponent into the next round", () => {
    const teams = [team("T1", "sam"), team("T2", "kim"), team("T3", "x"), team("T4", "y")];
    const ko = { stage: "knockout" as const, group_idx: null };
    const sf1 = match({ ...ko, round_idx: 0, slot_idx: 0, team_a_id: "T1", team_b_id: "T2" });
    const sf2 = match({ ...ko, round_idx: 0, slot_idx: 1, team_a_id: "T3", team_b_id: "T4" });
    const fin = match({ ...ko, round_idx: 1, slot_idx: 0 });
    const all = [sf1, sf2, fin];
    const plan = planSitOut("sam", teams, all, nobodyOut);
    expect(plan.walkovers.map(w => w.winnerId)).toEqual(["T2"]);
    const advance = planKnockoutAdvance(all, plan.walkovers[0].match, plan.walkovers[0].winnerId);
    expect(advance.updates).toEqual([{ id: fin.id, patch: { team_a_id: "T2" } }]);
    expect(advance.cleared).toEqual([]);
  });
});

describe("sitOutWalkoverWinner", () => {
  const avail = (active: boolean) => ({ p1: { active }, p2: { active: true } });
  it("names the opponent when exactly one team is out", () => {
    const m = match({ team_a_id: "A", team_b_id: "B" });
    expect(sitOutWalkoverWinner(m, { A: avail(false), B: avail(true) })).toBe("B");
    expect(sitOutWalkoverWinner(m, { A: avail(true), B: avail(false) })).toBe("A");
  });
  it("is null when nobody or both are out, a team is missing, or the match is live or done", () => {
    const m = match({ team_a_id: "A", team_b_id: "B" });
    expect(sitOutWalkoverWinner(m, { A: avail(true), B: avail(true) })).toBeNull();
    expect(sitOutWalkoverWinner(m, { A: avail(false), B: avail(false) })).toBeNull();
    expect(sitOutWalkoverWinner(match({ team_a_id: "A", team_b_id: null }), { A: avail(false) })).toBeNull();
    expect(sitOutWalkoverWinner({ ...m, status: "live" }, { A: avail(false), B: avail(true) })).toBeNull();
    expect(sitOutWalkoverWinner({ ...m, confirmed: true, status: "completed" }, { A: avail(false), B: avail(true) })).toBeNull();
  });
});

describe("pickQualifiers", () => {
  const table = (...ids: string[]) => ids.map(id => ({ team: id }));
  it("takes the top N of each group when nobody is out", () => {
    const r = pickQualifiers([table("A1", "A2", "A3"), table("B1", "B2", "B3")], 2, () => false);
    expect(r.qualifiers).toEqual([["A1", "A2"], ["B1", "B2"]]);
    expect(r.skipped).toEqual([]);
    expect(r.promoted).toEqual([]);
  });
  it("skips a qualifier who sat out and promotes the next team in that group", () => {
    const r = pickQualifiers([table("A1", "A2", "A3"), table("B1", "B2", "B3")], 2, t => t === "A1");
    expect(r.qualifiers).toEqual([["A2", "A3"], ["B1", "B2"]]);
    expect(r.skipped).toEqual(["A1"]);
    expect(r.promoted).toEqual(["A3"]);
  });
  it("a team that sat out below the cut changes nothing", () => {
    const r = pickQualifiers([table("A1", "A2", "A3")], 2, t => t === "A3");
    expect(r.qualifiers).toEqual([["A1", "A2"]]);
    expect(r.skipped).toEqual([]);
  });
  it("a group with nobody left to send drops out of the list", () => {
    const r = pickQualifiers([table("A1"), table("B1", "B2")], 1, t => t === "A1");
    expect(r.qualifiers).toEqual([["B1"]]);
    expect(r.skipped).toEqual(["A1"]);
  });
});
