import { describe, expect, it } from "vitest";
import type { Category, Match, Player, Team, Tournament } from "../../types";
import { buildTvModel, type TvModel, type TvSnapshot } from "./tvModel";
import { buildStats } from "./tvStats";
import { championCardHTML, matchupCardHTML, matchupHTML } from "./tvCards";
import {
  CALL_FRESH_MS, CALL_MOMENT_MS, CHAMP_MOMENT_MS, MAX_MOMENTS, callMoment, callStillOn, champMoment, champStillOn, decided,
  CALL_MOMENTS_ON, callsToShow, newCalls, newChampions, nextHighlight, queueMoment, type Moment,
} from "./tvMoments";
import { winnerPhotosByEvent } from "../champions/winnerPhoto";

const NOW = Date.parse("2026-11-21T21:12:00Z"); // 2:12 pm in Abbotsford (UTC-7)
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const BASE = "https://example.supabase.co";
const PHOTO = `${BASE}/storage/v1/object/public/player-photos/p1.jpeg`;
const WINNERS = `${BASE}/storage/v1/object/public/player-photos/winners/mx/1.jpg`;
const UUID_A = "11111111-1111-4111-8111-111111111111", UUID_B = "22222222-2222-4222-8222-222222222222";

function tournament(): Tournament {
  return {
    id: "t1", name: "TV Test Cup", event_date: "2026-11-21", phase: "group", rounds_per_pair: 1, num_courts: 4, created_at: iso(NOW - 86_400_000),
    venue_name: "North Gym", venue_address: null, venue_map_url: null, event_time: "09:00:00", registration_deadline: null, contact_info: null,
    e_transfer_email: null, fees: {}, registration_open: false, terms_text: null, slug: "tv-test", rules_url: null, waiver_url: null,
    waiver_text: null, waiver_version: null, youth_price: null, student_price: null, student_label: null, whatsapp_enabled: false, whatsapp_number: null,
  };
}
function category(id: string, name: string, sort: number, over: Partial<Category> = {}): Category {
  return {
    id, tournament_id: "t1", name, team_size: 2, match_minutes: 12, starts_at: null, phase: "group", rounds_per_pair: 1, groups_count: 1,
    top_n_advance: 2, sort_order: sort, created_at: iso(NOW), age_band: null, allow_solo_signup: false, has_bronze_match: false, price: null, price_basis: "per_team", ...over,
  };
}
let pid = 0;
function player(name: string, photo: string | null = null): Player {
  pid++;
  return { id: `p${pid}`, tournament_id: "t1", name, color: "#000", photo_url: photo, note: null, active: true, sort_order: pid, checked_in_at: null, email: null };
}
function team(id: string, cat: string, p1: Player, p2: Player | null): Team { return { id, tournament_id: "t1", category_id: cat, name: "", p1_id: p1.id, p2_id: p2?.id ?? null, sort_order: 0 }; }
function match(id: string, cat: string, over: Partial<Match>): Match {
  return {
    id, tournament_id: "t1", category_id: cat, stage: "group", group_idx: 0, round_idx: null, slot_idx: 0, team_a_id: null, team_b_id: null,
    score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false, is_walkover: false, status: "pending", started_at: null,
    scheduled_at: null, confirmed_at: null, court_number: null, court_allocated_at: null, queue_position: null, extended_minutes: 0, is_bronze: false, ...over,
  };
}

type Stage = {
  /** g2 (tC v tD): "waiting", "called" this many ms ago, or "live". */
  g2?: "waiting" | "live" | number;
  /** The mixed final: not played, or won by x1 two games to one. */
  final?: "pending" | "won";
  /** The youth singles round robin of three: decided when every match is in. */
  youthDone?: boolean;
};

/**
 * Men's doubles group (tA, tB, tC, tD), a mixed doubles final (x1 v x2) and a youth girls'
 * singles round robin of three (y1, y2, y3). One player's name carries markup, to prove escaping.
 */
