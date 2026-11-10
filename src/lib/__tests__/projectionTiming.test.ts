import { describe, expect, it } from "vitest";
import type { Category, Match, Team } from "../../types";
import { adaptiveMatchMinutes, gamesFactor, learnTurnaround, projectSchedule, projectVenue, RACE_DAY_TIMING, venuePace, type Timing } from "../projection";

// The race-day timing model, shared by the phones and the venue TV:
// call ──call to serve──▶ first serve ──play──▶ score ──changeover──▶ next call.

const MIN = 60_000;
const DAY_START = Date.parse("2026-11-21T16:30:00Z"); // 9:30 am in Abbotsford (UTC-7)
const iso = (ms: number) => new Date(ms).toISOString();
/** Fixed numbers, so the arithmetic below doesn't move if the race-day numbers are tuned. */
const T: Timing = { callToServeMin: 4, changeoverMin: 2, bestOf3Factor: 2, learnTurnaround: false };

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
function team(id: string, p1: string, p2: string | null = null): Pick<Team, "id" | "p1_id" | "p2_id"> {
  return { id, p1_id: p1, p2_id: p2 };
}
/** `n` queued group matches for one event, every match between two new teams. */
function event(cat: string, n: number): Match[] {
  return Array.from({ length: n }, (_, i) => match(`${cat}-${i}`, cat, { slot_idx: i, team_a_id: `${cat}-t${2 * i}`, team_b_id: `${cat}-t${2 * i + 1}` }));
}
/** A finished match: called, served and scored at the given minutes after `base`. */
function played(id: string, court: number, base: number, calledMin: number, serveMin: number, scoreMin: number, over: Partial<Match> = {}): Match {
  return match(id, "a", {
    team_a_id: `${id}-x`, team_b_id: `${id}-y`, winner_id: `${id}-x`, confirmed: true, status: "completed", court_number: court,
    court_allocated_at: iso(base + calledMin * MIN), started_at: iso(base + serveMin * MIN), confirmed_at: iso(base + scoreMin * MIN), ...over,
  });
}

const at = (s: { byId: Record<string, { projected_start_at: string | null }> }, id: string, base: number) => (Date.parse(s.byId[id].projected_start_at!) - base) / MIN;

describe("race-day numbers", () => {
  it("are 4 min call to serve, 2 min changeover, best of 3 counted double, learning from the day", () => {
    expect(RACE_DAY_TIMING).toEqual({ callToServeMin: 4, changeoverMin: 2, bestOf3Factor: 2, learnTurnaround: true });
  });
});

