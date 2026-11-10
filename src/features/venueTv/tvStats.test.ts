import { describe, expect, it } from "vitest";
import type { Category, Match, Player, Team, Tournament } from "../../types";
import { buildTvModel, safePhotoUrl, type TvModel, type TvSnapshot } from "./tvModel";
import { buildStats, championOf, counts, leadersReady, matchPoints, matchupMatches, nextFor, spotlightPeople } from "./tvStats";
import { fitPx, initials, leaderEvents, leadersHTML, matchupHTML, splitName, spotlightHTML } from "./tvCards";

const NOW = Date.parse("2026-11-21T21:12:00Z"); // 2:12 pm in Abbotsford (UTC-7)
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const PHOTO = "https://example.supabase.co/storage/v1/object/public/player-photos/p1.jpeg";

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
const done = (id: string, cat: string, a: string, b: string, sa: number, sb: number, minsAgo: number, over: Partial<Match> = {}) =>
  match(id, cat, { team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, winner_id: sa > sb ? a : b, confirmed: true, status: "completed", confirmed_at: iso(NOW - minsAgo * MIN), ...over });

/**
 * Men's doubles round robin of four (tA, tB, tC, tD) and a mixed doubles best-of-3 final (x1 beat x2).
 * Rajinder Mann plays both events and has a photo; Peter's and Henry's photo links are not https.
 */
function fixture(): TvModel {
  pid = 0;
  const raj = player("Rajinder Mann", PHOTO), bal = player("Balraj Dhillon"), pet = player("Peter Chan", "javascript:alert(1)"), hen = player("Henry Leung", "http://example.com/h.jpg");
  const kev = player("Kevin Braun"), ste = player("Steve Neufeld"), jat = player("Jatinder Bhullar"), kul = player("Kulvir Rai");
  const ash = player("Asha Gill"), mon = player("Mona Sidhu"), lee = player("Lee Meng");
  const md = category("md", "Men's Doubles 35+", 1);
  const mx = category("mx", "Mixed Doubles 18–34", 2, { phase: "knockout", groups_count: 0, top_n_advance: 0 });
  const teams = [team("tA", "md", raj, bal), team("tB", "md", pet, hen), team("tC", "md", kev, ste), team("tD", "md", jat, kul), team("x1", "mx", raj, ash), team("x2", "mx", mon, lee)];
  const matches: Match[] = [
    done("g1", "md", "tA", "tB", 15, 9, 50),
    done("g2", "md", "tC", "tD", 13, 15, 45, { slot_idx: 1 }),
    match("g3", "md", { slot_idx: 2, team_a_id: "tA", team_b_id: "tC", winner_id: "tA", confirmed: true, is_walkover: true, status: "completed", confirmed_at: iso(NOW - 40 * MIN) }),
    done("g4", "md", "tB", "tD", 15, 13, 35, { slot_idx: 3 }),
    done("g5", "md", "tA", "tD", 12, 15, 30, { slot_idx: 4 }),
    match("gx", "md", { slot_idx: 5, team_a_id: "tB", team_b_id: "tC", confirmed: true, status: "completed", confirmed_at: iso(NOW - 25 * MIN) }), // cancelled: no winner
    done("f1", "mx", "x1", "x2", 2, 1, 20, { stage: "knockout", group_idx: null, round_idx: 0, best_of: 3, games: [[15, 10], [12, 15], [15, 8]] }),
    match("c1", "md", { slot_idx: 6, team_a_id: "tC", team_b_id: "tD", court_number: 2, court_allocated_at: iso(NOW - 2 * MIN) }), // called
    match("q1", "md", { slot_idx: 7, team_a_id: "tA", team_b_id: "tB" }), // waiting
  ];
  const snap: TvSnapshot = { tournament: tournament(), players: [raj, bal, pet, hen, kev, ste, jat, kul, ash, mon, lee], teams, matches, categories: [md, mx], generated_at: NOW / 1000 };
  return buildTvModel(snap, NOW)!;
}

