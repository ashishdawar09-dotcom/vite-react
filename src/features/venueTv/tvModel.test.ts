import { describe, expect, it } from "vitest";
import type { Category, Match, Player, Team, Tournament } from "../../types";
import { bracketOf, buildTvModel, FINAL_SCORE_HOLD_MS, parseMessages, projectQueue, shortCategoryName, standingsOf, tvStatus, type TvMatch, type TvSnapshot } from "./tvModel";
import { annList } from "./tvAnnouncements";
import { teamName } from "./tvNames";
import { ampm, clockSkewMs, hm } from "./tvTime";
import { projectSchedule } from "../../lib/projection";

const NOW = Date.parse("2026-11-21T21:12:00Z"); // 2:12 pm in Abbotsford (UTC-7)
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function tournament(over: Partial<Tournament> = {}): Tournament & { tv_messages?: unknown } {
  return {
    id: "t1", name: "TV Test Cup", event_date: "2026-11-21", phase: "group", rounds_per_pair: 1, num_courts: 4, created_at: iso(NOW - 86_400_000),
    venue_name: "North Gym", venue_address: null, venue_map_url: null, event_time: "09:30:00", registration_deadline: null, contact_info: null,
    e_transfer_email: null, fees: {}, registration_open: false, terms_text: null, slug: "tv-test", rules_url: null, waiver_url: null,
    waiver_text: null, waiver_version: null, youth_price: null, student_price: null, student_label: null, whatsapp_enabled: false, whatsapp_number: null,
    ...over,
  };
}
function category(id: string, name: string, sort: number, over: Partial<Category> = {}): Category {
  return {
    id, tournament_id: "t1", name, team_size: 2, match_minutes: 12, starts_at: null, phase: "group", rounds_per_pair: 1, groups_count: 2,
    top_n_advance: 2, sort_order: sort, created_at: iso(NOW), age_band: null, allow_solo_signup: false, has_bronze_match: false, price: null, price_basis: "per_team", ...over,
  };
}
let pid = 0;
function player(name: string): Player { pid++; return { id: `p${pid}`, tournament_id: "t1", name, color: "#000", photo_url: null, note: null, active: true, sort_order: pid, checked_in_at: null, email: null }; }
function team(id: string, cat: string, p1: Player, p2: Player | null): Team { return { id, tournament_id: "t1", category_id: cat, name: "", p1_id: p1.id, p2_id: p2?.id ?? null, sort_order: 0 }; }
function match(id: string, cat: string, over: Partial<Match>): Match {
  return {
    id, tournament_id: "t1", category_id: cat, stage: "group", group_idx: 0, round_idx: null, slot_idx: 0, team_a_id: null, team_b_id: null,
    score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false, is_walkover: false, status: "pending", started_at: null,
    scheduled_at: null, confirmed_at: null, court_number: null, court_allocated_at: null, queue_position: null, extended_minutes: 0, is_bronze: false, ...over,
  };
}

