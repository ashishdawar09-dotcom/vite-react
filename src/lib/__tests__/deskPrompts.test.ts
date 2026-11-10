import { describe, expect, it } from "vitest";
import type { Category, Match, ProjectedMatch } from "../../types";
import { eventsReadyForKnockout, isWaitingForCall, onDeckMatches, venueDate } from "../deskPrompts";

const MIN = 60_000;
const NOW = Date.parse("2026-11-21T18:00:00Z"); // 11:00 am at the venue (UTC-7)

function category(id: string, sort: number, over: Partial<Category> = {}): Category {
  return {
    id, tournament_id: "t1", name: id, team_size: 2, match_minutes: 15, starts_at: null, phase: "group", rounds_per_pair: 1, groups_count: 2,
    top_n_advance: 1, sort_order: sort, created_at: new Date(NOW).toISOString(), age_band: null, allow_solo_signup: false, has_bronze_match: false, price: null, price_basis: "per_team", ...over,
  };
}
function match(id: string, cat: string, over: Partial<Match> = {}): Match {
  return {
    id, tournament_id: "t1", category_id: cat, stage: "group", group_idx: 0, round_idx: null, slot_idx: 0, team_a_id: `${id}-a`, team_b_id: `${id}-b`,
    score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false, is_walkover: false, status: "pending", started_at: null,
    scheduled_at: null, confirmed_at: null, court_number: null, court_allocated_at: null, queue_position: null, extended_minutes: 0, is_bronze: false, ...over,
  };
}
const done = (id: string, cat: string, over: Partial<Match> = {}) => match(id, cat, { confirmed: true, status: "completed", winner_id: `${id}-a`, ...over });
function projected(m: Match, atMin: number): ProjectedMatch {
  return { ...m, projected_start_at: new Date(NOW + atMin * MIN).toISOString(), delta_min: atMin, delta_label: "" };
}

describe("eventsReadyForKnockout", () => {
  it("lists events whose group matches are all in and whose knockout hasn't started, in event order", () => {
    const cats = [category("b", 2), category("a", 1), category("c", 3)];
    const matches = [
      done("a1", "a"), done("a2", "a"),
      done("b1", "b"), done("b2", "b"),
      done("c1", "c"), match("c2", "c"),
    ];
    expect(eventsReadyForKnockout(cats, matches)).toEqual(["a", "b"]);
  });

  it("drops an event once its knockout exists", () => {
    const cats = [category("a", 1)];
    const matches = [done("a1", "a"), match("ko", "a", { stage: "knockout", group_idx: null, round_idx: 0 })];
    expect(eventsReadyForKnockout(cats, matches)).toEqual([]);
  });

  it("leaves out round-robin-only events (the group winner is the champion) and events with no groups", () => {
    const cats = [category("rr", 1, { groups_count: 1, top_n_advance: 0 }), category("final", 2)];
    const matches = [done("rr1", "rr"), match("f", "final", { stage: "knockout", group_idx: null, round_idx: 0 })];
    expect(eventsReadyForKnockout(cats, matches)).toEqual([]);
  });

  it("counts a cancelled or walkover group match as done", () => {
    const cats = [category("a", 1)];
    const matches = [done("a1", "a", { winner_id: null }), done("a2", "a", { is_walkover: true })];
    expect(eventsReadyForKnockout(cats, matches)).toEqual(["a"]);
  });
});

describe("isWaitingForCall", () => {
  it("is a pending match with both teams that hasn't been called", () => {
    expect(isWaitingForCall(match("m", "a"))).toBe(true);
    expect(isWaitingForCall(match("m", "a", { court_allocated_at: new Date(NOW).toISOString(), court_number: 1 }))).toBe(false);
    expect(isWaitingForCall(match("m", "a", { status: "live" }))).toBe(false);
    expect(isWaitingForCall(match("m", "a", { team_b_id: null }))).toBe(false);
    expect(isWaitingForCall(match("m", "a", { is_bye: true }))).toBe(false);
    expect(isWaitingForCall(done("m", "a"))).toBe(false);
  });
});

describe("onDeckMatches", () => {
  const opts = { count: 2, withinMin: 12 };

  it("takes the front of Up next whose court call is close", () => {
    const list = [projected(match("m3", "a"), 20), projected(match("m1", "a"), 4), projected(match("m2", "b"), 9)];
    expect(onDeckMatches(list, NOW, opts).map(m => m.id)).toEqual(["m1", "m2"]);
  });

  it("only looks at the first `count` waiting matches, and only within the time window", () => {
    const list = [projected(match("m1", "a"), 2), projected(match("m2", "a"), 13), projected(match("m3", "a"), 14)];
    expect(onDeckMatches(list, NOW, opts).map(m => m.id)).toEqual(["m1"]);
    expect(onDeckMatches(list, NOW, { count: 1, withinMin: 60 }).map(m => m.id)).toEqual(["m1"]);
  });

  it("skips called matches, matches still waiting for a team, and matches with a team sitting out", () => {
    const list = [
      projected(match("called", "a", { court_number: 1, court_allocated_at: new Date(NOW).toISOString() }), 0),
      projected(match("tbd", "a", { team_b_id: null }), 1),
      projected(match("out", "a"), 2),
      projected(match("ok", "a"), 3),
    ];
    const sittingOut = (t: string) => t === "out-b";
    expect(onDeckMatches(list, NOW, { ...opts, sittingOut }).map(m => m.id)).toEqual(["ok"]);
  });

  it("sends nothing days before the event: a match projected for race morning is far away", () => {
    const twoDaysEarly = NOW - 2 * 24 * 60 * MIN;
    expect(onDeckMatches([projected(match("m1", "a"), 0)], twoDaysEarly, opts)).toEqual([]);
  });
});

describe("venueDate", () => {
  it("is the date at the venue (UTC-7), not in UTC", () => {
    expect(venueDate(Date.parse("2026-11-22T03:30:00Z"))).toBe("2026-11-21"); // 8:30 pm Nov 21 at the venue
    expect(venueDate(Date.parse("2026-11-21T07:30:00Z"))).toBe("2026-11-21"); // 12:30 am Nov 21
    expect(venueDate(Date.parse("2026-11-21T06:30:00Z"))).toBe("2026-11-20"); // 11:30 pm Nov 20
  });
});
