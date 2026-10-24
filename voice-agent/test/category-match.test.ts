import { describe, expect, it } from "vitest";
import { matchCategories } from "../src/format";
import { buildRulesForTopic } from "../src/rules";
import { answerStandings } from "../src/tools";
import type { Category, Match, Snapshot, Team } from "../src/types";

const NAMES = [
  "Men's Doubles 18–34",
  "Men's Doubles 35+",
  "Women's Doubles 18–34",
  "Women's Doubles 35+",
  "Mixed Doubles 18–34",
  "Mixed Doubles 35+",
  "Men's Singles",
  "Super Doubles 50+",
];
const cats = NAMES.map((name, i) => ({ id: `c${i}`, name }));
const pick = (q: string) => matchCategories(cats, q).map((c) => c.name);

describe("matchCategories", () => {
  it("prefers the exact name", () => {
    expect(pick("Men's Doubles 35+")).toEqual(["Men's Doubles 35+"]);
    expect(pick("women's doubles 18-34")).toEqual(["Women's Doubles 18–34"]);
  });

  it("never matches men's inside women's", () => {
    expect(pick("women's doubles")).toEqual(["Women's Doubles 18–34", "Women's Doubles 35+"]);
    expect(pick("men's doubles")).toEqual(["Men's Doubles 18–34", "Men's Doubles 35+"]);
    expect(pick("mens doubles")).toEqual(["Men's Doubles 18–34", "Men's Doubles 35+"]);
    expect(pick("men's")).toEqual(["Men's Doubles 18–34", "Men's Doubles 35+", "Men's Singles"]);
  });

  it("understands spoken age bands", () => {
    expect(pick("men's doubles 18 to 34")).toEqual(["Men's Doubles 18–34"]);
    expect(pick("mixed doubles 35 plus")).toEqual(["Mixed Doubles 35+"]);
    expect(pick("women's doubles 35 and over")).toEqual(["Women's Doubles 35+"]);
    expect(pick("mens 35+")).toEqual(["Men's Doubles 35+"]);
    expect(pick("35+")).toEqual(["Men's Doubles 35+", "Women's Doubles 35+", "Mixed Doubles 35+"]);
  });

  it("finds a full name said inside a longer question", () => {
    expect(pick("what are the rules for women's doubles 35+ please")).toEqual(["Women's Doubles 35+"]);
  });

  it("matches whole words only", () => {
    expect(pick("men")).toEqual(["Men's Doubles 18–34", "Men's Doubles 35+", "Men's Singles"]);
    expect(pick("double")).toHaveLength(7);
    expect(pick("scoring")).toEqual([]);
    expect(pick("")).toEqual([]);
  });
});

function category(id: string, name: string, sort_order: number): Category {
  return { id, name, team_size: 2, match_minutes: 12, starts_at: null, phase: "group", sort_order, groups_count: 1, top_n_advance: 2, age_band: null, has_bronze_match: false };
}

function snapshot(): Snapshot {
  const categories = [
    category("young", "Men's Doubles 18–34", 0),
    category("old", "Men's Doubles 35+", 1),
    category("women", "Women's Doubles 18–34", 2),
  ];
  const teams: Team[] = [];
  const matches: Match[] = [];
  for (const c of categories) {
    const a = { id: `${c.id}-a`, name: `${c.id} A`, category_id: c.id, p1_id: "x", p2_id: null };
    const b = { id: `${c.id}-b`, name: `${c.id} B`, category_id: c.id, p1_id: "y", p2_id: null };
    teams.push(a, b);
    matches.push({
      id: `${c.id}-m`, category_id: c.id, stage: "group", group_idx: 0, round_idx: null, slot_idx: 0,
      team_a_id: a.id, team_b_id: b.id, score_a: 21, score_b: 10, winner_id: a.id, confirmed: true,
      is_bye: false, is_walkover: false, status: "done", started_at: null, confirmed_at: null,
      scheduled_at: null, court_number: 1, queue_position: null, extended_minutes: 0, court_allocated_at: null,
    });
  }
  return { tournament: { id: "t", name: "Shuttle Storm", num_courts: 2 }, players: [], teams, matches, categories, player_categories: [], generated_at: 0 };
}

describe("answers for a name that covers both age bands", () => {
  const snap = snapshot();

  it("gives standings for both and not women's", () => {
    const text = answerStandings(snap, "A", "men's doubles");
    expect(text).toContain("In Men's Doubles 18–34, young A is leading Group A.");
    expect(text).toContain("In Men's Doubles 35+, old A is leading Group A.");
    expect(text).not.toContain("Women");
  });

  it("gives standings for just the named band", () => {
    const text = answerStandings(snap, "A", "men's doubles 35 plus");
    expect(text).toMatch(/^old A is leading Group A\./);
  });

  it("describes both bands in the rules and not women's", () => {
    const text = buildRulesForTopic(snap, "men's doubles");
    expect(text).toMatch(/^Men's Doubles 18–34: .* Men's Doubles 35\+: /);
    expect(text).not.toContain("Women");
    expect(buildRulesForTopic(snap, "women's doubles")).toMatch(/^Women's Doubles 18–34: /);
  });
});
