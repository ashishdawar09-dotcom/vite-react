// The TypeScript sources were rebuilt from the compiled Worker deployed on
// 23 July 2026. This test checks every answer function against that deployed
// logic (test/reference) across generated tournament states.
//
// Real snapshots can be added without committing them:
//   PARITY_SNAPSHOTS=/path/to/dir-of-live_snapshot-json npm test

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as ref from "./reference/deployed-2026-07-23.js";
import { computeStandings } from "../src/standings";
import { projectSchedule } from "../src/scheduling";
import { buildRulesForTopic } from "../src/rules";
import { teamName } from "../src/format";
import * as tools from "../src/tools";
import type { Category, Match, Player, Snapshot, Team } from "../src/types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = Date.parse("2026-11-21T18:30:00Z");
const FIRST = ["Asha", "Ben", "Chen", "Dev", "Ella", "Farah", "Gus", "Hana", "Ivan", "Jas", "Kiran", "Lena", "Mo", "Nina", "Omar", "Priya", "Raj", "Sara", "Tom", "Uma"];
const LAST = ["Singh", "Lee", "Patel", "Wong", "Brown", "Khan", "Garcia", "Sahni", "Dawar", "Smith"];
const CATS = ["Men's Doubles", "Mixed Doubles", "Women's Singles", "Boys' Singles", "Men's Super Double 45+"];

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function generate(seed: number): Snapshot {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const numCourts = 1 + Math.floor(r() * 5);
  const players: Player[] = [];
  const teams: Team[] = [];
  const categories: Category[] = [];
  const matches: Match[] = [];
  const nCats = 1 + Math.floor(r() * 3);
  for (let c = 0; c < nCats; c++) {
    const singles = r() < 0.35;
    const cat: Category = {
      id: `cat-${seed}-${c}`,
      name: CATS[(seed + c) % CATS.length],
      team_size: singles ? 1 : 2,
      match_minutes: pick([8, 10, 12, 15, 0]),
      starts_at: r() < 0.5 ? iso(NOW - 3_600_000 + Math.floor(r() * 7_200_000)) : null,
      phase: pick(["none", "group", "knockout"]),
      sort_order: Math.floor(r() * 5),
      groups_count: Math.floor(r() * 4),
      top_n_advance: Math.floor(r() * 3),
      age_band: r() < 0.3 ? pick(["U15", "45+", "Open"]) : null,
      has_bronze_match: r() < 0.4,
    };
    categories.push(cat);
    const nTeams = 3 + Math.floor(r() * 8);
    const catTeams: Team[] = [];
    for (let t = 0; t < nTeams; t++) {
      const p1: Player = { id: `p-${seed}-${c}-${t}-1`, name: `${pick(FIRST)} ${pick(LAST)}` };
      players.push(p1);
      let p2: Player | null = null;
      if (!singles) {
        p2 = { id: `p-${seed}-${c}-${t}-2`, name: `${pick(FIRST)} ${pick(LAST)}` };
        players.push(p2);
      }
      const team: Team = {
        id: `t-${seed}-${c}-${t}`,
        name: r() < 0.5 ? `Team ${pick(["Smashers", "Shuttlers", "Net Ninjas", "Drop Shot", "Aces"])} ${t}` : "",
        category_id: cat.id,
        p1_id: p1.id,
        p2_id: p2?.id ?? null,
      };
      // Some teams reference a player missing from the snapshot.
      if (r() < 0.05) team.p1_id = `missing-${t}`;
      catTeams.push(team);
      teams.push(team);
    }
    const groups = 1 + Math.floor(r() * 3);
    let slot = 0;
    for (let i = 0; i < catTeams.length; i++) {
      for (let j = i + 1; j < catTeams.length; j++) {
        if (r() < 0.35) continue;
        const knockout = r() < 0.15;
        const a = catTeams[i];
        const b = r() < 0.05 ? null : catTeams[j];
        const state = r();
        const scheduled = NOW - 5_400_000 + Math.floor(r() * 10_800_000);
        const isBye = !b || r() < 0.05;
        const m: Match = {
          id: `m-${seed}-${c}-${i}-${j}`,
          category_id: cat.id,
          stage: knockout ? "knockout" : "group",
          group_idx: knockout ? null : (i + j) % groups,
          round_idx: knockout ? Math.floor(r() * 3) : null,
          slot_idx: slot++,
          team_a_id: r() < 0.03 ? null : a.id,
          team_b_id: b?.id ?? null,
          score_a: null,
          score_b: null,
          winner_id: null,
          confirmed: false,
          is_bye: isBye,
          is_walkover: false,
          status: "pending",
          started_at: null,
          confirmed_at: null,
          scheduled_at: r() < 0.8 ? iso(scheduled) : null,
          court_number: null,
          queue_position: r() < 0.5 ? Math.floor(r() * 20) : null,
          extended_minutes: r() < 0.2 ? Math.floor(r() * 6) : r() < 0.5 ? null : 0,
          court_allocated_at: null,
        };
        if (state < 0.45) {
          const start = scheduled - Math.floor(r() * 600_000);
          m.status = "done";
          m.confirmed = true;
          m.started_at = r() < 0.9 ? iso(start) : null;
          m.confirmed_at = r() < 0.95 ? iso(start + (2 + Math.floor(r() * 25)) * 60_000) : null;
          m.score_a = Math.floor(r() * 22);
          m.score_b = Math.floor(r() * 22);
          m.is_walkover = r() < 0.1;
          m.winner_id = r() < 0.08 ? null : (m.score_a ?? 0) >= (m.score_b ?? 0) ? m.team_a_id : m.team_b_id;
          m.court_number = r() < 0.9 ? 1 + Math.floor(r() * (numCourts + 1)) : null;
        } else if (state < 0.6) {
          m.status = "live";
          m.started_at = r() < 0.9 ? iso(NOW - Math.floor(r() * 1_800_000)) : null;
          m.score_a = Math.floor(r() * 15);
          m.score_b = r() < 0.2 ? null : Math.floor(r() * 15);
          m.court_number = r() < 0.9 ? 1 + Math.floor(r() * numCourts) : null;
        } else if (state < 0.7) {
          m.court_allocated_at = iso(NOW - 120_000);
          m.court_number = r() < 0.9 ? 1 + Math.floor(r() * numCourts) : null;
        } else if (state < 0.73) {
          m.status = "pending";
          m.confirmed = true;
        }
        matches.push(m);
      }
    }
  }
  return {
    tournament: r() < 0.03 ? null : { id: `tour-${seed}`, name: `Tournament ${seed}`, num_courts: r() < 0.05 ? 0 : numCourts },
    players,
    teams,
    matches,
    categories,
    player_categories: [],
    generated_at: NOW,
  };
}

