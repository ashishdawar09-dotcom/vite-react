import { describe, it, expect } from "vitest";
import {
  drawOrder,
  isStrong,
  knockoutSeedOrder,
  seedClass,
  seedGroups,
  seededRng,
  seedingSummary,
  seedKnockout,
  snakeSlots,
  strongClashes,
  type SeedInfo,
} from "../seeding";
import { defaultFormat, recommendFormats, seedBracket, splitIntoGroups } from "../formatPlanner";

type E = { id: string; info: SeedInfo | null };
const seedOf = (e: E) => e.info;

function entries(n: number, seeds: number, tierA = 0, tierB = 0): E[] {
  return Array.from({ length: n }, (_, i) => {
    if (i < seeds) return { id: `s${i + 1}`, info: { seed: i + 1, tier: null } };
    if (i < seeds + tierA) return { id: `a${i}`, info: { seed: null, tier: "A" } };
    if (i < seeds + tierA + tierB) return { id: `b${i}`, info: { seed: null, tier: "B" } };
    return { id: `u${i}`, info: null };
  });
}

const groupOfId = (groups: E[][]) => {
  const m = new Map<string, number>();
  groups.forEach((g, gi) => g.forEach(e => m.set(e.id, gi)));
  return m;
};

describe("seedClass / isStrong", () => {
  it("ranks numbered seeds, then A, then B, then unrated", () => {
    expect(seedClass({ seed: 3, tier: null })).toBe(0);
    expect(seedClass({ seed: 3, tier: "B" })).toBe(0);
    expect(seedClass({ seed: null, tier: "A" })).toBe(1);
    expect(seedClass({ seed: null, tier: "B" })).toBe(2);
    expect(seedClass(null)).toBe(3);
    expect(seedClass({ seed: 0, tier: null })).toBe(3);
    expect(isStrong({ seed: null, tier: "A" })).toBe(true);
    expect(isStrong({ seed: null, tier: "B" })).toBe(false);
  });
});

describe("snakeSlots", () => {
  it("snakes A B C C B A for equal groups", () => {
    expect(snakeSlots([3, 3, 3], 9)).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2]);
  });
  it("respects uneven sizes 4+3+3", () => {
    const s = snakeSlots([4, 3, 3], 10);
    expect(s.slice(0, 3)).toEqual([0, 1, 2]);
    expect([0, 1, 2].map(g => s.filter(x => x === g).length)).toEqual([4, 3, 3]);
  });
  it("stops at the total capacity", () => {
    expect(snakeSlots([2, 2], 9)).toHaveLength(4);
  });
});

describe("drawOrder", () => {
  it("puts seeds by number, then A, then B, then unrated", () => {
    const es = entries(12, 3, 3, 3);
    for (let k = 0; k < 50; k++) {
      const order = drawOrder(es, seedOf, seededRng(k));
      expect(order.slice(0, 3).map(e => e.id)).toEqual(["s1", "s2", "s3"]);
      expect(order.slice(3, 6).every(e => e.info?.tier === "A")).toBe(true);
      expect(order.slice(6, 9).every(e => e.info?.tier === "B")).toBe(true);
      expect(order.slice(9).every(e => e.info === null)).toBe(true);
    }
  });
  it("is random within a tier", () => {
    const es = entries(10, 0, 0, 0);
    const firsts = new Set<string>();
    for (let k = 0; k < 100; k++) firsts.add(drawOrder(es, seedOf, seededRng(k))[0].id);
    expect(firsts.size).toBeGreaterThan(5);
  });
});

