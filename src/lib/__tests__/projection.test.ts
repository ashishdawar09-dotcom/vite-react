import { describe, expect, it } from "vitest";
import type { Category, Match } from "../../types";
import { projectSchedule } from "../projection";

const MIN = 60_000;
const DAY_START = Date.parse("2026-11-21T16:30:00Z"); // 9:30 am in Abbotsford (UTC-7)
const iso = (ms: number) => new Date(ms).toISOString();

function category(id: string, sort: number, over: Partial<Category> = {}): Category {
  return {
    id, tournament_id: "t1", name: id, team_size: 2, match_minutes: 12, starts_at: null, phase: "group", rounds_per_pair: 1, groups_count: 1,
    top_n_advance: 2, sort_order: sort, created_at: iso(DAY_START), age_band: null, allow_solo_signup: false, has_bronze_match: false, price: null, price_basis: "per_team", ...over,
  };
}
function match(id: string, cat: string, over: Partial<Match>): Match {
  return {
    id, tournament_id: "t1", category_id: cat, stage: "group", group_idx: 0, round_idx: null, slot_idx: 0, team_a_id: null, team_b_id: null,
    score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false, is_walkover: false, status: "pending", started_at: null,
    scheduled_at: null, confirmed_at: null, court_number: null, court_allocated_at: null, queue_position: null, extended_minutes: 0, is_bronze: false, ...over,
  };
}

/** `n` queued group matches for one event, every match between two new teams. */
function event(cat: string, n: number): Match[] {
  return Array.from({ length: n }, (_, i) => match(`${cat}-${i}`, cat, { slot_idx: i, team_a_id: `${cat}-t${2 * i}`, team_b_id: `${cat}-t${2 * i + 1}` }));
}

const startOf = (s: ReturnType<typeof projectSchedule>, id: string) => Date.parse(s.byId[id].projected_start_at!);
const minutesFrom = (base: number) => (ms: number) => (ms - base) / MIN;

/** Most matches on court at any one moment, given each lasts `len` minutes. */
function peakOnCourt(starts: number[], len: number): number {
  let peak = 0;
  for (const t of starts) peak = Math.max(peak, starts.filter(s => s <= t && t < s + len * MIN).length);
  return peak;
}

describe("projectSchedule: events share the venue's courts", () => {
  it("never puts more matches on court than there are courts, with 10 events starting together", () => {
    const cats = Array.from({ length: 10 }, (_, i) => category(`e${i + 1}`, i + 1));
    const matches = cats.flatMap(c => event(c.id, 6));
    const s = projectSchedule(matches, cats, 4, DAY_START);
    const starts = matches.map(m => startOf(s, m.id));

    expect(peakOnCourt(starts, 12)).toBe(4);
    // 60 matches, 4 courts, 12 minutes each: 15 waves, the last at +168 min.
    expect(minutesFrom(DAY_START)(Math.max(...starts))).toBe(168);
    // An event's 5th match no longer looks like it starts with its 1st.
    const e1 = event("e1", 6).map(m => minutesFrom(DAY_START)(startOf(s, m.id)));
    expect(e1[0]).toBe(0);
    expect(e1[4]).toBeGreaterThanOrEqual(4 * 12);
  });

  it("takes events in turn: each wave of free courts goes to the events that have waited longest", () => {
    const cats = Array.from({ length: 10 }, (_, i) => category(`e${i + 1}`, i + 1));
    const matches = cats.flatMap(c => event(c.id, 3));
    const s = projectSchedule(matches, cats, 4, DAY_START);
    const at = (min: number) => matches.filter(m => startOf(s, m.id) === DAY_START + min * MIN).map(m => m.id).sort();

    expect(at(0)).toEqual(["e1-0", "e2-0", "e3-0", "e4-0"]);
    expect(at(12)).toEqual(["e5-0", "e6-0", "e7-0", "e8-0"]);
    expect(at(24)).toEqual(["e1-1", "e10-0", "e2-1", "e9-0"]);
    expect(at(36)).toEqual(["e3-1", "e4-1", "e5-1", "e6-1"]);
  });

  it("keeps the admin's queue order inside an event", () => {
    const cats = [category("a", 1), category("b", 2)];
    const matches = [
      ...event("a", 4).map((m, i) => ({ ...m, queue_position: 3 - i })), // reversed by the admin
      ...event("b", 4),
    ];
    const s = projectSchedule(matches, cats, 2, DAY_START);
    const aOrder = matches.filter(m => m.category_id === "a").sort((x, y) => startOf(s, x.id) - startOf(s, y.id)).map(m => m.id);
    expect(aOrder).toEqual(["a-3", "a-2", "a-1", "a-0"]);
  });

  it("gives the old per-event answer when there is only one event", () => {
    const cats = [category("a", 1)];
    const matches = event("a", 9);
    const s = projectSchedule(matches, cats, 4, DAY_START);
    expect(matches.map(m => minutesFrom(DAY_START)(startOf(s, m.id)))).toEqual([0, 0, 0, 0, 12, 12, 12, 12, 24]);
  });
});

