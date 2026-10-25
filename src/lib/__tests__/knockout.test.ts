import { describe, expect, it } from "vitest";
import type { Match } from "../../types";
import { planKnockoutAdvance, applyPlan } from "../knockout";

// Minimal knockout match factory. Only the fields the planner reads matter.
let seq = 0;
function km(cat: string, round: number, slot: number, extra: Partial<Match> = {}): Match {
  seq += 1;
  return {
    id: `${cat}-r${round}-s${slot}${extra.is_bronze ? "-bronze" : ""}-${seq}`,
    tournament_id: "t1", category_id: cat, stage: "knockout", group_idx: null,
    round_idx: round, slot_idx: slot,
    team_a_id: null, team_b_id: null, score_a: null, score_b: null,
    winner_id: null, confirmed: false, is_bye: false, is_walkover: false, is_bronze: false,
    status: "pending", started_at: null, confirmed_at: null,
    court_number: null, court_allocated_at: null, extended_minutes: 0,
    ...extra,
  } as Match;
}

/** 8-team bracket: QF (round 0, 4 slots), SF (round 1, 2), Final (round 2, slot 0) + optional bronze (round 2, slot 1). */
function bracket8(cat: string, bronze = true) {
  const qf = [0, 1, 2, 3].map(s => km(cat, 0, s, { team_a_id: `${cat}-T${s * 2}`, team_b_id: `${cat}-T${s * 2 + 1}` }));
  const sf = [0, 1].map(s => km(cat, 1, s));
  const fin = km(cat, 2, 0);
  const br = bronze ? [km(cat, 2, 1, { is_bronze: true })] : [];
  return { qf, sf, fin, br, all: [...qf, ...sf, fin, ...br] };
}

const RESET_FIELDS = {
  winner_id: null, confirmed: false, confirmed_at: null, score_a: null, score_b: null,
  status: "pending", is_walkover: false, started_at: null, court_number: null,
  court_allocated_at: null, extended_minutes: 0,
};

describe("planKnockoutAdvance: category scoping", () => {
  it("writes a QF winner only into the same category's SF, even when other categories share round/slot numbers", () => {
    const a = bracket8("catA");
    const b = bracket8("catB");
    // catB listed first, so an unscoped lookup by round/slot would hit catB.
    const all = [...b.all, ...a.all];
    const plan = planKnockoutAdvance(all, a.qf[0], "catA-T0");
    expect(plan.updates).toEqual([{ id: a.sf[0].id, patch: { team_a_id: "catA-T0" } }]);
    expect(plan.updates.some(u => b.all.some(m => m.id === u.id))).toBe(false);
  });

  it("uses the category's own final round when categories have different bracket sizes", () => {
    // catA: 4-team bracket (SF round 0, Final round 1). catB: 8-team (QF 0, SF 1, Final 2).
    const aSf = [0, 1].map(s => km("catA", 0, s, { team_a_id: `A${s * 2}`, team_b_id: `A${s * 2 + 1}` }));
    const aFin = km("catA", 1, 0);
    const aBr = km("catA", 1, 1, { is_bronze: true });
    const b = bracket8("catB");
    const all = [...b.all, ...aSf, aFin, aBr];
    const plan = planKnockoutAdvance(all, aSf[1], "A3");
    expect(plan.updates).toEqual([
      { id: aFin.id, patch: { team_b_id: "A3" } },
      { id: aBr.id, patch: { team_b_id: "A2" } },
    ]);
  });
});

describe("planKnockoutAdvance: winners and bronze", () => {
  it("routes QF slots to the right SF side", () => {
    const { qf, sf, all } = bracket8("c");
    expect(planKnockoutAdvance(all, qf[1], "c-T3").updates).toEqual([{ id: sf[0].id, patch: { team_b_id: "c-T3" } }]);
    expect(planKnockoutAdvance(all, qf[2], "c-T4").updates).toEqual([{ id: sf[1].id, patch: { team_a_id: "c-T4" } }]);
  });

  it("sends the SF loser to bronze and the winner to the final", () => {
    const { sf, fin, br, all } = bracket8("c");
    sf[0].team_a_id = "c-T0"; sf[0].team_b_id = "c-T2";
    const plan = planKnockoutAdvance(all, sf[0], "c-T2");
    expect(plan.updates).toEqual([
      { id: fin.id, patch: { team_a_id: "c-T2" } },
      { id: br[0].id, patch: { team_a_id: "c-T0" } },
    ]);
  });

  it("does nothing for the final, the bronze match, group matches, or a missing winner", () => {
    const { fin, br, qf, all } = bracket8("c");
    expect(planKnockoutAdvance(all, fin, "x").updates).toEqual([]);
    expect(planKnockoutAdvance(all, br[0], "x").updates).toEqual([]);
    expect(planKnockoutAdvance(all, { ...qf[0], stage: "group" }, "c-T0").updates).toEqual([]);
    expect(planKnockoutAdvance(all, qf[0], null).updates).toEqual([]);
  });

  it("skips bronze when the category has none", () => {
    const { sf, fin, all } = bracket8("c", false);
    sf[1].team_a_id = "c-T4"; sf[1].team_b_id = "c-T6";
    expect(planKnockoutAdvance(all, sf[1], "c-T4").updates).toEqual([{ id: fin.id, patch: { team_b_id: "c-T4" } }]);
  });
});