function model(stage: Stage = {}, now = NOW): TvModel {
  pid = 0;
  const raj = player("Rajinder Mann", PHOTO), bal = player("Balraj Dhillon"), pet = player("Peter Chan"), hen = player("Henry Leung");
  const kev = player("Kevin Braun"), ste = player("Steve <b>Neufeld</b>"), jat = player("Jatinder Bhullar"), kul = player("Kulvir Rai");
  const ash = player("Asha Gill"), mon = player("Mona Sidhu"), lee = player("Lee Meng");
  const ha = player("Harini Jagan"), ju = player("Juliana Rhayne Eleguin"), va = player("Vaishanvi Krishna");
  const md = category("md", "Men's Doubles 35+", 1);
  const mx = category("mx", "Mixed Doubles 18–34", 2, { phase: "knockout", groups_count: 0, top_n_advance: 0 });
  const yg = category("yg", "Youth Girls' Singles", 3, { team_size: 1, groups_count: 1, top_n_advance: 0 });
  const teams = [
    team("tA", "md", raj, bal), team("tB", "md", pet, hen), team("tC", "md", kev, ste), team("tD", "md", jat, kul),
    team("x1", "mx", raj, ash), team("x2", "mx", mon, lee), team("y1", "yg", ha, null), team("y2", "yg", ju, null), team("y3", "yg", va, null),
  ];
  const g2: Partial<Match> = stage.g2 === "live"
    ? { status: "live", score_a: 3, score_b: 2, court_number: 2, court_allocated_at: iso(now - 6 * MIN), started_at: iso(now - 2 * MIN) }
    : typeof stage.g2 === "number" ? { court_number: 2, court_allocated_at: iso(now - stage.g2) } : {};
  const fin: Partial<Match> = stage.final === "won"
    ? { score_a: 2, score_b: 1, winner_id: "x1", confirmed: true, status: "completed", confirmed_at: iso(now - MIN), best_of: 3, games: [[15, 10], [12, 15], [15, 8]] }
    : {};
  const yDone = (id: string, a: string, b: string, slot: number): Match =>
    match(id, "yg", { slot_idx: slot, team_a_id: a, team_b_id: b, ...(stage.youthDone ? { score_a: 15, score_b: 9, winner_id: a, confirmed: true, status: "completed", confirmed_at: iso(now - (10 - slot) * MIN) } : {}) });
  const matches: Match[] = [
    match("g1", "md", { team_a_id: "tA", team_b_id: "tB", score_a: 15, score_b: 9, winner_id: "tA", confirmed: true, status: "completed", confirmed_at: iso(now - 50 * MIN) }),
    match("g2", "md", { slot_idx: 1, team_a_id: "tC", team_b_id: "tD", ...g2 }),
    match("g3", "md", { slot_idx: 2, team_a_id: "tA", team_b_id: "tC" }),
    match("f1", "mx", { stage: "knockout", group_idx: null, round_idx: 0, team_a_id: "x1", team_b_id: "x2", ...fin }),
    yDone("r1", "y1", "y2", 0), yDone("r2", "y1", "y3", 1), yDone("r3", "y2", "y3", 2),
  ];
  const snap: TvSnapshot = { tournament: tournament(), players: [raj, bal, pet, hen, kev, ste, jat, kul, ash, mon, lee, ha, ju, va], teams, matches, categories: [md, mx, yg], generated_at: now / 1000 };
  return buildTvModel(snap, now)!;
}