describe("projectSchedule: courts already in use", () => {
  const now = DAY_START + 60 * MIN;

  it("lets live and called matches keep their courts, from any event", () => {
    const cats = [category("a", 1), category("b", 2), category("c", 3)];
    const matches = [
      match("live", "a", { team_a_id: "a1", team_b_id: "a2", status: "live", court_number: 1, court_allocated_at: iso(now - 8 * MIN), started_at: iso(now - 5 * MIN) }),
      match("called", "b", { team_a_id: "b1", team_b_id: "b2", court_number: 2, court_allocated_at: iso(now - MIN) }),
      match("q1", "c", { slot_idx: 0, team_a_id: "c1", team_b_id: "c2" }),
      match("q2", "c", { slot_idx: 1, team_a_id: "c3", team_b_id: "c4" }),
      match("q3", "c", { slot_idx: 2, team_a_id: "c5", team_b_id: "c6" }),
    ];
    const s = projectSchedule(matches, cats, 4, now);
    const m = minutesFrom(now);
    expect(m(startOf(s, "called"))).toBe(0);
    expect(m(startOf(s, "q1"))).toBe(0); // court 3
    expect(m(startOf(s, "q2"))).toBe(0); // court 4
    expect(m(startOf(s, "q3"))).toBe(7); // court 1, when the live match should end
    expect(s.liveByCourt[1]?.id).toBe("live");
    expect(s.byId.live.delta_label).toBe("5M PLAYING");
  });

  it("puts a called match on its own court, not the first free one", () => {
    const cats = [category("a", 1)];
    const matches = [
      match("live", "a", { slot_idx: 0, team_a_id: "a1", team_b_id: "a2", status: "live", court_number: 2, court_allocated_at: iso(now - 12 * MIN), started_at: iso(now - 10 * MIN) }),
      match("called", "a", { slot_idx: 1, team_a_id: "a3", team_b_id: "a4", court_number: 2, court_allocated_at: iso(now) }),
      match("q1", "a", { slot_idx: 2, team_a_id: "a5", team_b_id: "a6" }),
    ];
    const s = projectSchedule(matches, cats, 2, now);
    // Court 2 is busy for 2 more minutes; court 1 is free and goes to q1.
    expect(minutesFrom(now)(startOf(s, "called"))).toBe(2);
    expect(minutesFrom(now)(startOf(s, "q1"))).toBe(0);
  });

  it("rolls a backlog forward with the clock instead of showing past times", () => {
    const cats = [category("a", 1, { starts_at: iso(DAY_START) }), category("b", 2, { starts_at: iso(DAY_START) })];
    const matches = [...event("a", 3), ...event("b", 3)];
    const late = DAY_START + 90 * MIN;
    const s = projectSchedule(matches, cats, 4, late);
    for (const m of matches) expect(startOf(s, m.id)).toBeGreaterThanOrEqual(late);
  });
});

describe("projectSchedule: who can play when", () => {
  it("never puts a team on two courts at once", () => {
    // One group of four, in the order the draw writes it: A plays its three matches first.
    const cats = [category("g", 1)];
    const pairs: [string, string][] = [["A", "B"], ["A", "C"], ["A", "D"], ["B", "C"], ["B", "D"], ["C", "D"]];
    const matches = pairs.map(([a, b], i) => match(`${a}${b}`, "g", { slot_idx: i, team_a_id: a, team_b_id: b }));
    const s = projectSchedule(matches, cats, 4, DAY_START);
    const m = minutesFrom(DAY_START);
    expect(m(startOf(s, "AB"))).toBe(0);
    expect(m(startOf(s, "CD"))).toBe(0);
    expect(m(startOf(s, "AC"))).toBe(12);
    expect(m(startOf(s, "BD"))).toBe(12);
    expect(m(startOf(s, "AD"))).toBe(24);
    expect(m(startOf(s, "BC"))).toBe(24);
  });

  it("waits for both semifinals before the final, while other events use the courts", () => {
    const cats = [category("ko", 1), category("big", 2)];
    const matches = [
      match("sf1", "ko", { stage: "knockout", group_idx: null, round_idx: 0, slot_idx: 0, team_a_id: "k1", team_b_id: "k2" }),
      match("sf2", "ko", { stage: "knockout", group_idx: null, round_idx: 0, slot_idx: 1, team_a_id: "k3", team_b_id: "k4" }),
      match("final", "ko", { stage: "knockout", group_idx: null, round_idx: 1, slot_idx: 0 }),
      ...event("big", 6),
    ];
    const s = projectSchedule(matches, cats, 3, DAY_START);
    const m = minutesFrom(DAY_START);
    const sfEnd = Math.max(m(startOf(s, "sf1")), m(startOf(s, "sf2"))) + 12;
    expect(m(startOf(s, "final"))).toBeGreaterThanOrEqual(sfEnd);
    expect(peakOnCourt(matches.map(x => startOf(s, x.id)), 12)).toBeLessThanOrEqual(3);
  });

  it("holds an event until its own start time, then gives it the next free court", () => {
    const cats = [category("early", 1, { starts_at: iso(DAY_START) }), category("late", 2, { starts_at: iso(DAY_START + 60 * MIN) })];
    const matches = [...event("early", 12), ...event("late", 2)];
    const s = projectSchedule(matches, cats, 2, DAY_START);
    const m = minutesFrom(DAY_START);
    expect(m(startOf(s, "early-0"))).toBe(0);
    // Both courts free up at +60: the late event gets one, the early event
    // (which last started at +48) keeps the other; then they take turns.
    expect(m(startOf(s, "late-0"))).toBe(60);
    expect(matches.filter(x => x.category_id === "early" && m(startOf(s, x.id)) === 60)).toHaveLength(1);
    expect(m(startOf(s, "late-1"))).toBe(72);
  });
});