describe("planKnockoutAdvance: score corrections", () => {
  it("leaves a played SF alone when a QF correction keeps the same winner", () => {
    const { qf, sf, all } = bracket8("c");
    qf[0].winner_id = "c-T0"; qf[0].confirmed = true;
    sf[0].team_a_id = "c-T0"; sf[0].team_b_id = "c-T2";
    sf[0].winner_id = "c-T0"; sf[0].confirmed = true; sf[0].status = "completed"; sf[0].score_a = 21; sf[0].score_b = 15;
    const plan = planKnockoutAdvance(all, qf[0], "c-T0");
    expect(plan.updates).toEqual([]);
    expect(plan.cleared).toEqual([]);
  });

  it("flipping a QF winner swaps the SF team, clears the SF result, and cascades into the final and bronze", () => {
    const { qf, sf, fin, br, all } = bracket8("c");
    qf[0].winner_id = "c-T0"; qf[0].confirmed = true;
    sf[0].team_a_id = "c-T0"; sf[0].team_b_id = "c-T2";
    sf[0].winner_id = "c-T0"; sf[0].confirmed = true; sf[0].status = "completed";
    sf[0].court_number = 2; sf[0].started_at = "2026-11-21T18:00:00Z";
    fin.team_a_id = "c-T0";
    br[0].team_a_id = "c-T2";

    const plan = planKnockoutAdvance(all, qf[0], "c-T1");
    expect(plan.updates).toEqual([
      { id: sf[0].id, patch: { team_a_id: "c-T1", ...RESET_FIELDS } },
      { id: fin.id, patch: { team_a_id: null } },
      { id: br[0].id, patch: { team_a_id: null } },
    ]);
    expect(plan.cleared.map(m => m.id)).toEqual([sf[0].id]);
  });

  it("cascades through a decided final", () => {
    const { qf, sf, fin, all } = bracket8("c", false);
    qf[3].winner_id = "c-T6"; qf[3].confirmed = true;
    sf[1].team_a_id = "c-T4"; sf[1].team_b_id = "c-T6"; sf[1].winner_id = "c-T6"; sf[1].confirmed = true; sf[1].status = "completed";
    fin.team_a_id = "c-T0"; fin.team_b_id = "c-T6"; fin.winner_id = "c-T6"; fin.confirmed = true; fin.status = "completed";

    const plan = planKnockoutAdvance(all, qf[3], "c-T7");
    expect(plan.updates).toEqual([
      { id: sf[1].id, patch: { team_b_id: "c-T7", ...RESET_FIELDS } },
      { id: fin.id, patch: { team_b_id: null, ...RESET_FIELDS } },
    ]);
    expect(plan.cleared.map(m => m.id)).toEqual([sf[1].id, fin.id]);
  });

  it("clears a match that has a court allocated but no score yet", () => {
    const { qf, sf, all } = bracket8("c");
    qf[0].winner_id = "c-T0"; qf[0].confirmed = true;
    sf[0].team_a_id = "c-T0"; sf[0].team_b_id = "c-T2"; sf[0].court_number = 1; sf[0].court_allocated_at = "2026-11-21T18:00:00Z";
    const plan = planKnockoutAdvance(all, qf[0], "c-T1");
    expect(plan.cleared.map(m => m.id)).toEqual([sf[0].id]);
    expect(plan.updates[0].patch.court_allocated_at).toBeNull();
  });

  it("fills an empty slot without clearing anything", () => {
    const { qf, sf, all } = bracket8("c");
    sf[0].team_b_id = "c-T2";
    const plan = planKnockoutAdvance(all, qf[0], "c-T0");
    expect(plan.updates).toEqual([{ id: sf[0].id, patch: { team_a_id: "c-T0" } }]);
    expect(plan.cleared).toEqual([]);
  });
});

describe("applyPlan", () => {
  it("writes updates in order and stops at the first error", async () => {
    const calls: string[] = [];
    const write = async (id: string) => { calls.push(id); if (id === "b") throw new Error("boom"); };
    await expect(applyPlan({ updates: [{ id: "a", patch: {} }, { id: "b", patch: {} }, { id: "c", patch: {} }], cleared: [] }, write)).rejects.toThrow("boom");
    expect(calls).toEqual(["a", "b"]);
  });
});

describe("confirmKnockoutPlan", () => {
  it("asks only when something would be wiped, and returns null on cancel", async () => {
    const { confirmKnockoutPlan } = await import("../knockout");
    const { qf, sf, all } = bracket8("c");
    let asked = "";
    expect(confirmKnockoutPlan(all, qf[0], "c-T0", m => { asked = m; return true; })?.updates.length).toBe(1);
    expect(asked).toBe("");

    qf[0].winner_id = "c-T0"; qf[0].confirmed = true;
    sf[0].team_a_id = "c-T0"; sf[0].team_b_id = "c-T2"; sf[0].winner_id = "c-T2"; sf[0].confirmed = true; sf[0].status = "completed";
    expect(confirmKnockoutPlan(all, qf[0], "c-T1", m => { asked = m; return false; })).toBeNull();
    expect(asked).toContain("Semi-final 1 (result)");
  });
});