function fixture(): TvSnapshot {
  pid = 0;
  const ps = ["Rajinder Mann", "Balraj Dhillon", "Peter Chan", "Henry Leung", "Kevin Braun", "Steve Neufeld", "Jatinder Bhullar", "Kulvir Rai", "Arjun Mehta", "Ryan Fehr", "Kevin Tran", "Simon Yip"].map(player);
  const md = category("md", "Men's Doubles 35+", 1, { groups_count: 1, top_n_advance: 2 });
  const ms = category("ms", "Men's Singles", 2, { team_size: 1, groups_count: 1, top_n_advance: 2, phase: "knockout" });
  const teams = [
    team("tA", "md", ps[0], ps[1]), team("tB", "md", ps[2], ps[3]), team("tC", "md", ps[4], ps[5]), team("tD", "md", ps[6], ps[7]),
    team("s1", "ms", ps[8], null), team("s2", "ms", ps[9], null), team("s3", "ms", ps[10], null), team("s4", "ms", ps[11], null),
  ];
  const matches: Match[] = [
    // Men's doubles round robin: two done, one live on court 1, one called to court 2, two waiting.
    match("g1", "md", { slot_idx: 0, team_a_id: "tA", team_b_id: "tB", score_a: 21, score_b: 15, winner_id: "tA", confirmed: true, status: "completed", court_number: 1, started_at: iso(NOW - 40 * MIN), confirmed_at: iso(NOW - 25 * MIN) }),
    match("g2", "md", { slot_idx: 1, team_a_id: "tC", team_b_id: "tD", score_a: 18, score_b: 21, winner_id: "tD", confirmed: true, status: "completed", court_number: 2, started_at: iso(NOW - 38 * MIN), confirmed_at: iso(NOW - 24 * MIN) }),
    match("g3", "md", { slot_idx: 2, team_a_id: "tA", team_b_id: "tC", score_a: 20, score_b: 17, status: "live", court_number: 1, court_allocated_at: iso(NOW - 15 * MIN), started_at: iso(NOW - 11 * MIN) }),
    match("g4", "md", { slot_idx: 3, team_a_id: "tB", team_b_id: "tD", status: "pending", court_number: 2, court_allocated_at: iso(NOW - 2 * MIN) }),
    match("g5", "md", { slot_idx: 4, team_a_id: "tA", team_b_id: "tD", status: "pending" }),
    match("g6", "md", { slot_idx: 5, team_a_id: "tB", team_b_id: "tC", status: "pending" }),
    // Men's singles knockout: semifinal 1 done a moment ago on court 3, semifinal 2 waiting, final to be decided.
    match("k1", "ms", { stage: "knockout", group_idx: null, round_idx: 0, slot_idx: 0, team_a_id: "s1", team_b_id: "s2", score_a: 2, score_b: 1, best_of: 3, games: [[15, 12], [13, 15], [15, 9]], winner_id: "s1", confirmed: true, status: "completed", court_number: 3, started_at: iso(NOW - 30 * MIN), confirmed_at: iso(NOW - 5_000) }),
    match("k2", "ms", { stage: "knockout", group_idx: null, round_idx: 0, slot_idx: 1, team_a_id: "s3", team_b_id: "s4", status: "pending" }),
    match("k3", "ms", { stage: "knockout", group_idx: null, round_idx: 1, slot_idx: 0, team_a_id: "s1", team_b_id: null, status: "pending" }),
    match("bye", "ms", { stage: "knockout", group_idx: null, round_idx: 0, slot_idx: 2, team_a_id: "s4", is_bye: true, status: "completed", confirmed: true }),
  ];
  return { tournament: tournament(), players: ps, teams, matches, categories: [md, ms], generated_at: NOW / 1000 };
}

describe("venue TV times", () => {
  it("formats in fixed UTC-7, whatever the device's zone or tz data", () => {
    expect(hm(NOW)).toBe("2:12");
    expect(ampm(NOW)).toBe("pm");
    expect(hm(Date.parse("2026-11-21T16:30:00Z"))).toBe("9:30");
    expect(ampm(Date.parse("2026-11-21T16:30:00Z"))).toBe("am");
    expect(hm(Date.parse("2026-11-21T19:05:00Z"))).toBe("12:05");
  });
  it("corrects a TV clock that is minutes off, but ignores small differences", () => {
    expect(clockSkewMs(NOW / 1000, NOW - 5 * MIN)).toBe(5 * MIN);
    expect(clockSkewMs(NOW / 1000, NOW - 4_000)).toBe(0);
    expect(clockSkewMs(null, NOW)).toBe(0);
    expect(clockSkewMs(NOW / 1000, NOW - 48 * 3_600_000)).toBe(0);
  });
});

