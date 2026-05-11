// Tournament format recommender.
//
// Given N teams in a category, computes 2–3 viable tournament formats so that
// the bracket falls out cleanly (qualifier count is a power of 2 → no byes).
//
// Pure module. Zero dependencies. Tested via src/lib/__tests__/formatPlanner.test.ts.
//
// Design decisions (locked):
// - Small N (5–7 teams): single group → SF directly. No QF.
// - Minimum group size: 3. Smaller groups become asymmetric extras of bigger ones.
// - Group structure is the primary lever for clean knockouts. Byes only as a fallback.

export type KnockoutShape = "F" | "SF" | "QF" | "R16" | "RR-only" | "none";

export type FormatLabel = "Recommended" | "More games" | "Compact";

export type FormatPlan = {
  label: FormatLabel;
  groupsCount: number;          // 0 = no group stage (direct knockout / final-only)
  groupSizes: number[];         // length === groupsCount; sums to N (when N ≥ 3)
  roundsPerPair: 1 | 2;         // single or double round-robin
  topNAdvance: number;          // qualifiers per group; 0 for RR-only / no-knockout
  knockoutShape: KnockoutShape;
  totalGroupGames: number;
  totalKnockoutGames: number;
  totalMatches: number;
  estimatedMinutes: (matchMin: number, courts: number) => number;
};

// --- helpers ---------------------------------------------------------------

/**
 * Distribute N teams across G groups as evenly as possible.
 * Larger groups come first (extras allocated to the front).
 *
 * splitIntoGroups(11, 2) → [6, 5]
 * splitIntoGroups(15, 4) → [4, 4, 4, 3]
 */