describe("photo links", () => {
  it("keeps https links only", () => {
    expect(safePhotoUrl(PHOTO)).toBe(PHOTO);
    expect(safePhotoUrl("javascript:alert(1)")).toBeNull();
    expect(safePhotoUrl("http://example.com/a.jpg")).toBeNull();
    expect(safePhotoUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safePhotoUrl("not a url")).toBeNull();
    expect(safePhotoUrl("")).toBeNull();
    expect(safePhotoUrl(null)).toBeNull();
  });
  it("gives every entered player one person with their events and checked photo", () => {
    const m = fixture();
    const raj = Object.values(m.people).find(p => p.name === "Rajinder Mann")!;
    expect(raj.photo).toBe(PHOTO);
    expect(raj.teamIds.sort()).toEqual(["tA", "x1"]);
    expect(Object.values(m.people).find(p => p.name === "Peter Chan")!.photo).toBeNull();
    expect(Object.values(m.people).find(p => p.name === "Henry Leung")!.photo).toBeNull();
    expect(m.teams.tA.pids).toHaveLength(2);
  });
});

describe("player and team stats", () => {
  it("counts finished matches only, walkovers without points, best of 3 by its games", () => {
    const m = fixture();
    expect(counts(m.byId.gx)).toBe(false); // cancelled
    expect(counts(m.byId.q1)).toBe(false);
    expect(matchPoints(m.byId.g3)).toBeNull(); // walkover
    expect(matchPoints(m.byId.f1)).toEqual([42, 33]);
    expect(matchPoints(m.byId.g1)).toEqual([15, 9]);
    const s = buildStats(m);
    expect(s.results).toBe(6);
    expect(s.teams.tA).toMatchObject({ played: 3, won: 2, lost: 1, pointsFor: 27, pointsAgainst: 24, diff: 3, streak: 0, form: ["W", "W", "L"] });
    expect(s.teams.tC).toMatchObject({ played: 2, won: 0, lost: 2, pointsFor: 13, pointsAgainst: 15 });
    expect(s.teams.tD).toMatchObject({ played: 3, won: 2, lost: 1, diff: 3, streak: 1 });
  });
  it("adds a player's events together, in the order the matches finished", () => {
    const s = buildStats(fixture());
    const raj = s.ranking[0];
    expect(raj.person.name).toBe("Rajinder Mann");
    expect(raj).toMatchObject({ played: 4, won: 3, lost: 1, pointsFor: 69, pointsAgainst: 57, diff: 12, streak: 1, form: ["W", "W", "L", "W"] });
    expect(raj.best).toMatchObject({ matchId: "f1", for: 42, against: 33, oppTeamId: "x2" });
  });
  it("ranks by wins, then point difference, then fewer matches, then name", () => {
    const s = buildStats(fixture());
    expect(s.ranking.map(p => p.person.name).slice(0, 5)).toEqual(["Rajinder Mann", "Balraj Dhillon", "Jatinder Bhullar", "Kulvir Rai", "Asha Gill"]);
  });
  it("shows each event's leader, and the champion once an event is decided", () => {
    const m = fixture(), s = buildStats(m);
    expect(s.eventLeaders).toEqual([
      { catId: "md", teamId: "tA", won: 2, lost: 1, diff: 3, champion: false },
      { catId: "mx", teamId: "x1", won: 1, lost: 0, diff: 9, champion: true },
    ]);
    const asha = Object.values(m.people).find(p => p.name === "Asha Gill")!;
    expect(championOf(m, asha)).toBe("mx");
  });
  it("puts players with a photo first in the spotlight", () => {
    const s = buildStats(fixture());
    const list = spotlightPeople(s);
    expect(list[0].person.name).toBe("Rajinder Mann");
    expect(list.slice(1).every(p => !p.person.photo)).toBe(true);
  });
  it("offers the court being called first for the match-up, then the queue", () => {
    const m = fixture();
    expect(matchupMatches(m).map(x => x.id)).toEqual(["c1", "q1"]);
  });
  it("finds a player's next match across events", () => {
    const m = fixture();
    const raj = Object.values(m.people).find(p => p.name === "Rajinder Mann")!;
    expect(nextFor(m, raj)?.id).toBe("q1");
    const kev = Object.values(m.people).find(p => p.name === "Kevin Braun")!;
    expect(nextFor(m, kev)?.id).toBe("c1");
  });
  it("waits for a few results before the leader boards show", () => {
    const m = fixture();
    expect(leadersReady(buildStats(m))).toBe(true);
    const few = { ...m, matches: m.matches.filter(x => x.id === "g1" || x.id === "q1") };
    expect(leadersReady(buildStats(few))).toBe(false);
  });
  it("has nothing to show before any match is played", () => {
    const m = fixture();
    const fresh = { ...m, matches: m.matches.filter(x => x.status !== "done") };
    const s = buildStats(fresh);
    expect(s.results).toBe(0);
    expect(spotlightPeople(s)).toEqual([]);
  });
});