describe("venue TV model", () => {
  it("shortens category names for tight spots", () => {
    expect(shortCategoryName("Men's Doubles 35+")).toBe("Men's 35+");
    expect(shortCategoryName("Women’s Doubles 18–34")).toBe("Women’s 18–34");
    expect(shortCategoryName("Mixed Doubles 35+")).toBe("Mixed 35+");
    expect(shortCategoryName("Super Doubles 50+")).toBe("Super 50+");
    expect(shortCategoryName("Youth Boys' Singles")).toBe("Youth Boys'");
    expect(shortCategoryName("Men's Singles")).toBe("Men's Singles");
  });

  it("reads a court call as warming up, and a finished match as done", () => {
    expect(tvStatus({ status: "pending", confirmed: false, court_number: 2, court_allocated_at: iso(NOW) })).toBe("called");
    expect(tvStatus({ status: "pending", confirmed: false, court_number: 2, court_allocated_at: null })).toBe("queued");
    expect(tvStatus({ status: "live", confirmed: false, court_number: 1, court_allocated_at: iso(NOW) })).toBe("live");
    expect(tvStatus({ status: "completed", confirmed: true, court_number: 1, court_allocated_at: null })).toBe("done");
  });

  it("puts the right match on each court, with a just finished match held as Final score", () => {
    const m = buildTvModel(fixture(), NOW)!;
    expect(m.courts.map(c => c?.id ?? null)).toEqual(["g3", "g4", "k1", null]);
    expect(m.courts[0]!.status).toBe("live");
    expect(m.courts[1]!.status).toBe("called");
    expect(m.courts[2]!.ending).toBe(true);
    const later = buildTvModel(fixture(), NOW + FINAL_SCORE_HOLD_MS + 1_000)!;
    expect(later.courts[2]).toBeNull();
  });

  it("labels knockout rounds from the final backwards and reads each match's own format", () => {
    const m = buildTvModel(fixture(), NOW)!;
    expect(m.byId.k1.label).toBe("Semifinal 1");
    expect(m.byId.k1.bestOf3).toBe(true);
    expect(m.byId.k1.games).toEqual([[15, 12], [13, 15], [15, 9]]);
    // A semifinal is one game when its event isn't best of 3 there (matches.best_of = 1).
    expect(m.byId.k2.label).toBe("Semifinal 2");
    expect(m.byId.k2.bestOf3).toBe(false);
    expect(m.byId.k3.label).toBe("Final");
    expect(m.byId.g3.label).toBe("Round robin");
    expect(m.byId.g3.bestOf3).toBe(false);
    expect(m.byId.bye).toBeUndefined();
  });

  it("queues only matches with both sides known, and gives each an estimated time", () => {
    const m = buildTvModel(fixture(), NOW)!;
    expect(m.queue.map(x => x.id)).toEqual(expect.arrayContaining(["g5", "g6", "k2"]));
    expect(m.queue.some(x => x.id === "k3")).toBe(false);
    for (const q of m.queue) expect(q.eta).toBeGreaterThanOrEqual(NOW);
    // Court 4 is free, so the first match in the queue can start almost at once.
    expect(m.queue[0].eta! - NOW).toBeLessThanOrEqual(3 * MIN);
    expect(m.finish).toBeGreaterThan(NOW);
  });

  it("sends the next match to whichever court frees first", () => {
    const mk = (id: string, over: Partial<TvMatch>): TvMatch => ({ id, cat: "c", kind: "group", label: "", groupIdx: 0, roundIdx: null, slot: 0, bestOf3: false, games: [], a: "x", b: "y", cur: [0, 0], status: "queued", ending: false, court: null, calledAt: null, startedAt: null, doneAt: null, winner: null, walkover: false, cancelled: false, eta: null, ...over });
    const courts = [mk("l1", { status: "live", court: 1, startedAt: NOW - 10 * MIN }), mk("l2", { status: "live", court: 2, startedAt: NOW - 2 * MIN })];
    const q = [mk("q1", {}), mk("q2", {}), mk("q3", {})];
    projectQueue(q, courts, NOW, () => 12);
    // Court 1 frees at +2 min (+2 changeover), court 2 at +10 (+2).
    expect((q[0].eta! - NOW) / MIN).toBe(4);
    expect((q[1].eta! - NOW) / MIN).toBe(12);
    expect((q[2].eta! - NOW) / MIN).toBe(18);
  });

  it("holds back a match while one of its players is still on another court", () => {
    const mk = (id: string, over: Partial<TvMatch>): TvMatch => ({ id, cat: "c", kind: "group", label: "", groupIdx: 0, roundIdx: null, slot: 0, bestOf3: false, games: [], a: "x", b: "y", cur: [0, 0], status: "queued", ending: false, court: null, calledAt: null, startedAt: null, doneAt: null, winner: null, walkover: false, cancelled: false, eta: null, ...over });
    // Court 1: a match that ends in 8 minutes, with player P. Court 2 is free.
    const courts = [mk("l1", { status: "live", court: 1, startedAt: NOW - 4 * MIN, a: "tP", b: "tQ" }), null];
    const q1 = mk("q1", { a: "tP2", b: "tR" }); // P also plays in this one
    const q2 = mk("q2", { a: "tS", b: "tT" });
    const players: Record<string, string[]> = { tP: ["P"], tQ: ["Q"], tP2: ["P", "U"], tR: ["R"], tS: ["S"], tT: ["T"] };
    const { order } = projectQueue([q1, q2], courts, NOW, () => 12, m => [m.a, m.b].flatMap(id => (id ? players[id] : [])));
    expect(order.map(m => m.id)).toEqual(["q2", "q1"]);
    expect((q2.eta! - NOW) / MIN).toBe(2);
    // P is free at +8; court 1 is ready at +10 after the changeover.
    expect((q1.eta! - NOW) / MIN).toBe(10);
  });

  it("ranks groups with the shared standings rule", () => {
    const m = buildTvModel(fixture(), NOW)!;
    const rows = standingsOf(m, "md", 0);
    expect(rows[0].teamId).toBe("tA");
    expect(rows[0].won).toBe(1);
    expect(rows.find(r => r.teamId === "tD")!.won).toBe(1);
    expect(rows.reduce((s, r) => s + r.played, 0)).toBe(4);
  });

  it("builds the bracket by round with the final last", () => {
    const m = buildTvModel(fixture(), NOW)!;
    const b = bracketOf(m, "ms");
    expect(b.map(c => c.title)).toEqual(["Semifinals", "Final"]);
    expect(b[0].matches.map(x => x.id)).toEqual(["k1", "k2"]);
  });

  it("lists results newest first and players A to Z", () => {
    const m = buildTvModel(fixture(), NOW)!;
    expect(m.results.map(r => r.id)).toEqual(["k1", "g2", "g1"]);
    expect(m.players[0].name).toBe("Arjun Mehta");
    expect(m.players.length).toBe(12);
  });

  it("keeps only valid, current desk messages, newest first", () => {
    const raw = [
      { id: "a", text: "Lunch is open", style: "line", posted_at: iso(NOW - 10 * MIN), until: iso(NOW + 20 * MIN) },
      { id: "b", text: "Prize giving at 6:00 pm", style: "full", posted_at: iso(NOW - MIN), until: null },
      { id: "c", text: "Old", style: "line", posted_at: iso(NOW - 60 * MIN), until: iso(NOW - MIN) },
      { id: "d", text: "", style: "line", posted_at: iso(NOW) },
      "junk",
    ];
    const msgs = parseMessages(raw, NOW);
    expect(msgs.map(x => x.id)).toEqual(["b", "a"]);
    expect(msgs[0].style).toBe("full");
    expect(msgs[0].until).toBeNull();
    expect(parseMessages(null, NOW)).toEqual([]);
    expect(parseMessages({ not: "an array" }, NOW)).toEqual([]);
  });

  it("shortens long names in steps so nothing is cut off", () => {
    const m = buildTvModel(fixture(), NOW)!;
    expect(teamName(m, "tA", "full")).toBe("Rajinder Mann & Balraj Dhillon");
    expect(teamName(m, "tA", "fit", 22)).toBe("R. Mann & B. Dhillon");
    expect(teamName(m, "tA", "fit", 12)).toBe("Mann & Dhillon");
    expect(teamName(m, "tA", "last")).toBe("Mann & Dhillon");
    expect(teamName(m, null, "fit")).toBe("To be decided");
  });

  it("returns nothing without a tournament row", () => {
    expect(buildTvModel({ ...fixture(), tournament: null }, NOW)).toBeNull();
  });

  it("takes the venue-wide order from the app projection, so events take turns on the courts", () => {
    pid = 0;
    const cats = [category("e1", "Men's Doubles 35+", 1), category("e2", "Mixed Doubles 35+", 2)];
    const teams: Team[] = [];
    const matches: Match[] = [];
    for (const c of cats) {
      for (let i = 0; i < 3; i++) {
        const a = team(`${c.id}-a${i}`, c.id, player(`${c.id} A${i}`), player(`${c.id} A${i}'`));
        const b = team(`${c.id}-b${i}`, c.id, player(`${c.id} B${i}`), player(`${c.id} B${i}'`));
        teams.push(a, b);
        matches.push(match(`${c.id}-${i}`, c.id, { slot_idx: i, team_a_id: a.id, team_b_id: b.id }));
      }
    }
    const snap: TvSnapshot = { tournament: tournament({ num_courts: 2 }), players: [], teams, matches, categories: cats, generated_at: NOW / 1000 };
    const m = buildTvModel(snap, NOW, projectSchedule(matches, cats, 2, NOW).byId)!;
    expect(m.queue.map(x => x.id)).toEqual(["e1-0", "e2-0", "e1-1", "e2-1", "e1-2", "e2-2"]);
    // Two courts, each match 12 minutes plus the TV's 2 minute changeover.
    expect(m.queue.map(x => (x.eta! - NOW) / MIN)).toEqual([2, 2, 16, 16, 30, 30]);
  });

  it("waits for the events' start time on race morning, also for events with none of their own", () => {
    pid = 0;
    const nineThirty = Date.parse("2026-11-21T16:30:00Z");
    const early = nineThirty - 45 * MIN;
    const cats = [category("e1", "Men's Doubles 35+", 1, { starts_at: iso(nineThirty) }), category("e2", "Mixed Doubles 35+", 2)];
    const teams: Team[] = [];
    const matches: Match[] = [];
    for (const c of cats) {
      const a = team(`${c.id}-a`, c.id, player(`${c.id} A`), player(`${c.id} A'`));
      const b = team(`${c.id}-b`, c.id, player(`${c.id} B`), player(`${c.id} B'`));
      teams.push(a, b);
      matches.push(match(`${c.id}-0`, c.id, { team_a_id: a.id, team_b_id: b.id }));
    }
    const snap: TvSnapshot = { tournament: tournament(), players: [], teams, matches, categories: cats, generated_at: early / 1000 };
    const m = buildTvModel(snap, early, projectSchedule(matches, cats, 4, early).byId)!;
    expect(m.queue.map(x => x.eta)).toEqual([nineThirty, nineThirty]);
  });
});

describe("venue TV announcements", () => {
  it("calls first, then up next, the latest result and a reminder", () => {
    const m = buildTvModel(fixture(), NOW)!;
    const l = annList(m, 0, "badminton.adawar.org/t/tv-test");
    expect(l[0].type).toBe("call");
    expect(l[0].main).toContain("Court 2:");
    expect(l[0].sub).toContain("on court by 2:20");
    expect(l.filter(x => x.type === "next").length).toBe(3);
    expect(l.some(x => x.type === "result")).toBe(true);
    expect(l[l.length - 1].type).toBe("info");
    expect(l[l.length - 1].main).toContain("badminton.adawar.org/t/tv-test");
  });

  it("puts a desk message in as every third message", () => {
    const snap = fixture();
    snap.tournament!.tv_messages = [{ id: "m1", text: "Lunch is open", style: "line", posted_at: iso(NOW), until: null }];
    const m = buildTvModel(snap, NOW)!;
    const l = annList(m, 0, "x");
    expect(l.filter(x => x.type === "desk").length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < l.length; i += 3) expect(l[i].type).toBe("desk");
  });
});