describe("a court's turn: call, walk on and warm up, play, changeover", () => {
  it("calls the next match when the last one's score is in and the court has changed over", () => {
    const s = projectVenue(event("a", 3), [category("a", 1)], 1, DAY_START, { timing: T });
    // Called at 0, first serve at 4, score at 16, court ready at 18.
    expect([0, 1, 2].map(i => at(s, `a-${i}`, DAY_START))).toEqual([0, 18, 36]);
    expect((s.finish! - DAY_START) / MIN).toBe(52);
  });

  it("runs 146 one-game matches on 4 courts at about 18 minutes a court", () => {
    const cats = Array.from({ length: 10 }, (_, i) => category(`e${i + 1}`, i + 1, { starts_at: iso(DAY_START) }));
    const matches = cats.flatMap((c, i) => event(c.id, i < 6 ? 15 : 14)); // 146 matches
    expect(matches).toHaveLength(146);
    const s = projectVenue(matches, cats, 4, DAY_START, { timing: T });
    const last = Math.max(...matches.map(m => Date.parse(s.byId[m.id].projected_start_at!)));
    // 37 turns on the busiest court: the last call at 36 × 18 min.
    expect((last - DAY_START) / MIN).toBe(36 * 18);
  });

  it("keeps a live match's court until its expected finish plus the changeover", () => {
    const now = DAY_START + 60 * MIN;
    const matches = [
      match("live", "a", { slot_idx: 0, team_a_id: "a1", team_b_id: "a2", status: "live", court_number: 1, court_allocated_at: iso(now - 9 * MIN), started_at: iso(now - 5 * MIN), extended_minutes: 3 }),
      match("q", "a", { slot_idx: 1, team_a_id: "a3", team_b_id: "a4" }),
    ];
    const s = projectVenue(matches, [category("a", 1)], 1, now, { timing: T });
    // 12 + 3 extra minutes from the serve at -5: score at +10, next call at +12.
    expect(at(s, "q", now)).toBe(12);
    expect(s.byId.live.delta_label).toBe("5M PLAYING");
  });

  it("treats a live match that has run over as ending now", () => {
    const now = DAY_START + 60 * MIN;
    const matches = [
      match("live", "a", { slot_idx: 0, team_a_id: "a1", team_b_id: "a2", status: "live", court_number: 1, started_at: iso(now - 20 * MIN) }),
      match("q", "a", { slot_idx: 1, team_a_id: "a3", team_b_id: "a4" }),
    ];
    const s = projectVenue(matches, [category("a", 1)], 1, now, { timing: T });
    expect(at(s, "q", now)).toBe(2);
    expect(s.byId.live.delta_label).toBe("8M OVER");
  });

  it("shows a called match at its expected first serve, and holds its court for the match", () => {
    const now = DAY_START + 60 * MIN;
    const matches = [
      match("called", "a", { slot_idx: 0, team_a_id: "a1", team_b_id: "a2", court_number: 1, court_allocated_at: iso(now - MIN) }),
      match("q", "a", { slot_idx: 1, team_a_id: "a3", team_b_id: "a4" }),
    ];
    const s = projectVenue(matches, [category("a", 1)], 1, now, { timing: T });
    expect(at(s, "called", now)).toBe(3);
    // Serve at +3, score at +15, next call at +17.
    expect(at(s, "q", now)).toBe(17);
  });

  it("gives a court that has just finished its changeover first", () => {
    const now = DAY_START + 60 * MIN;
    const matches = [played("done", 1, now, -17, -13, -1), match("q", "a", { slot_idx: 1, team_a_id: "a3", team_b_id: "a4" })];
    const s = projectVenue(matches, [category("a", 1)], 1, now, { timing: T });
    expect(at(s, "q", now)).toBe(1);
  });

  it("returns no finish when nothing is left to play", () => {
    const now = DAY_START + 60 * MIN;
    const s = projectVenue([played("done", 1, now, -30, -26, -14)], [category("a", 1)], 4, now, { timing: T });
    expect(s.finish).toBeNull();
  });
});

describe("best of 3", () => {
  const ko = (id: string, round: number, slot: number, over: Partial<Match> = {}) =>
    match(id, "a", { stage: "knockout", group_idx: null, round_idx: round, slot_idx: slot, ...over });

  it("follows each match's own format (matches.best_of), not its round", () => {
    // Event set to Quarterfinals: a quarterfinal is best of 3.
    expect(gamesFactor(ko("qf", 0, 0, { best_of: 3 }))).toBe(2);
    // Event set to Final (or Never): a semifinal is one game.
    expect(gamesFactor(ko("sf", 1, 0, { best_of: 1 }))).toBe(1);
    // The bronze match follows the final.
    expect(gamesFactor(ko("bronze", 2, 1, { is_bronze: true, best_of: 3 }))).toBe(2);
    // A row from before the column existed is one game.
    expect(gamesFactor(ko("f", 2, 0))).toBe(1);
    expect(gamesFactor(match("g", "a", {}))).toBe(1);
    expect(gamesFactor(ko("f", 2, 0, { best_of: 3 }), 3)).toBe(3);
  });

  it("plays twice as long, so the final waits for both semifinals to finish", () => {
    const matches = [
      ko("sf1", 0, 0, { team_a_id: "k1", team_b_id: "k2", best_of: 3 }),
      ko("sf2", 0, 1, { team_a_id: "k3", team_b_id: "k4", best_of: 3 }),
      ko("final", 1, 0, { best_of: 3 }),
    ];
    const s = projectVenue(matches, [category("a", 1)], 4, DAY_START, { timing: T });
    expect(at(s, "sf1", DAY_START)).toBe(0);
    // Serve at 4, 24 minutes of play: both semifinals end at 28.
    expect(at(s, "final", DAY_START)).toBe(28);
    // The final ends at 28 + 4 + 24.
    expect((s.finish! - DAY_START) / MIN).toBe(56);
  });

  it("projects a semifinal as one game when its event isn't best of 3 there", () => {
    const matches = [
      ko("sf1", 0, 0, { team_a_id: "k1", team_b_id: "k2", best_of: 1 }),
      ko("sf2", 0, 1, { team_a_id: "k3", team_b_id: "k4", best_of: 1 }),
      ko("final", 1, 0, { best_of: 3 }),
    ];
    const s = projectVenue(matches, [category("a", 1)], 4, DAY_START, { timing: T });
    // Serve at 4, 12 minutes of play: both semifinals end at 16, and the final is called then.
    expect(at(s, "final", DAY_START)).toBe(16);
    // The final is best of 3: it ends at 16 + 4 + 24.
    expect((s.finish! - DAY_START) / MIN).toBe(44);
  });

  it("counts a played semifinal as two games when learning an event's pace", () => {
    const base = DAY_START;
    const matches = [
      played("g1", 1, base, 0, 0, 14),
      played("g2", 2, base, 0, 0, 14),
      ko("sf1", 0, 0, { team_a_id: "k1", team_b_id: "k2", best_of: 3, winner_id: "k1", confirmed: true, status: "completed", started_at: iso(base + 30 * MIN), confirmed_at: iso(base + 58 * MIN) }),
      ko("final", 1, 0, { best_of: 3 }),
    ];
    // 14, 14 and 28 / 2: the event plays 14-minute games.
    expect(adaptiveMatchMinutes(matches, "a", 12)).toBe(14);
  });
});