describe("player boards", () => {
  const ok = () => true;
  it("splits names and makes initials", () => {
    expect(splitName("Gurmeet Singh Ghera")).toEqual(["Gurmeet Singh", "Ghera"]);
    expect(splitName("  Arif  ")).toEqual(["", "Arif"]);
    expect(initials("Gurmeet Singh Ghera")).toBe("GG");
    expect(initials("arif")).toBe("A");
    expect(initials("")).toBe("?");
  });
  it("shrinks long names to fit and keeps short ones at full size", () => {
    expect(fitPx("TALEWAD", 176, 1000)).toBe(176);
    expect(fitPx("KATHIRESANMOHAN", 176, 1000)).toBeLessThan(176);
    expect(fitPx("KATHIRESANMOHAN", 176, 1000) * 15 * 0.6).toBeLessThanOrEqual(1000);
  });
  it("draws the spotlight card with the photo, events, form and stats", () => {
    const m = fixture(), s = buildStats(m);
    const html = spotlightHTML(m, s, 0, false, ok);
    expect(html).toContain(`<img src="${PHOTO}"`);
    expect(html).toContain(">Rajinder<");
    expect(html).toContain(">Mann<");
    expect(html).toContain("2 events");
    expect(html).toContain("with <b>Balraj Dhillon</b>");
    expect(html).toContain("with <b>Asha Gill</b>");
    expect(html).toContain("Last 4 matches");
    expect(html).toMatch(/Played<\/span><span class="n">4</);
    expect(html).toMatch(/Won<\/span><span class="n">3</);
    expect(html).toMatch(/Points<\/span><span class="n">69</);
    expect(html).toMatch(/Point diff<\/span><span class="n">\+12</);
    expect(html).toContain("Rank today");
    expect(html).toContain(">Next<");
  });
  it("shows initials when the photo can't be used", () => {
    const m = fixture(), s = buildStats(m);
    const html = spotlightHTML(m, s, 0, false, () => false);
    expect(html).not.toContain("<img");
    expect(html).toContain('class="sp-photo ini"><b>RM</b>');
  });
  it("escapes names", () => {
    const m = fixture();
    const raj = Object.values(m.people).find(p => p.name === "Rajinder Mann")!;
    raj.name = 'Raj <img src=x onerror="alert(1)">';
    const html = spotlightHTML(m, buildStats(m), 0, false, ok);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
  it("draws the match-up of the court being called, with records and the comparison", () => {
    const m = fixture(), s = buildStats(m);
    const html = matchupHTML(m, s, 0, false, ok);
    expect(html).toContain("Now calling · Court 2");
    expect(html).toContain("Men&#39;s Doubles 35+ · Round robin");
    expect(html).toContain("<b>0–2</b>in the group");
    expect(html).toContain('class="mu-r"');
    expect(matchupHTML(m, s, 1, false, ok)).toContain("Up next");
  });
  it("keeps a leader's events line short enough to fit: 3 or more read as a count", () => {
    const c = (name: string, short: string) => ({ name, short });
    expect(leaderEvents([c("Men's Doubles 18–34", "Men's 18–34")])).toBe("Men's Doubles 18–34");
    expect(leaderEvents([c("Mixed Doubles 18–34", "Mixed 18–34"), c("Super Doubles 50+", "Super 50+")])).toBe("Mixed Doubles 18–34 · Super Doubles 50+");
    expect(leaderEvents([c("Women's Doubles 18–34", "Women's 18–34"), c("Mixed Doubles 18–34 extended", "Mixed 18–34")])).toBe("Women's 18–34 · Mixed 18–34");
    expect(leaderEvents([c("Mixed Doubles 35+", "Mixed 35+"), c("Mixed Doubles 18–34", "Mixed 18–34"), c("Men's Doubles 18–34", "Men's 18–34"), c("Men's Doubles 35+", "Men's 35+")])).toBe("4 events");
    expect(leaderEvents([c("A", "A"), c("B", "B"), c("C", "C")])).toBe("3 events");
  });
  it("draws the leaders: most wins with the photo, and each event's leader or champion", () => {
    const m = fixture(), s = buildStats(m);
    const html = leadersHTML(m, s, 0, false, ok);
    expect(html).toContain("after 6 matches");
    expect(html).toContain(`<img src="${PHOTO}"`);
    expect(html).toContain("<b>3</b><span>wins</span>");
    expect(html).toContain("Balraj Dhillon");
    expect(html).toContain("Champions");
    expect(html).toContain("<b>2–1</b>");
  });
});