// Perturb a real snapshot so live/pending/warming code paths are exercised.
function perturb(base: Snapshot, seed: number): Snapshot {
  const r = rng(seed);
  const snap = structuredClone(base);
  const courts = Math.max(1, snap.tournament?.num_courts ?? 1);
  for (const m of snap.matches) {
    const x = r();
    if (x < 0.2) {
      Object.assign(m, { status: "live", confirmed: false, confirmed_at: null, winner_id: null, started_at: iso(NOW - Math.floor(r() * 1_500_000)), court_number: 1 + Math.floor(r() * courts) });
    } else if (x < 0.35) {
      Object.assign(m, { status: "pending", confirmed: false, confirmed_at: null, winner_id: null, started_at: null, court_allocated_at: iso(NOW - 60_000), court_number: 1 + Math.floor(r() * courts) });
    } else if (x < 0.6) {
      Object.assign(m, { status: "pending", confirmed: false, confirmed_at: null, winner_id: null, started_at: null, court_allocated_at: null, court_number: null, scheduled_at: iso(NOW + Math.floor(r() * 5_400_000)) });
    }
  }
  return snap;
}

function namesFor(snap: Snapshot): string[] {
  const names = new Set<string>(["", "nobody here", "team", "a"]);
  for (const p of snap.players) {
    names.add(p.name);
    names.add(p.name.split(" ")[0]);
    names.add(p.name.toUpperCase());
  }
  for (const t of snap.teams) if (t.name) names.add(t.name);
  return [...names];
}