describe("players entered in two events", () => {
  it("are never projected on two courts at once", () => {
    const cats = [category("md", 1), category("xd", 2)];
    const matches = [
      match("md-1", "md", { slot_idx: 0, team_a_id: "mdA", team_b_id: "mdB" }),
      match("xd-1", "xd", { slot_idx: 0, team_a_id: "xdA", team_b_id: "xdB" }),
    ];
    // Sagar plays in both events.
    const teams = [team("mdA", "sagar", "p2"), team("mdB", "p3", "p4"), team("xdA", "sagar", "p5"), team("xdB", "p6", "p7")];
    const s = projectVenue(matches, cats, 4, DAY_START, { timing: T, teams });
    expect(at(s, "md-1", DAY_START)).toBe(0);
    // Sagar's men's doubles ends at 16; the mixed match is called then.
    expect(at(s, "xd-1", DAY_START)).toBe(16);
  });

  it("fall back to teams when the teams aren't passed", () => {
    const cats = [category("md", 1), category("xd", 2)];
    const matches = [
      match("md-1", "md", { slot_idx: 0, team_a_id: "mdA", team_b_id: "mdB" }),
      match("xd-1", "xd", { slot_idx: 0, team_a_id: "xdA", team_b_id: "xdB" }),
    ];
    const s = projectVenue(matches, cats, 4, DAY_START, { timing: T });
    expect(at(s, "xd-1", DAY_START)).toBe(0);
  });

  it("wait for a match on court in another event", () => {
    const now = DAY_START + 60 * MIN;
    const cats = [category("md", 1), category("xd", 2)];
    const matches = [
      match("live", "md", { team_a_id: "mdA", team_b_id: "mdB", status: "live", court_number: 1, started_at: iso(now - 4 * MIN) }),
      match("xd-1", "xd", { slot_idx: 0, team_a_id: "xdA", team_b_id: "xdB" }),
      match("xd-2", "xd", { slot_idx: 1, team_a_id: "xdC", team_b_id: "xdD" }),
    ];
    const teams = [team("mdA", "P", "Q"), team("mdB", "R", "S"), team("xdA", "P", "U"), team("xdB", "V", "W"), team("xdC", "X", "Y"), team("xdD", "Z", "Z2")];
    const s = projectVenue(matches, cats, 2, now, { timing: T, teams });
    // Court 2 is free: xd-2 goes now, though xd-1 is first in the queue, because P is on court 1 until +8.
    // Court 1 is ready at +10 after the changeover; court 2 not until +18.
    expect(at(s, "xd-2", now)).toBe(0);
    expect(at(s, "xd-1", now)).toBe(10);
  });
});