describe("seedGroups: hundreds of random draws", () => {
  // Every format the planner can offer for 3..40 entries.
  const formats: { n: number; sizes: number[] }[] = [];
  for (let n = 3; n <= 40; n++) {
    for (const f of recommendFormats(n)) if (f.groupsCount > 0) formats.push({ n, sizes: f.groupSizes });
    for (let g = 1; g <= Math.floor(n / 2); g++) formats.push({ n, sizes: splitIntoGroups(n, g) });
  }

  it("keeps the sizes, uses every entry once, and never puts two of the top-G seeds together", () => {
    let draws = 0;
    for (const { n, sizes } of formats) {
      const G = sizes.length;
      for (let k = 0; k < 4; k++) {
        const rng = seededRng(n * 1000 + G * 10 + k);
        const seeds = Math.min(n, G + (k % 3));
        const es = entries(n, seeds, k, k);
        const groups = seedGroups(es, sizes, seedOf, rng);
        draws++;
        expect(groups.map(g => g.length)).toEqual(sizes);
        const ids = groups.flat().map(e => e.id);
        expect(new Set(ids).size).toBe(n);
        // Top-G seeds: one per group, seed i in group i-1.
        for (let s = 1; s <= Math.min(G, seeds); s++) {
          expect(groups[s - 1].some(e => e.id === `s${s}`)).toBe(true);
        }
        const topG = groups.map(g => g.filter(e => e.info?.seed != null && e.info.seed <= G).length);
        expect(Math.max(...topG)).toBeLessThanOrEqual(1);
      }
    }
    expect(draws).toBeGreaterThan(300);
  });

  it("keeps strong entries apart while there are enough groups", () => {
    for (let k = 0; k < 300; k++) {
      const rng = seededRng(k);
      const G = 2 + (k % 6);
      const n = G * (3 + (k % 2));
      const seeds = k % (G + 1);
      const tierA = G - seeds; // exactly one strong entry per group
      const groups = seedGroups(entries(n, seeds, tierA, k % 4), splitIntoGroups(n, G), seedOf, rng);
      expect(strongClashes(groups, seedOf)).toEqual([]);
    }
  });

  it("balances the snake: seed sums per group differ by at most G", () => {
    for (let G = 2; G <= 8; G++) {
      const n = G * 4;
      const groups = seedGroups(entries(n, n), splitIntoGroups(n, G), seedOf, seededRng(G));
      const sums = groups.map(g => g.reduce((s, e) => s + (e.info!.seed as number), 0));
      // 4 per group in a snake: every group's sum is exactly the same.
      expect(new Set(sums).size).toBe(1);
      // Second pass runs backwards: the last group gets seed G+1.
      expect(groups[G - 1].map(e => e.info!.seed)).toContain(G + 1);
    }
  });

  it("with no seeds is a random draw of the same shape", () => {
    const es = entries(21, 0);
    const sizes = defaultFormat(21).groupSizes;
    const a = seedGroups(es, sizes, seedOf, seededRng(1));
    const b = seedGroups(es, sizes, seedOf, seededRng(2));
    expect(a.map(g => g.length)).toEqual(sizes);
    expect(a.flat().map(e => e.id)).not.toEqual(b.flat().map(e => e.id));
  });

  it("MD 18–34 example: Saqib/Gurmeet, Jay/Ratnesh and Sai Teja/Pratham land in A, B, C", () => {
    const named: E[] = [
      { id: "Saqib + Gurmeet", info: { seed: 1, tier: null } },
      { id: "Jay + Ratnesh", info: { seed: 2, tier: null } },
      { id: "Sai Teja + Pratham", info: { seed: 3, tier: null } },
      ...entries(18, 0).map(e => ({ ...e, id: `team ${e.id}` })),
    ];
    for (let k = 0; k < 200; k++) {
      const plan = defaultFormat(named.length);
      const groups = seedGroups(named, plan.groupSizes, seedOf, seededRng(k));
      expect(groups[0].map(e => e.id)).toContain("Saqib + Gurmeet");
      expect(groups[1].map(e => e.id)).toContain("Jay + Ratnesh");
      expect(groups[2].map(e => e.id)).toContain("Sai Teja + Pratham");
    }
  });
});