describe("court calls", () => {
  it("picks up a match the moment it is called, once", () => {
    const before = model(), called = model({ g2: 20_000 });
    expect(newCalls(before, called, NOW).map(m => m.id)).toEqual(["g2"]);
    expect(newCalls(called, called, NOW)).toEqual([]);                    // the same feed again
    expect(newCalls(called, model({ g2: "live" }), NOW)).toEqual([]);     // it went on: not a new call
    expect(newCalls(before, before, NOW)).toEqual([]);
  });
  it("gives a call no cut-in while court-call cards are switched off, and one each when they are on", () => {
    const before = model(), called = model({ g2: 20_000 });
    expect(CALL_MOMENTS_ON).toBe(false);
    expect(callsToShow(before, called, NOW)).toEqual([]);
    expect(callsToShow(before, called, NOW, true).map(m => m.id)).toEqual(["g2"]);
    expect(callsToShow(called, called, NOW, true)).toEqual([]);
  });
  it("leaves out a call that is old news (the TV was asleep or has just reconnected)", () => {
    expect(newCalls(model(), model({ g2: CALL_FRESH_MS + 5_000 }), NOW)).toEqual([]);
    expect(newCalls(model(), model({ g2: CALL_FRESH_MS - 5_000 }), NOW).map(m => m.id)).toEqual(["g2"]);
  });
  it("shows a queued call only while the match is still called or has just gone on", () => {
    expect(callStillOn(model({ g2: 20_000 }), "g2")).toBe(true);
    expect(callStillOn(model({ g2: "live" }), "g2")).toBe(true);
    expect(callStillOn(model(), "g2")).toBe(false);          // the call was taken back
    expect(callStillOn(model(), "g1")).toBe(false);          // finished
    expect(callStillOn(model(), "nope")).toBe(false);
  });
  it("draws the call as a match-up card with the court and the minutes to get there", () => {
    const m = model({ g2: 20_000 });
    const html = matchupCardHTML(m, buildStats(m), m.byId.g2, false, () => true, { minutes: 10 });
    expect(html).toContain("Now calling · Court 2");
    expect(html).toContain("Be on court within 10 min");
    expect(html).toContain("Men&#39;s Doubles 35+");
    expect(html).toContain("Kevin");
    expect(html).toContain("&lt;b&gt;Neufeld&lt;/b&gt;");   // a name is text, never markup
    expect(html).not.toContain("<b>Neufeld</b>");
  });
  it("never prints 'Court' without its number", () => {
    const m = model({ g2: 20_000 });
    const html = matchupCardHTML(m, buildStats(m), { ...m.byId.g2, court: null }, false, () => true, { minutes: 10 });
    expect(html).toContain("Now calling");
    expect(html).not.toContain("Court");
  });
  it("keeps the rotating match-up board as it was", () => {
    const m = model({ g2: 20_000 }), s = buildStats(m);
    const board = matchupHTML(m, s, 0, false, () => true);
    expect(board).toContain("Now calling · Court 2");
    expect(board).not.toContain("Be on court within");
    expect(board).toBe(matchupCardHTML(m, s, m.byId.g2, false, () => true));
  });
});

