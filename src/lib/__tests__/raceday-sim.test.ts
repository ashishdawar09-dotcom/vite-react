// Race-day simulation (Nov 15 2026): plays whole Shuttle Storm days with the
// app's own draw, standings, bracket and projection code, injecting no-shows,
// injuries, picked winners, replacements, score corrections and undos, and
// checks the bracket and tables after every step. 40 days per scenario here;
// RACEDAY_SIM_DAYS=300 npx vitest run raceday-sim for the full assessment run.
import { describe, expect, it } from "vitest";
import type { Category, Match } from "../../types";
import { planStart } from "../stageStart";
import { seedGroups, seedKnockout, seededRng, type SeedInfo } from "../seeding";
import { byeAdvances } from "../formatPlanner";
import { buildGroups, groupStandings } from "../groups";
import { pickQualifiers } from "../sitOut";
import { planKnockoutAdvance, applyPlan, type KnockoutPlan } from "../knockout";
import { finalScorePatch } from "../scoring";
import { projectVenue } from "../projection";
import { behindWarning, pickedWinnerPatch, planUndoResult, resultOptions, retiredPatch, walkoverPatch } from "../resultOptions";
import { planReplaceGroup, planReplaceKnockout } from "../replaceTeam";

type Ev = { key: string; n: number; groups: number; top: number };
// Production, Nov 15 2026 ~11 am PT (entries + saved formats).
const NOW_EVENTS: Ev[] = [
  { key: "YB", n: 10, groups: 3, top: 1 }, { key: "YG", n: 3, groups: 1, top: 0 }, { key: "S50", n: 7, groups: 2, top: 1 },
  { key: "WD18", n: 9, groups: 3, top: 1 }, { key: "WD35", n: 3, groups: 1, top: 0 }, { key: "MS", n: 20, groups: 6, top: 1 },
  { key: "MX18", n: 14, groups: 4, top: 1 }, { key: "MD35", n: 15, groups: 5, top: 1 }, { key: "MD18", n: 21, groups: 7, top: 1 },
  { key: "MX35", n: 6, groups: 2, top: 1 },
];
// Likely late changes: Vi's Mixed team (MX 18–34 → 5 groups, 3 byes), Shabbir (MS 21 → 7 groups, 1 bye).
const LATE_EVENTS: Ev[] = NOW_EVENTS.map(e => e.key === "MX18" ? { ...e, n: 15, groups: 5 } : e.key === "MS" ? { ...e, n: 21, groups: 7 } : e);

type Stats = Record<string, number>;
const bump = (s: Stats, k: string, by = 1) => { s[k] = (s[k] ?? 0) + by; };