describe("projectSchedule: events with no start time", () => {
  it("start with the day's first event before play begins, not at the current time", () => {
    const cats = [category("timed", 1, { starts_at: iso(DAY_START) }), category("untimed", 2)];
    const matches = [...event("timed", 2), ...event("untimed", 2)];
    const twoHoursEarly = DAY_START - 120 * MIN;
    const s = projectSchedule(matches, cats, 4, twoHoursEarly);
    expect(startOf(s, "untimed-0")).toBe(DAY_START);
    expect(startOf(s, "timed-0")).toBe(DAY_START);
  });

  it("can start as soon as a court frees once play is underway", () => {
    const cats = [category("timed", 1, { starts_at: iso(DAY_START + 240 * MIN) }), category("untimed", 2)];
    const now = DAY_START + 30 * MIN;
    const matches = [
      match("done", "untimed", { slot_idx: 0, team_a_id: "u1", team_b_id: "u2", confirmed: true, status: "completed", winner_id: "u1", started_at: iso(now - 20 * MIN), confirmed_at: iso(now - 5 * MIN), court_number: 1 }),
      match("next", "untimed", { slot_idx: 1, team_a_id: "u3", team_b_id: "u4" }),
      ...event("timed", 1),
    ];
    const s = projectSchedule(matches, cats, 4, now);
    expect(startOf(s, "next")).toBe(now);
    expect(startOf(s, "timed-0")).toBe(DAY_START + 240 * MIN);
  });

  it("fall back to now when no event has a start time", () => {
    const cats = [category("a", 1), category("b", 2)];
    const now = DAY_START - 30 * MIN;
    const s = projectSchedule([...event("a", 1), ...event("b", 1)], cats, 4, now);
    expect(startOf(s, "a-0")).toBe(now);
  });
});

describe("projectSchedule: output", () => {
  it("returns every match once, in event then queue order, with the same fields as before", () => {
    const cats = [category("b", 2), category("a", 1)];
    const matches = [
      ...event("a", 2),
      ...event("b", 2),
      match("x", "unknown-event", {}),
      match("bye", "a", { stage: "knockout", group_idx: null, round_idx: 0, slot_idx: 5, team_a_id: "a-t0", is_bye: true }),
    ];
    const s = projectSchedule(matches, cats, 2, DAY_START);
    // Same order as the categories array, as the old hook did; matches outside it are left out.
    expect(s.projected.map(p => p.id)).toEqual(["b-0", "b-1", "a-0", "a-1", "bye"]);
    expect(Object.keys(s.byId).sort()).toEqual(["a-0", "a-1", "b-0", "b-1", "bye"]);
    // A bye takes no court time.
    expect(s.byId.bye.delta_label).toBe("BYE");
    expect(s.byId["a-1"].projected_start_at).toBe(iso(DAY_START + 12 * MIN));
    expect(s.byId["b-0"].delta_label).toBe("STARTS NOW");
    expect(s.byId["b-1"].delta_label).toBe("IN 12M");
  });

  it("keeps the tournament delta from completed matches", () => {
    const cats = [category("a", 1)];
    const matches = [
      match("m1", "a", { confirmed: true, status: "completed", winner_id: "t1", team_a_id: "t1", team_b_id: "t2", scheduled_at: iso(DAY_START), started_at: iso(DAY_START), confirmed_at: iso(DAY_START + 17 * MIN) }),
    ];
    const s = projectSchedule(matches, cats, 4, DAY_START + 30 * MIN);
    expect(s.tournamentDeltaMin).toBe(5);
    expect(s.tournamentDeltaLabel).toBe("5 MIN BEHIND");
    expect(s.byId.m1.delta_label).toBe("5M LATE");
  });

  it("returns empty results with no matches", () => {
    expect(projectSchedule([], [category("a", 1)], 4, DAY_START)).toEqual({ projected: [], byId: {}, tournamentDeltaMin: 0, tournamentDeltaLabel: "ON TIME", liveByCourt: {} });
  });
});