describe("champions", () => {
  it("picks up an event the moment it is decided, once", () => {
    const before = model(), after = model({ final: "won" });
    expect(newChampions(before, after).map(c => c.id)).toEqual(["mx"]);
    expect(newChampions(after, after)).toEqual([]);
    expect(newChampions(before, before)).toEqual([]);
  });
  it("covers a round robin with no final", () => {
    expect(newChampions(model(), model({ youthDone: true })).map(c => c.id)).toEqual(["yg"]);
  });
  it("drops a champions card when the result is undone", () => {
    expect(champStillOn(model({ final: "won" }), "mx")).toBe(true);
    expect(champStillOn(model(), "mx")).toBe(false);
    expect(champStillOn(model(), "nope")).toBe(false);
  });
  it("goes round the decided events for the highlights", () => {
    const m = model({ final: "won", youthDone: true });
    expect(decided(m).map(c => c.id)).toEqual(["mx", "yg"]);
    expect(nextHighlight(m, null)?.id).toBe("mx");
    expect(nextHighlight(m, "mx")?.id).toBe("yg");
    expect(nextHighlight(m, "yg")?.id).toBe("mx");
    expect(nextHighlight(model(), null)).toBeNull();
  });
  it("draws the champions with their own pictures, how they won and against whom", () => {
    const m = model({ final: "won" });
    const html = championCardHTML(m, buildStats(m), m.catById.mx, () => true, null);
    expect(html).toContain("Champions");
    expect(html).toContain("Mixed Doubles 18–34");
    expect(html).toContain("Won the final 2–1");
    expect(html).toContain("against");
    expect(html).toContain("Mann");
    expect(html).toContain("Gill");
    expect(html).toContain(`<img src="${PHOTO}"`);
    expect(html).not.toContain("chm photo");
  });
  it("puts the winners photo on the card when there is one, and falls back when it failed to load", () => {
    const m = model({ final: "won" }), s = buildStats(m);
    const withPhoto = championCardHTML(m, s, m.catById.mx, () => true, WINNERS);
    expect(withPhoto).toContain("chm photo");
    expect(withPhoto).toContain(`<img src="${WINNERS}"`);
    expect(withPhoto).toContain("Rajinder Mann");
    expect(withPhoto).toContain("Asha Gill");
    const broken = championCardHTML(m, s, m.catById.mx, url => url !== WINNERS, WINNERS);
    expect(broken).not.toContain("chm photo");
    expect(broken).not.toContain(WINNERS);
  });
  it("says a single champion and a round robin plainly", () => {
    const m = model({ youthDone: true });
    const html = championCardHTML(m, buildStats(m), m.catById.yg, () => true, null);
    expect(html).toContain(">Champion<");
    expect(html).not.toContain("Champions<");
    expect(html).toContain("Won the round robin");
    expect(html).toContain("Jagan");
  });
  it("never puts a link with quotes or brackets into a style attribute", () => {
    const m = model({ final: "won" });
    const odd = `${BASE}/storage/v1/object/public/player-photos/a);background:url(x`;
    const html = championCardHTML(m, buildStats(m), m.catById.mx, () => true, odd);
    expect(html).not.toContain("background-image");
    expect(html).toContain("chm photo");
  });
});

describe("the queue of moments", () => {
  it("never queues the same moment twice and keeps the newest when full", () => {
    const q: Moment[] = [], seen = new Set<string>();
    const m = model({ g2: 20_000 });
    expect(queueMoment(q, seen, callMoment(m.byId.g2))).toBe(true);
    expect(queueMoment(q, seen, callMoment(m.byId.g2))).toBe(false);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "call", matchId: "g2", dur: CALL_MOMENT_MS });
    for (let i = 0; i < MAX_MOMENTS + 3; i++) queueMoment(q, seen, champMoment("mx", "highlight", String(i)));
    expect(q).toHaveLength(MAX_MOMENTS);
    expect(q[q.length - 1]).toMatchObject({ kind: "champ", catId: "mx", dur: CHAMP_MOMENT_MS, reason: "highlight" });
  });
  it("gives a match called again after its call was taken back a new moment", () => {
    const a = callMoment(model({ g2: 20_000 }).byId.g2), b = callMoment(model({ g2: 50_000 }).byId.g2);
    expect(a.id).not.toBe(b.id);
  });
});

describe("winners photos", () => {
  it("keeps only photos held in this project's own storage, by event", () => {
    const rows = [
      { category_id: UUID_A, photo_url: WINNERS },
      { category_id: UUID_B, photo_url: "https://evil.example/storage/v1/object/public/player-photos/x.jpg" },
      { category_id: "not-an-id", photo_url: WINNERS },
      { category_id: UUID_B, photo_url: "javascript:alert(1)" },
      null,
    ];
    expect(winnerPhotosByEvent(rows, BASE)).toEqual({ [UUID_A]: WINNERS });
    expect(winnerPhotosByEvent("nope", BASE)).toEqual({});
    expect(winnerPhotosByEvent(rows, "")).toEqual({});
  });
});