function compareAll(snap: Snapshot, label: string) {
  const nows = [NOW, NOW - 7_200_000, NOW + 3_600_000];
  const numCourts = snap.tournament?.num_courts ?? 1;
  for (const now of nows) {
    expect(projectSchedule(snap.matches, snap.categories, numCourts, now), `${label} projectSchedule`).toEqual(
      ref.projectSchedule(snap.matches, snap.categories, numCourts, now),
    );
    for (const name of namesFor(snap)) {
      expect(tools.answerMatchForName(snap, name, now), `${label} match_for ${name}`).toBe(ref.answerMatchForName(snap, name, now));
      expect(tools.answerLookup(snap, name, now), `${label} lookup ${name}`).toBe(ref.answerLookup(snap, name, now));
    }
    for (const p of [null, "missing", ...snap.players.map((x) => x.id)]) {
      expect(tools.answerMyNextMatch(snap, p, now), `${label} my_next ${p}`).toBe(ref.answerMyNextMatch(snap, p, now));
    }
    for (const c of [undefined, 0, 1, 2, 3, 5, 99]) {
      expect(tools.answerCourts(snap, now, c), `${label} courts ${c}`).toBe(ref.answerCourts(snap, now, c));
    }
    expect(tools.answerUpcoming(snap, now), `${label} upcoming`).toBe(ref.answerUpcoming(snap, now));
  }
  for (const g of ["A", "b", "C", "D", " e ", "Z", "1", ""]) {
    for (const cat of [undefined, "doubles", "mixed", "nothing", ...snap.categories.map((c) => c.name)]) {
      expect(tools.answerStandings(snap, g, cat), `${label} standings ${g} ${cat}`).toBe(ref.answerStandings(snap, g, cat));
    }
  }
  for (const topic of [undefined, "", "doubles", "mixed", "scoring", ...snap.categories.map((c) => c.name)]) {
    expect(tools.answerRules(snap, topic), `${label} rules ${topic}`).toBe(ref.answerRules(snap, topic));
    expect(buildRulesForTopic(snap, topic)).toBe(ref.buildRulesForTopic(snap, topic));
  }
  for (const limit of [undefined, 1, 10]) {
    expect(tools.answerResults(snap, limit), `${label} results`).toBe(ref.answerResults(snap, limit));
  }
  expect(tools.answerTournamentInfo(snap), `${label} info`).toBe(ref.answerTournamentInfo(snap));
  for (const t of snap.teams) expect(teamName(snap, t.id)).toBe(ref.teamName(snap, t.id));
  expect(computeStandings(snap.teams, snap.matches)).toEqual(ref.computeStandings(snap.teams, snap.matches));
}

describe("rebuilt voice logic matches the deployed Worker", () => {
  it("on 300 generated tournaments", () => {
    for (let seed = 1; seed <= 300; seed++) compareAll(generate(seed), `seed ${seed}`);
  });

  const dir = process.env.PARITY_SNAPSHOTS;
  it.runIf(Boolean(dir))("on real snapshots and perturbed variants", () => {
    const files = readdirSync(dir!).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const snap = JSON.parse(readFileSync(join(dir!, f), "utf8")) as Snapshot;
      compareAll(snap, f);
      for (let seed = 1; seed <= 25; seed++) compareAll(perturb(snap, seed), `${f} perturbed ${seed}`);
    }
  });
});