export function splitIntoGroups(N: number, G: number): number[] {
  if (G <= 0 || N <= 0) return [];
  const base = Math.floor(N / G);
  const extra = N - base * G;
  return Array.from({ length: G }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Map qualifier count to knockout shape. Returns "none" for non-powers-of-2
 * (caller should fall back to byes in that case).
 */
export function knockoutShapeFor(qualifiers: number): KnockoutShape {
  if (qualifiers <= 1) return "none";
  if (qualifiers === 2) return "F";
  if (qualifiers === 4) return "SF";
  if (qualifiers === 8) return "QF";
  if (qualifiers === 16) return "R16";
  return "none";
}

/** Single-elimination: N teams → N−1 matches. */
function knockoutMatchCount(qualifiers: number): number {
  return qualifiers <= 1 ? 0 : qualifiers - 1;
}

/** Round-robin in a group of N played `r` times: N(N-1)/2 × r. */
function groupGameCount(size: number, roundsPerPair: number): number {
  if (size < 2) return 0;
  return (size * (size - 1) / 2) * roundsPerPair;
}

function buildPlan(args: {
  label: FormatLabel;
  groupsCount: number;
  groupSizes: number[];
  topNAdvance: number;
  knockoutShape: KnockoutShape;
  roundsPerPair: 1 | 2;
}): FormatPlan {
  const totalGroupGames = args.groupSizes.reduce(
    (sum, sz) => sum + groupGameCount(sz, args.roundsPerPair), 0,
  );
  // Qualifiers for the knockout stage.
  let qualifiers: number;
  if (args.knockoutShape === "RR-only" || args.knockoutShape === "none") {
    qualifiers = 0;
  } else if (args.groupsCount === 0) {
    // No group stage; direct knockout — bracket size is implied by the shape.
    qualifiers = shapeQualifiers(args.knockoutShape);
  } else {
    qualifiers = args.groupsCount * args.topNAdvance;
  }
  const totalKnockoutGames = knockoutMatchCount(qualifiers);
  const totalMatches = totalGroupGames + totalKnockoutGames;
  return {
    ...args,
    totalGroupGames,
    totalKnockoutGames,
    totalMatches,
    estimatedMinutes: (matchMin: number, courts: number) =>
      Math.ceil((totalMatches * matchMin) / Math.max(1, courts)),
  };
}

function shapeQualifiers(shape: KnockoutShape): number {
  switch (shape) {
    case "F": return 2;
    case "SF": return 4;
    case "QF": return 8;
    case "R16": return 16;
    default: return 0;
  }
}

// --- defaults --------------------------------------------------------------

/**
 * Recommended format for N teams. See the contract table in the project plan.
 *
 * Rules:
 *   N ≤ 1: no tournament.
 *   N = 2: F only (one match).
 *   N = 3: round-robin only (no knockout); winner = highest points.
 *   N = 4..7: 1 group → top 4 to SF.
 *   N = 8..11: 2 groups → top 2 each → SF.
 *   N = 12..23: 4 groups (sizes balanced, min 3) → top 2 each → QF.
 *   N = 24..32: 8 groups (min size 3) → top 2 each → R16, OR 4 groups → QF if
 *               groups would otherwise become too large.
 *   N ≥ 33: 8 groups → R16 (groups grow proportionally).
 */
export function defaultFormat(N: number): FormatPlan {
  if (N <= 1) {
    return buildPlan({
      label: "Recommended", groupsCount: 0, groupSizes: [], topNAdvance: 0,
      knockoutShape: "none", roundsPerPair: 1,
    });
  }
  if (N === 2) {
    return buildPlan({
      label: "Recommended", groupsCount: 0, groupSizes: [], topNAdvance: 0,
      knockoutShape: "F", roundsPerPair: 1,
    });
  }
  if (N === 3) {
    return buildPlan({
      label: "Recommended", groupsCount: 1, groupSizes: [3], topNAdvance: 0,
      knockoutShape: "RR-only", roundsPerPair: 1,
    });
  }
  if (N >= 4 && N <= 7) {
    // Single group → SF (top 4).
    return buildPlan({
      label: "Recommended", groupsCount: 1, groupSizes: [N], topNAdvance: 4,
      knockoutShape: "SF", roundsPerPair: 1,
    });
  }
  if (N >= 8 && N <= 11) {
    // 2 groups → top 2 each → SF.
    return buildPlan({
      label: "Recommended", groupsCount: 2, groupSizes: splitIntoGroups(N, 2),
      topNAdvance: 2, knockoutShape: "SF", roundsPerPair: 1,
    });
  }
  // 12+: prefer 4 groups → QF as long as max group size ≤ 6 and min size ≥ 3.
  const sizes4 = splitIntoGroups(N, 4);
  if (Math.max(...sizes4) <= 6 && Math.min(...sizes4) >= 3) {
    return buildPlan({
      label: "Recommended", groupsCount: 4, groupSizes: sizes4,
      topNAdvance: 2, knockoutShape: "QF", roundsPerPair: 1,
    });
  }
  // 24+: switch to 8 groups → R16 to keep group sizes manageable.
  const sizes8 = splitIntoGroups(N, 8);
  if (Math.min(...sizes8) >= 3) {
    return buildPlan({
      label: "Recommended", groupsCount: 8, groupSizes: sizes8,
      topNAdvance: 2, knockoutShape: "R16", roundsPerPair: 1,
    });
  }
  // Fallback: 4 groups even if some are big.
  return buildPlan({
    label: "Recommended", groupsCount: 4, groupSizes: sizes4,
    topNAdvance: 2, knockoutShape: "QF", roundsPerPair: 1,
  });
}

/**
 * Returns 1–3 viable formats: the recommended default, a "More games" variant
 * (double round-robin) where it makes sense, and a "Compact" variant
 * (smaller knockout) where it makes sense.
 */
export function recommendFormats(N: number): FormatPlan[] {
  const def = defaultFormat(N);
  const out: FormatPlan[] = [def];

  // "More games" — double round-robin. Skip when no group stage or N=2.
  if (def.groupsCount > 0 && def.knockoutShape !== "none") {
    out.push(buildPlan({
      label: "More games",
      groupsCount: def.groupsCount,
      groupSizes: def.groupSizes,
      topNAdvance: def.topNAdvance,
      knockoutShape: def.knockoutShape,
      roundsPerPair: 2,
    }));
  }

  // "Compact" — smaller knockout (top fewer per group → smaller bracket).
  if (def.knockoutShape === "QF" && def.topNAdvance === 2 && def.groupsCount === 4) {
    // 4 groups of N → top 1 each = 4 → SF (instead of top 2 → QF).
    out.push(buildPlan({
      label: "Compact",
      groupsCount: 4,
      groupSizes: def.groupSizes,
      topNAdvance: 1,
      knockoutShape: "SF",
      roundsPerPair: 1,
    }));
  } else if (def.knockoutShape === "SF" && def.topNAdvance === 2 && def.groupsCount === 2) {
    // 2 groups → top 1 each = 2 → F (instead of top 2 → SF).
    out.push(buildPlan({
      label: "Compact",
      groupsCount: 2,
      groupSizes: def.groupSizes,
      topNAdvance: 1,
      knockoutShape: "F",
      roundsPerPair: 1,
    }));
  } else if (def.knockoutShape === "SF" && def.groupsCount === 1 && def.topNAdvance === 4) {
    // 1 group → top 2 to F (instead of top 4 to SF).
    out.push(buildPlan({
      label: "Compact",
      groupsCount: 1,
      groupSizes: def.groupSizes,
      topNAdvance: 2,
      knockoutShape: "F",
      roundsPerPair: 1,
    }));
  } else if (def.knockoutShape === "R16" && def.topNAdvance === 2) {
    // 8 groups → top 1 each = 8 → QF.
    out.push(buildPlan({
      label: "Compact",
      groupsCount: def.groupsCount,
      groupSizes: def.groupSizes,
      topNAdvance: 1,
      knockoutShape: "QF",
      roundsPerPair: 1,
    }));
  }

  return out;
}

// --- knockout bracket seeding ---------------------------------------------

/**
 * Returns the seed-to-slot permutation for a power-of-2 bracket.
 *
 * For a bracket of size P, position i pairs with position i+1 (i even).
 * The returned array maps slot-index → seed-index, such that the standard
 * tournament pairing (1v8, 4v5, 2v7, 3v6 for 8-team) falls out naturally.
 *
 *   bracketSlotOrder(2) → [0, 1]
 *   bracketSlotOrder(4) → [0, 3, 1, 2]            (1v4, 2v3)
 *   bracketSlotOrder(8) → [0, 7, 3, 4, 1, 6, 2, 5] (1v8, 4v5, 2v7, 3v6)
 */
export function bracketSlotOrder(size: number): number[] {
  if (size <= 1) return [0];
  if (size === 2) return [0, 1];
  const half = bracketSlotOrder(size / 2);
  const out: number[] = [];
  for (const i of half) out.push(i, size - 1 - i);
  return out;
}

/**
 * Standard cross-group bracket seeding.
 *
 * Takes the top-N teams from each group (sorted by standings; index 0 is the
 * group winner) and arranges them into bracket slots such that:
 *
 *   - Same-group teams DO NOT meet in round 1 (no rematches).
 *   - Top seeds (group winners) are spread across the bracket halves so #1
 *     and #2 only meet in the final.
 *   - For non-power-of-2 qualifier counts, byes fall on top seeds' slots —
 *     the top seeds advance directly to round 2.
 *
 * Algorithm:
 *   1. Flatten in rank-first order: all rank-0 teams across groups, then all
 *      rank-1, etc. (group order within a rank is the tiebreaker.)
 *   2. Apply the bracket-position permutation. The natural pairing then
 *      cross-groups: slot 0 (top of group 0) pairs with slot size-1 (lowest
 *      seed from a different group).
 *
 * Returns an array of length `nextPowerOf2(totalQualifiers)`. Null entries
 * indicate a bye — caller emits an `is_bye: true` match for those.
 *
 * Generic over the team shape so the helper is also testable with plain
 * objects (e.g. `{ id: string; group: number; rank: number }`).
 */
export function seedBracket<T>(qualifiers: T[][]): (T | null)[] {
  // Flatten in rank-first order: rank 0 from each group, then rank 1, etc.
  const flat: T[] = [];
  const maxRank = qualifiers.reduce((m, g) => Math.max(m, g.length), 0);
  for (let rank = 0; rank < maxRank; rank++) {
    for (const group of qualifiers) {
      if (rank < group.length) flat.push(group[rank]);
    }
  }
  if (flat.length === 0) return [];

  // Bracket size = next power of 2 (minimum 2 — even a 1-team scenario gets
  // a slot, though that's an edge case the caller usually avoids).
  const bracketSize = Math.max(2, Math.pow(2, Math.ceil(Math.log2(flat.length))));
  const slotOrder = bracketSlotOrder(bracketSize);

  // Map slot → seed → team (or null for byes).
  const result: (T | null)[] = new Array(bracketSize).fill(null);
  for (let slot = 0; slot < bracketSize; slot++) {
    const seedIdx = slotOrder[slot];
    result[slot] = seedIdx < flat.length ? flat[seedIdx] : null;
  }
  return result;
}

/** Human-friendly description of the format, suitable for UI labels. */
export function describeFormat(plan: FormatPlan): string {
  if (plan.knockoutShape === "none" && plan.groupsCount === 0) return "No tournament";
  if (plan.knockoutShape === "F" && plan.groupsCount === 0) return "Final only";
  if (plan.knockoutShape === "RR-only") return `Round-robin (${plan.groupSizes[0]} teams)`;
  const sizesStr = plan.groupSizes.length === 1
    ? `1 group of ${plan.groupSizes[0]}`
    : plan.groupSizes.every(s => s === plan.groupSizes[0])
      ? `${plan.groupsCount} groups of ${plan.groupSizes[0]}`
      : `${plan.groupsCount} groups (${plan.groupSizes.join("+")})`;
  const advStr = plan.topNAdvance === 0 ? "" :
    plan.groupsCount === 1 ? `, top ${plan.topNAdvance} → ${plan.knockoutShape}` :
    `, top ${plan.topNAdvance} each → ${plan.knockoutShape}`;
  const rrStr = plan.roundsPerPair === 2 ? " · 2× RR" : "";
  return sizesStr + rrStr + advStr;
}