describe("learning the venue's turnaround from the day", () => {
  const prior = { callToServeMin: 4, changeoverMin: 2 };

  it("keeps the fixed numbers until there are three samples", () => {
    const base = DAY_START;
    const matches = [played("m1", 1, base, 0, 7, 19), played("m2", 1, base, 22, 29, 41)];
    // Two walk-ons and one changeover so far.
    expect(learnTurnaround(matches, prior)).toEqual(prior);
  });

  it("learns call to serve and the score-to-next-call gap on each court, newest weighted most", () => {
    const base = DAY_START;
    // Court 1: three turns of 7 min walk-on, 12 play, 3 min to the next call.
    const matches = [
      played("m1", 1, base, 0, 7, 19),
      played("m2", 1, base, 22, 29, 41),
      played("m3", 1, base, 44, 51, 63),
      played("m4", 1, base, 66, 73, 85),
    ];
    expect(learnTurnaround(matches, prior)).toEqual({ callToServeMin: 7, changeoverMin: 3 });
  });

  it("counts a call made before the score was in as no gap, and skips idle courts and walkovers", () => {
    const base = DAY_START;
    const matches = [
      played("m1", 1, base, 0, 5, 17),
      played("m2", 1, base, 16, 21, 33), // called a minute before m1's score: 0
      played("m3", 1, base, 34, 39, 51), // 1 minute after m2
      played("m4", 1, base, 80, 85, 97), // 29 minutes after m3: an idle court, skipped
      played("m5", 1, base, 98, 103, 115), // 1 minute after m4
      played("wo", 2, base, 0, 0, 1, { is_walkover: true }),
      match("next2", "a", { team_a_id: "q1", team_b_id: "q2", court_number: 2, court_allocated_at: iso(base + 20 * MIN) }),
    ];
    const t = learnTurnaround(matches, prior);
    expect(t.callToServeMin).toBe(5);
    // Samples newest first: 1 (m4→m5), 1 (m2→m3), 0 (m1→m2): weights 3, 2, 1.
    expect(t.changeoverMin).toBeCloseTo(5 / 6, 5);
  });

  it("gives an event with no finished matches the venue's pace so far", () => {
    const now = DAY_START + 60 * MIN;
    // Event a: three 15-minute games (planned 12). Event b hasn't played yet.
    const history = [played("m1", 1, DAY_START, 0, 0, 15), played("m2", 2, DAY_START, 0, 0, 15), played("m3", 3, DAY_START, 0, 0, 15)];
    const queued = [match("b-0", "b", { slot_idx: 0, team_a_id: "b1", team_b_id: "b2" }), match("b-1", "b", { slot_idx: 1, team_a_id: "b3", team_b_id: "b4" })];
    const s = projectVenue([...history, ...queued], [category("a", 1), category("b", 2)], 1, now, { timing: T });
    expect(venuePace(history, () => 12)).toBe(1.25);
    // b-0 called now, serve +4, 15 minutes of play, changeover: b-1 at +21.
    expect(at(s, "b-1", now)).toBe(21);
  });

  it("moves the projection when the day runs slower than the fixed numbers", () => {
    const now = DAY_START + 90 * MIN;
    const history = [
      played("m1", 1, DAY_START, 0, 7, 19),
      played("m2", 1, DAY_START, 22, 29, 41),
      played("m3", 1, DAY_START, 44, 51, 63),
      played("m4", 1, DAY_START, 66, 73, 85),
    ];
    const queued = [match("q1", "a", { slot_idx: 10, team_a_id: "a1", team_b_id: "a2" }), match("q2", "a", { slot_idx: 11, team_a_id: "a3", team_b_id: "a4" })];
    const learning = projectVenue([...history, ...queued], [category("a", 1)], 1, now, { timing: { ...T, learnTurnaround: true } });
    const fixed = projectVenue([...history, ...queued], [category("a", 1)], 1, now, { timing: T });
    expect(learning.turnaround).toEqual({ callToServeMin: 7, changeoverMin: 3 });
    expect(fixed.turnaround).toEqual({ callToServeMin: 4, changeoverMin: 2 });
    // m4's score at 85 plus the changeover is already past, so q1 goes now; q2 a whole turn later.
    expect(at(learning, "q1", now)).toBe(0);
    expect(at(learning, "q2", now)).toBe(22);
    expect(at(fixed, "q2", now)).toBe(18);
  });
});

describe("the phones' output", () => {
  it("keeps useScheduling's shape: no finish or turnaround fields", () => {
    const s = projectSchedule(event("a", 2), [category("a", 1)], 2, DAY_START);
    expect(Object.keys(s).sort()).toEqual(["byId", "liveByCourt", "projected", "tournamentDeltaLabel", "tournamentDeltaMin"]);
  });
});