function simulateDay(events: Ev[], seed: number, stats: Stats) {
  const rng = seededRng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const rows = new Map<string, Match>();
  const teamCat = new Map<string, string>();
  const seedOfId = new Map<string, number>();
  let idc = 0, clock = Date.parse("2026-11-21T16:00:00Z");
  const at = () => new Date((clock += 60_000)).toISOString();
  const all = () => [...rows.values()];
  const write = async (id: string, patch: Partial<Match>) => { rows.set(id, { ...rows.get(id)!, ...patch }); };
  const run = (plan: KnockoutPlan) => applyPlan(plan, write);
  const base = (cat: string, stage: "group" | "knockout"): Match => ({
    id: `m${++idc}`, tournament_id: "t", category_id: cat, stage, group_idx: null, round_idx: null, slot_idx: 0,
    team_a_id: null, team_b_id: null, score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false,
    is_walkover: false, is_retired: false, status: "pending", started_at: null, scheduled_at: null, confirmed_at: null,
    court_number: null, court_allocated_at: null, queue_position: null, extended_minutes: 0, is_bronze: false, best_of: 1, games: null,
  });
  const cats = events.map((e, i) => ({ id: e.key, name: e.key, sort_order: i, starts_at: null, match_minutes: 15 }) as unknown as Category);
  const replacedSlot = new Map<string, string>();   // `${matchId}|${side}` → team put there with Replace
  let subs = 0;
  const newSub = (cat: string) => { const id = `${cat}-SUB${++subs}`; teamCat.set(id, cat); return id; };
  const played = () => new Map(all().filter(m => m.confirmed && !m.is_bye).map(m => [m.id, JSON.stringify([m.team_a_id, m.team_b_id, m.winner_id, m.score_a, m.score_b])]));
  const rowCount = () => { const c: Stats = {}; for (const m of all()) bump(c, m.category_id); return JSON.stringify(c); };

  // ---- invariants -------------------------------------------------------
  const check = (where: string) => {
    for (const e of events) {
      const cat = all().filter(m => m.category_id === e.key);
      // Groups: no team in two groups; tables count every decided match once.
      const gm = cat.filter(m => m.stage === "group");
      const teamById: Record<string, { id: string; category_id: string }> = {};
      for (const m of gm) for (const t of [m.team_a_id, m.team_b_id]) if (t) teamById[t] = { id: t, category_id: e.key };
      const groups = buildGroups(gm, teamById, [e.key]);
      const seen = new Set<string>();
      for (const g of groups) for (const t of g) { expect(seen.has(t.id), `${where}: ${t.id} in two groups`).toBe(false); seen.add(t.id); }
      for (const g of groups) {
        const st = groupStandings(g, gm);
        const decided = gm.filter(m => m.confirmed && m.winner_id && g.some(t => t.id === m.team_a_id)).length;
        expect(st.reduce((s, x) => s + x.w, 0), `${where}: wins = decided matches`).toBe(decided);
        // Walkovers and retirements add no points (Ashish, Nov 15).
        const counted = gm.filter(m => m.confirmed && m.winner_id && !m.is_walkover && !m.is_retired && g.some(t => t.id === m.team_a_id))
          .reduce((s, m) => s + (m.score_a ?? 0) + (m.score_b ?? 0), 0);
        expect(st.reduce((s, x) => s + x.pf, 0), `${where}: points come only from finished matches`).toBe(counted);
      }
      // Knockout: every slot holds its feeder's winner, or a team put there with Replace.
      const ko = cat.filter(m => m.stage === "knockout" && !m.is_bronze);
      for (const n of ko.filter(m => (m.round_idx ?? 0) > 0)) {
        for (const [side, k] of [["team_a_id", 0], ["team_b_id", 1]] as const) {
          const f = ko.find(m => m.round_idx === n.round_idx! - 1 && m.slot_idx === n.slot_idx * 2 + k);
          if (!f) continue;
          const want = f.confirmed ? f.winner_id : null;
          const repl = replacedSlot.get(`${n.id}|${side}`);
          const ok = n[side] === want || (repl != null && n[side] === repl);
          expect(ok, `${where}: ${e.key} R${n.round_idx}S${n.slot_idx}.${side} = ${n[side]}, feeder winner ${want}, replacement ${repl}`).toBe(true);
        }
      }
      // No team in two unplayed knockout slots.
      const live = ko.filter(m => !m.confirmed && !m.is_bye).flatMap(m => [m.team_a_id, m.team_b_id]).filter(Boolean);
      expect(new Set(live).size, `${where}: ${e.key} team twice in the bracket`).toBe(live.length);
    }
    // The day's projection still runs.
    const p = projectVenue(all(), cats, 4, clock);
    expect(Number.isFinite(p.tournamentDeltaMin)).toBe(true);
  };

  // ---- one match --------------------------------------------------------
  const playMatch = async (id: string) => {
    const m0 = rows.get(id)!;
    expect(resultOptions(m0)).toEqual(["walkover"]);
    const before = JSON.stringify(m0);
    const r = rng();
    const [a, b] = [m0.team_a_id!, m0.team_b_id!];
    let winner: string; let patch: Partial<Match>;
    if (r < 0.04) {                                       // no-show before the match: walkover from the pending card
      winner = pick([a, b]); patch = walkoverPatch(m0, winner, at())!; bump(stats, "walkover-pending");
    } else if (r < 0.06) {                                // no-show found while warming up on a court
      await write(id, { court_number: 1 + Math.floor(rng() * 4), court_allocated_at: at() });
      winner = pick([a, b]); patch = walkoverPatch(rows.get(id)!, winner, at())!; bump(stats, "walkover-warming");
      expect(patch.court_number, "walkover frees the court").toBeNull();
    } else {
      await write(id, { status: "live", started_at: at(), court_number: 1 + Math.floor(rng() * 4), court_allocated_at: at() });
      const live = rows.get(id)!;
      expect(resultOptions(live)).toEqual(["walkover", "retired", "winner"]);
      const sa = Math.floor(rng() * 15), sb = Math.floor(rng() * 15);
      if (r < 0.10) {                                     // injury: one side retires mid-match
        const retiring = pick([a, b]); winner = retiring === a ? b : a;
        patch = retiredPatch(live, retiring, { a: sa, b: sb }, at())!; bump(stats, "retired");
        if (behindWarning(live, winner, { a: sa, b: sb })) bump(stats, "retired-winner-behind");
      } else if (r < 0.16) {                              // director picks a winner (time over, or any reason)
        winner = pick([a, b]); patch = pickedWinnerPatch(live, winner, { a: sa, b: sb }, at())!; bump(stats, "picked");
        if (behindWarning(live, winner, { a: sa, b: sb })) bump(stats, "picked-behind-warned");
      } else if (r < 0.18) {                              // walkover during play (left before scoring really began)
        winner = pick([a, b]); patch = walkoverPatch(live, winner, at())!; bump(stats, "walkover-live");
      } else {                                            // a normal game to 15
        const aWins = rng() < 0.5, lose = Math.floor(rng() * 14);
        const fs = finalScorePatch(live, aWins ? 15 : lose, aWins ? lose : 15, at());
        if (!fs.ok) throw new Error("final score refused");
        winner = fs.winnerId!; patch = fs.patch; bump(stats, "normal");
      }
    }
    expect(patch, "patch built").toBeTruthy();
    const cur = rows.get(id)!;
    const plan = planKnockoutAdvance(all(), cur, winner);   // App plans before writing, from the live row
    await write(id, patch);
    await run(plan);
    check(`after result ${id}`);

    // ↶ Undo a walkover/retirement/pick now and then, then play it again.
    const done = rows.get(id)!;
    if ((done.is_walkover || done.is_retired || r < 0.16) && rng() < 0.25) {
      const u = planUndoResult(all(), done);
      if (u.ok) {
        expect(u.plan.cleared.length, "nothing downstream had started yet").toBe(0);
        await run(u.plan);
        const back = rows.get(id)!;
        const b0 = JSON.parse(before) as Match;
        for (const k of ["team_a_id", "team_b_id", "winner_id", "score_a", "score_b", "confirmed", "status", "is_walkover", "is_retired", "court_number", "games"] as const) {
          expect(back[k] ?? null, `undo restores ${k}`).toEqual(b0[k] ?? null);
        }
        bump(stats, `undo-ok-${done.stage}`);
        check(`after undo ${id}`);
        return playMatch(id);
      }
      bump(stats, `undo-refused-${u.reason}`);
    }
  };

  // ---- the day ----------------------------------------------------------
  return (async () => {
    // Draws, exactly as Start Group Stage does them (seeded snake).
    for (const e of events) {
      const ids = Array.from({ length: e.n }, (_, i) => `${e.key}-T${i + 1}`);
      ids.forEach((t, i) => { teamCat.set(t, e.key); seedOfId.set(t, i + 1); });
      const sp = planStart(e.n, undefined, { groups_count: e.groups, top_n_advance: e.top });
      if (sp.kind !== "groups") throw new Error(`${e.key}: ${sp.kind}`);
      const seedOf = (t: string): SeedInfo => ({ seed: seedOfId.get(t) ?? null, tier: null } as SeedInfo);
      const gs = seedGroups(ids, sp.groupSizes, seedOf, rng);
      let slot = 0;
      gs.forEach((g, gi) => { for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const m = { ...base(e.key, "group"), group_idx: gi, slot_idx: slot++, team_a_id: g[i], team_b_id: g[j] };
        rows.set(m.id, m);
      } });
    }
    check("after draws");
    const counts0 = rowCount();

    // Replace a team before its first group match (e.g. a partner pulled out that morning).
    for (const e of events) {
      if (rng() < 0.3) {
        const gm = all().filter(m => m.category_id === e.key && m.stage === "group");
        const out = pick(gm).team_a_id!;
        const snap = played();
        const res = planReplaceGroup(all(), e.key, out, newSub(e.key), e.key);
        expect(res.ok, `group replace before play: ${JSON.stringify(res)}`).toBe(true);
        if (res.ok) { await run(res.plan); bump(stats, "replace-group"); }
        expect(played()).toEqual(snap);
        check("after group replace");
      }
    }

    // Group matches in a shuffled order. Midway, try replacing a team that has played (must be refused).
    const order = all().filter(m => m.stage === "group").map(m => m.id).sort(() => rng() - 0.5);
    for (const [i, id] of order.entries()) {
      await playMatch(id);
      if (i === Math.floor(order.length / 2)) {
        const playedOne = all().find(m => m.stage === "group" && m.confirmed)!;
        const res = planReplaceGroup(all(), playedOne.category_id, playedOne.team_a_id!, newSub(playedOne.category_id), playedOne.category_id);
        expect(res.ok ? "allowed" : res.reason).toBe("has-played"); bump(stats, "refused-group-has-played");
      }
    }
    expect(rowCount(), "group stage added or lost no rows").toBe(counts0);

    // Knockouts, exactly as Start Knockout builds them.
    for (const e of events) {
      if (e.top === 0) continue;                           // round robin: the table is the result
      const gm = all().filter(m => m.category_id === e.key && m.stage === "group");
      const teamById: Record<string, { id: string; category_id: string }> = {};
      for (const m of gm) for (const t of [m.team_a_id, m.team_b_id]) if (t) teamById[t] = { id: t, category_id: e.key };
      const groups = buildGroups(gm, teamById, [e.key]);
      const { qualifiers } = pickQualifiers(groups.map(g => groupStandings(g, gm)), e.top, () => false);
      const seeded = seedKnockout(qualifiers.map(q => q.map(t => t.id)), (t: string) => ({ seed: seedOfId.get(t) ?? null, tier: null } as SeedInfo));
      const slots = seeded.length, rds = Math.ceil(Math.log2(slots));
      for (let i = 0; i < slots / 2; i++) {
        const a = seeded[i * 2], b = seeded[i * 2 + 1], bye = !a || !b;
        const m = { ...base(e.key, "knockout"), round_idx: 0, slot_idx: i, team_a_id: a ?? null, team_b_id: b ?? null,
          winner_id: bye ? (a ?? b ?? null) : null, confirmed: bye, is_bye: bye, status: (bye ? "completed" : "pending") as Match["status"] };
        rows.set(m.id, m);
      }
      const adv = byeAdvances(seeded);
      let prev = slots / 2;
      for (let r = 1; r < rds; r++) { const cnt = prev / 2; for (let i = 0; i < cnt; i++) {
        const pre = r === 1 ? adv[i] : undefined;
        const m = { ...base(e.key, "knockout"), round_idx: r, slot_idx: i, team_a_id: pre?.a ?? null, team_b_id: pre?.b ?? null };
        rows.set(m.id, m);
      } prev = cnt; }
      bump(stats, `byes-${e.key}`, all().filter(m => m.category_id === e.key && m.is_bye).length);
    }
    check("after knockout start");
    const counts1 = rowCount();

    // Play every knockout to its final. Before some matches, replace a team.
    for (let guard = 0; guard < 500; guard++) {
      const ready = all().filter(m => m.stage === "knockout" && !m.confirmed && !m.is_bye && m.team_a_id && m.team_b_id && m.status === "pending");
      if (!ready.length) break;
      const m = pick(ready);
      const cat = all().filter(x => x.category_id === m.category_id);
      if (rng() < 0.15) {
        const side = rng() < 0.5 ? "team_a_id" : "team_b_id";
        const inKo = new Set(cat.filter(x => x.stage === "knockout").flatMap(x => [x.team_a_id, x.team_b_id]));
        const groupOnly = [...new Set(cat.filter(x => x.stage === "group").flatMap(x => [x.team_a_id!, x.team_b_id!]))].filter(t => !inKo.has(t));
        const losers = cat.filter(x => x.stage === "knockout" && x.confirmed && !x.is_bye && x.winner_id)
          .map(x => (x.winner_id === x.team_a_id ? x.team_b_id! : x.team_a_id!));
        // Candidates must not be alive anywhere in the bracket (the planner refuses those; tested below).
        const alive = new Set(cat.filter(x => x.stage === "knockout" && !x.confirmed && !x.is_bye).flatMap(x => [x.team_a_id, x.team_b_id]));
        for (const arr of [groupOnly, losers]) for (let i = arr.length - 1; i >= 0; i--) if (alive.has(arr[i])) arr.splice(i, 1);
        const kind = pick(["group", "loser", "sub"] as const);
        const incoming = kind === "group" && groupOnly.length ? pick(groupOnly) : kind === "loser" && losers.length ? pick(losers) : newSub(m.category_id);
        const snap = played();
        const res = planReplaceKnockout(all(), m, side, incoming, m.category_id);
        expect(res.ok, `replace refused: ${JSON.stringify(res)}`).toBe(true);
        if (res.ok) {
          await run(res.plan);
          replacedSlot.set(`${m.id}|${side}`, incoming);
          bump(stats, `replace-ko-${kind}`);
          if (res.plan.updates.length > 1) bump(stats, "replace-ko-moved-bye");
        }
        expect(played(), "replace never touches a played match").toEqual(snap);
        check("after knockout replace");
        // Illegal tries: a team still alive elsewhere, another event's team, a match in play.
        const other = all().find(x => x.category_id === m.category_id && x.stage === "knockout" && x.id !== m.id && !x.confirmed && !x.is_bye && x.team_a_id);
        if (other) { const r2 = planReplaceKnockout(all(), rows.get(m.id)!, side, other.team_a_id!, m.category_id);
          expect(r2.ok ? "allowed" : r2.reason).toBe("still-in-draw"); bump(stats, "refused-still-in-draw"); }
        const r3 = planReplaceKnockout(all(), rows.get(m.id)!, side, "YB-T1", "YB");
        if (m.category_id !== "YB") { expect(r3.ok ? "allowed" : r3.reason).toBe("wrong-category"); bump(stats, "refused-wrong-category"); }
        const liveCopy = { ...rows.get(m.id)!, status: "live" as const, started_at: at(), court_number: 2 };
        const r4 = planReplaceKnockout(all().map(x => x.id === m.id ? liveCopy : x), liveCopy, side, newSub(m.category_id), m.category_id);
        expect(r4.ok ? "allowed" : r4.reason).toBe("in-play"); bump(stats, "refused-in-play");
      }
      await playMatch(m.id);
      // Now and then: correct the score of a played knockout match, same winner (Edit Score).
      const done = all().filter(x => x.stage === "knockout" && x.confirmed && !x.is_bye && !x.is_walkover && x.winner_id);
      if (done.length && rng() < 0.3) {
        const d = pick(done);
        const aWon = d.winner_id === d.team_a_id;
        const fs = finalScorePatch(d, aWon ? 15 : 7, aWon ? 7 : 15, at());
        if (fs.ok) {
          const guarded = planKnockoutAdvance(all(), d, fs.winnerId);
          await write(d.id, fs.patch); await run(guarded);
          bump(stats, "edit-same-winner");
          check("after edit same winner");
        }
      }
    }
    expect(rowCount(), "knockout added or lost no rows").toBe(counts1);
    for (const e of events.filter(x => x.top > 0)) {
      const ko = all().filter(m => m.category_id === e.key && m.stage === "knockout");
      const final = ko.find(m => m.round_idx === Math.max(...ko.map(x => x.round_idx!)) && !m.is_bronze)!;
      expect(final.confirmed && final.winner_id, `${e.key} has a champion`).toBeTruthy();
      expect(teamCat.get(final.winner_id!), "champion is from the event").toBe(e.key);
      bump(stats, "champions");
    }
    bump(stats, "days");
  })();
}

describe("race-day simulation with the new result options and Replace team", () => {
  // RACEDAY_SIM_DAYS=300 for the full run (the app's tsconfig has no Node types, hence globalThis).
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  const DAYS = Number(env.RACEDAY_SIM_DAYS ?? 40);
  for (const [label, events, runs] of [["entries now", NOW_EVENTS, DAYS], ["late entries (Vi, Shabbir)", LATE_EVENTS, DAYS]] as const) {
    it(`${label}: ${runs} full days, every invariant holds`, async () => {
      const stats: Stats = {};
      for (let s = 1; s <= runs; s++) await simulateDay(events as Ev[], s * 7919 + label.length, stats);
      if (env.RACEDAY_SIM_DAYS) console.log(`\n[${label}] ` + Object.entries(stats).sort().map(([k, v]) => `${k}=${v}`).join("  "));
      expect(stats.days).toBe(runs);
    }, 600_000);
  }
});
