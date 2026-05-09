import { describe, it, expect } from "vitest";
import {
  defaultFormat,
  recommendFormats,
  splitIntoGroups,
  knockoutShapeFor,
  describeFormat,
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
