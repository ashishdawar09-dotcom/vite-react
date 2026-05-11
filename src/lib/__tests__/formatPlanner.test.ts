import { describe, it, expect } from "vitest";
import {
  defaultFormat,
  recommendFormats,
  splitIntoGroups,
  knockoutShapeFor,
  describeFormat,
  bracketSlotOrder,
  seedBracket,
} from "../formatPlanner";

describe("splitIntoGroups", () => {
  it("distributes evenly when N divides cleanly", () => {
    expect(splitIntoGroups(10, 2)).toEqual([5, 5]);
    expect(splitIntoGroups(16, 4)).toEqual([4, 4, 4, 4]);
    expect(splitIntoGroups(24, 8)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
  });
  it("puts extras at the front when N has a remainder", () => {
    expect(splitIntoGroups(11, 2)).toEqual([6, 5]);
    expect(splitIntoGroups(13, 4)).toEqual([4, 3, 3, 3]);
    expect(splitIntoGroups(14, 4)).toEqual([4, 4, 3, 3]);
    expect(splitIntoGroups(15, 4)).toEqual([4, 4, 4, 3]);
    expect(splitIntoGroups(17, 4)).toEqual([5, 4, 4, 4]);
  });
  it("returns [] for invalid inputs", () => {
    expect(splitIntoGroups(0, 4)).toEqual([]);
    expect(splitIntoGroups(10, 0)).toEqual([]);
  });
});

describe("knockoutShapeFor", () => {
  it("maps power-of-2 qualifier counts to known shapes", () => {
    expect(knockoutShapeFor(2)).toBe("F");
    expect(knockoutShapeFor(4)).toBe("SF");
    expect(knockoutShapeFor(8)).toBe("QF");
    expect(knockoutShapeFor(16)).toBe("R16");
  });
  it("returns 'none' for invalid counts", () => {
    expect(knockoutShapeFor(0)).toBe("none");
    expect(knockoutShapeFor(1)).toBe("none");
    expect(knockoutShapeFor(3)).toBe("none");
    expect(knockoutShapeFor(6)).toBe("none");
  });
});

describe("defaultFormat — clean-knockout invariant", () => {
  // The core promise: for every supported N, the produced format yields a
  // qualifier count that is a power of 2 (or RR-only / no knockout).
  it("qualifiers always form a power of 2 for N=4..32", () => {
    for (let N = 4; N <= 32; N++) {
      const p = defaultFormat(N);
      if (p.knockoutShape === "RR-only" || p.knockoutShape === "none") continue;
      const qualifiers = p.groupsCount === 0
        ? (p.knockoutShape === "F" ? 2 : 0)
        : p.groupsCount * p.topNAdvance;
      const isPow2 = qualifiers > 0 && (qualifiers & (qualifiers - 1)) === 0;
      expect(isPow2, `N=${N}: qualifiers=${qualifiers} (groups=${p.groupsCount}×${p.topNAdvance}) not pow2`).toBe(true);
    }
  });

  it("groupSizes always sum to N", () => {
    for (let N = 3; N <= 32; N++) {
      const p = defaultFormat(N);
      if (p.groupsCount === 0) continue;
      const sum = p.groupSizes.reduce((a, b) => a + b, 0);
      expect(sum, `N=${N}: sizes=[${p.groupSizes}]`).toBe(N);
    }
  });

  it("min group size ≥ 3 for N ≥ 3", () => {
    for (let N = 3; N <= 32; N++) {
      const p = defaultFormat(N);
      if (p.groupsCount === 0) continue;
      const min = Math.min(...p.groupSizes);
      expect(min, `N=${N}: sizes=[${p.groupSizes}]`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("defaultFormat — contract table", () => {
  it("N=2 → final only", () => {
    const p = defaultFormat(2);
    expect(p.groupsCount).toBe(0);
    expect(p.knockoutShape).toBe("F");
  });
  it("N=3 → round-robin only", () => {
    const p = defaultFormat(3);
    expect(p.groupsCount).toBe(1);
    expect(p.groupSizes).toEqual([3]);
    expect(p.knockoutShape).toBe("RR-only");
  });
  it("N=5..7 → 1 group, top 4 to SF", () => {
    for (const N of [5, 6, 7]) {
      const p = defaultFormat(N);
      expect(p.groupsCount).toBe(1);
      expect(p.groupSizes).toEqual([N]);
      expect(p.topNAdvance).toBe(4);
      expect(p.knockoutShape).toBe("SF");
    }
  });
  it("N=9 → 2 groups (5+4), top 2 each → SF", () => {
    const p = defaultFormat(9);
    expect(p.groupsCount).toBe(2);
    expect(p.groupSizes).toEqual([5, 4]);
    expect(p.topNAdvance).toBe(2);
    expect(p.knockoutShape).toBe("SF");
  });
  it("N=11 → 2 groups (6+5), top 2 each → SF", () => {
    const p = defaultFormat(11);
    expect(p.groupSizes).toEqual([6, 5]);
    expect(p.knockoutShape).toBe("SF");
  });
  it("N=13 → 4 groups (4+3+3+3), top 2 → QF", () => {
    const p = defaultFormat(13);
    expect(p.groupsCount).toBe(4);
    expect(p.groupSizes).toEqual([4, 3, 3, 3]);
    expect(p.knockoutShape).toBe("QF");
  });
  it("N=14 → 4 groups (4+4+3+3), top 2 → QF", () => {
    expect(defaultFormat(14).groupSizes).toEqual([4, 4, 3, 3]);
  });
  it("N=15 → 4 groups (4+4+4+3), top 2 → QF", () => {
    expect(defaultFormat(15).groupSizes).toEqual([4, 4, 4, 3]);
  });
  it("N=17 → 4 groups (5+4+4+4), top 2 → QF", () => {
    expect(defaultFormat(17).groupSizes).toEqual([5, 4, 4, 4]);
  });
});

describe("defaultFormat — match counts", () => {
  it("computes total games for N=6 correctly", () => {
    // 1 group of 6, single RR = 15 group games. Top 4 → SF (2 SF + 1 F = 3 KO).
    const p = defaultFormat(6);
    expect(p.totalGroupGames).toBe(15);
    expect(p.totalKnockoutGames).toBe(3);
    expect(p.totalMatches).toBe(18);
  });
  it("computes total games for N=10 correctly", () => {
    // 2 groups of 5 → top 2 each = 4 → SF.
    // Group games: 2 × C(5,2) = 2×10 = 20. KO: 3.
    const p = defaultFormat(10);
    expect(p.totalGroupGames).toBe(20);
    expect(p.totalKnockoutGames).toBe(3);
    expect(p.totalMatches).toBe(23);
  });
  it("estimatedMinutes scales with match count and courts", () => {
    const p = defaultFormat(8); // 12 group + 3 KO = 15 matches
    expect(p.estimatedMinutes(12, 4)).toBe(Math.ceil(15 * 12 / 4));
    expect(p.estimatedMinutes(12, 1)).toBe(15 * 12);
  });
});

describe("recommendFormats", () => {
  it("returns multiple options for N=10", () => {
    const opts = recommendFormats(10);
    expect(opts.length).toBeGreaterThanOrEqual(2);
    expect(opts[0].label).toBe("Recommended");
    expect(opts.some(o => o.label === "More games")).toBe(true);
  });
  it("'More games' has 2× the group games of 'Recommended' (same shape)", () => {
    const opts = recommendFormats(10);
    const rec = opts.find(o => o.label === "Recommended")!;
    const more = opts.find(o => o.label === "More games")!;
    expect(more.totalGroupGames).toBe(rec.totalGroupGames * 2);
  });
  it("'Compact' for QF default reduces to top 1 each → SF", () => {
    const opts = recommendFormats(13);
    const compact = opts.find(o => o.label === "Compact");
    expect(compact?.knockoutShape).toBe("SF");
    expect(compact?.topNAdvance).toBe(1);
  });
  it("'Compact' for SF (2-group) default reduces to top 1 each → F", () => {
    const opts = recommendFormats(9);
    const compact = opts.find(o => o.label === "Compact");
    expect(compact?.knockoutShape).toBe("F");
    expect(compact?.topNAdvance).toBe(1);
  });
});

describe("bracketSlotOrder", () => {
  it("returns the seed-to-slot permutation", () => {
    expect(bracketSlotOrder(2)).toEqual([0, 1]);
    expect(bracketSlotOrder(4)).toEqual([0, 3, 1, 2]);
    expect(bracketSlotOrder(8)).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
    expect(bracketSlotOrder(16)).toEqual([0, 15, 7, 8, 3, 12, 4, 11, 1, 14, 6, 9, 2, 13, 5, 10]);
  });
  it("pairs preserve the 1-vs-N property at every level", () => {
    // For any power-of-2 bracket size, position 2i and 2i+1 sum to (size-1)
    // in the round-1 pairing — that's the "1v8, 4v5, 2v7, 3v6" property.
    for (const size of [4, 8, 16]) {
      const ord = bracketSlotOrder(size);
      for (let i = 0; i < size; i += 2) {
        expect(ord[i] + ord[i + 1], `size=${size} pair=${i}`).toBe(size - 1);
      }
    }
  });
});

describe("seedBracket", () => {
  // Helper: build qualifier sets with synthetic identifiers
  // so we can assert the placement order.
  const team = (group: number, rank: number) => ({ id: `G${group}.${rank}`, group, rank });

  it("4 groups × top-2 → 8 slots with no same-group pairs in round 1", () => {
    const qualifiers = [
      [team(0, 0), team(0, 1)],
      [team(1, 0), team(1, 1)],
      [team(2, 0), team(2, 1)],
      [team(3, 0), team(3, 1)],
    ];
    const slots = seedBracket(qualifiers);
    expect(slots.length).toBe(8);
    // Check every round-1 pair: different groups.
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i], b = slots[i + 1];
      if (a && b) {
        expect(a.group, `slot ${i}/${i + 1}: ${a.id} vs ${b.id} same group`).not.toBe(b.group);
      }
    }
    // Group winner G0.0 should be in slot 0 (top seed).
    expect(slots[0]?.id).toBe("G0.0");
  });

  it("2 groups × top-2 → 4 slots, group winners face other group's runners-up", () => {
    const qualifiers = [
      [team(0, 0), team(0, 1)],
      [team(1, 0), team(1, 1)],
    ];
    const slots = seedBracket(qualifiers);
    expect(slots.length).toBe(4);
    // Pairs: (G0.0, G1.1) and (G1.0, G0.1)
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i], b = slots[i + 1];
      if (a && b) expect(a.group).not.toBe(b.group);
    }
    // G0.0 in slot 0 (top seed), G1.0 in slot 2 (other half).
    expect(slots[0]?.id).toBe("G0.0");
    expect(slots[2]?.id).toBe("G1.0");
  });

  it("1 group × top-4 → 4 slots, intra-group is unavoidable but seeded correctly", () => {
    const qualifiers = [[team(0, 0), team(0, 1), team(0, 2), team(0, 3)]];
    const slots = seedBracket(qualifiers);
    expect(slots.length).toBe(4);
    // Same-group is unavoidable; the seeding should be 1v4 / 2v3.
    expect(slots[0]?.id).toBe("G0.0");
    expect(slots[1]?.id).toBe("G0.3");
    expect(slots[2]?.id).toBe("G0.1");
    expect(slots[3]?.id).toBe("G0.2");
  });

  it("2 groups × top-2 with 1 missing → bye goes to top seed", () => {
    const qualifiers = [
      [team(0, 0), team(0, 1)],
      [team(1, 0)], // group 1 only sent 1 qualifier
    ];
    const slots = seedBracket(qualifiers);
    expect(slots.length).toBe(4);
    // 3 qualifiers in 4 slots → 1 bye.
    // Top seed (G0.0) should have a bye partner (null) — gets advanced to SF.
    const nullCount = slots.filter(s => s === null).length;
    expect(nullCount).toBe(1);
    // The bye is paired with G0.0 (slot 0): slot 1 should be null.
    expect(slots[0]?.id).toBe("G0.0");
    expect(slots[1]).toBeNull();
  });

  it("3 groups (2+2+1) = 5 qualifiers → 3 byes go to group winners", () => {
    const qualifiers = [
      [team(0, 0), team(0, 1)],
      [team(1, 0), team(1, 1)],
      [team(2, 0)],
    ];
    const slots = seedBracket(qualifiers);
    expect(slots.length).toBe(8);
    // 5 real + 3 null
    expect(slots.filter(s => s === null).length).toBe(3);
    expect(slots.filter(s => s !== null).length).toBe(5);
    // Group winners (rank 0) should all have null opponents (byes to SF).
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i], b = slots[i + 1];
      if (a && b) {
        // If both are non-null, neither should be a group winner — runners-up
        // should be the ones who actually play in round 1.
        // (This holds because byes are placed on the LOW-seed positions
        // which pair with TOP-seed positions in the bracket order.)
        expect(a.rank).toBeGreaterThan(0);
        expect(b.rank).toBeGreaterThan(0);
      }
    }
  });

  it("returns empty array for empty input", () => {
    expect(seedBracket([])).toEqual([]);
    expect(seedBracket([[]])).toEqual([]);
  });
});

describe("describeFormat", () => {
  it("formats balanced groups", () => {
    expect(describeFormat(defaultFormat(8))).toMatch(/2 groups of 4.*top 2.*SF/);
  });
  it("formats lopsided groups with explicit sizes", () => {
    expect(describeFormat(defaultFormat(11))).toMatch(/2 groups \(6\+5\).*top 2.*SF/);
  });
  it("formats single group", () => {
    expect(describeFormat(defaultFormat(6))).toMatch(/1 group of 6.*top 4.*SF/);
  });
  it("formats round-robin only", () => {
    expect(describeFormat(defaultFormat(3))).toMatch(/Round-robin/);
  });
});