describe("knockout ordering", () => {
  const half = (slots: (E | null)[], id: string) => {
    const i = slots.findIndex(t => t?.id === id);
    return i < slots.length / 2 ? 0 : 1;
  };
  const quarter = (slots: (E | null)[], id: string) => Math.floor(slots.findIndex(t => t?.id === id) / (slots.length / 4));
  const rematches = (slots: (E | null)[], gOf: Map<string, number>) => {
    let n = 0;
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i], b = slots[i + 1];
      if (a && b && gOf.get(a.id) === gOf.get(b.id)) n++;
    }
    return n;
  };

  it("with no seeds gives the old seedBracket, unless that had a same-group opener", () => {
    let same = 0;
    for (let G = 1; G <= 8; G++) for (let top = 1; top <= 3; top++) {
      const q: E[][] = Array.from({ length: G }, (_, g) => Array.from({ length: top }, (_, r) => ({ id: `g${g}r${r}`, info: null })));
      const gOf = new Map(q.flatMap((g, gi) => g.map(e => [e.id, gi] as [string, number])));
      const old = seedBracket(q);
      const now = seedKnockout(q, seedOf);
      if (rematches(old, gOf) === 0) { expect(now).toEqual(old); same++; }
      else if (G > 1) expect(rematches(now, gOf)).toBe(0);
      // Byes never move, and the top G places (the group winners) stay put.
      expect(now.map(t => t === null)).toEqual(old.map(t => t === null));
      for (let g = 0; g < G; g++) expect(now.indexOf(q[g][0])).toBe(old.indexOf(q[g][0]));
    }
    expect(same).toBeGreaterThan(10);
  });

  it("fixes the old 7-group and 3-group same-group openers", () => {
    for (const G of [3, 5, 6, 7]) {
      const q: E[][] = Array.from({ length: G }, (_, g) => [{ id: `${g}a`, info: null }, { id: `${g}b`, info: null }]);
      const gOf = new Map(q.flatMap((g, gi) => g.map(e => [e.id, gi] as [string, number])));
      expect(rematches(seedKnockout(q, seedOf), gOf)).toBe(0);
    }
  });

  it("seeds 1 and 2 can only meet in the final; 1–4 sit in different quarters", () => {
    let runs = 0;
    for (let k = 0; k < 400; k++) {
      const rng = seededRng(k + 7);
      const G = 2 + (k % 7);            // 2..8 groups
      const top = 1 + (k % 2) + (G <= 3 ? 1 : 0); // 1..3 advance
      const n = G * 4;
      const es = entries(n, G, k % 3, k % 3);
      const groups = seedGroups(es, splitIntoGroups(n, G), seedOf, rng);
      // Seeds win their groups (no upsets); the rest finish in random order.
      const qualifiers = groups.map(g => {
        const seeded = g.filter(e => e.info?.seed != null);
        const rest = drawOrder(g.filter(e => e.info?.seed == null), () => null, rng);
        return [...seeded, ...rest].slice(0, top);
      });
      const slots = seedKnockout(qualifiers, seedOf);
      const total = qualifiers.flat().length;
      expect(slots.filter(Boolean)).toHaveLength(total);
      expect(slots.length).toBe(Math.max(2, 2 ** Math.ceil(Math.log2(total))));
      expect(half(slots, "s1")).not.toBe(half(slots, "s2"));
      if (slots.length >= 8 && G >= 4) {
        expect(new Set(["s1", "s2", "s3", "s4"].map(id => quarter(slots, id))).size).toBe(4);
      }
      // Never more same-group round-1 meetings than the old draw-by-letter bracket.
      const gOf = groupOfId(groups);
      expect(rematches(slots, gOf)).toBeLessThanOrEqual(rematches(seedBracket(qualifiers), gOf));
      runs++;
    }
    expect(runs).toBe(400);
  });

  it("gives byes to the top seeds", () => {
    // 3 groups, top 2 → 6 qualifiers in an 8-bracket: seeds 1 and 2 get byes.
    const q: E[][] = [
      [{ id: "s3", info: { seed: 3, tier: null } }, { id: "x0", info: null }],
      [{ id: "s1", info: { seed: 1, tier: null } }, { id: "x1", info: null }],
      [{ id: "s2", info: { seed: 2, tier: null } }, { id: "x2", info: null }],
    ];
    const slots = seedKnockout(q, seedOf);
    for (const id of ["s1", "s2"]) {
      const i = slots.findIndex(t => t?.id === id);
      expect(slots[i % 2 === 0 ? i + 1 : i - 1]).toBeNull();
    }
    expect(knockoutSeedOrder(q, seedOf).slice(0, 3).map(t => t.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("orders an unseeded group winner after the seeded winners, and tier A before B", () => {
    const q: E[][] = [
      [{ id: "upset", info: null }],
      [{ id: "tierB", info: { seed: null, tier: "B" } }],
      [{ id: "s2", info: { seed: 2, tier: null } }],
      [{ id: "tierA", info: { seed: null, tier: "A" } }],
    ];
    expect(knockoutSeedOrder(q, seedOf).map(t => t.id)).toEqual(["s2", "tierA", "tierB", "upset"]);
  });

  it("never pairs a group with itself in round 1 for equal groups", () => {
    for (let k = 0; k < 300; k++) {
      const rng = seededRng(k * 13);
      const G = 2 + (k % 7), top = 2;
      const es = entries(G * 4, k % (G + 1), k % 4, 0);
      const groups = seedGroups(es, splitIntoGroups(G * 4, G), seedOf, rng);
      const qualifiers = groups.map(g => drawOrder(g, seedOf, rng).slice(0, top));
      expect(rematches(seedKnockout(qualifiers, seedOf), groupOfId(groups))).toBe(0);
    }
  });
});

describe("seedingSummary", () => {
  it("says how many seeds are needed and how many groups get two strong entries", () => {
    expect(seedingSummary(7, 3, 0)).toEqual({ minSeeds: 7, strong: 3, overflow: 0 });
    expect(seedingSummary(7, 5, 4)).toEqual({ minSeeds: 7, strong: 9, overflow: 2 });
    expect(seedingSummary(0, 2, 0).overflow).toBe(0);
  });
});
