// Seeding + smart draw (Shuttle Storm, Nov 2026).
//
// The tournament director numbers the top entries of an event (1, 2, 3…) and
// may tag the rest tier A (strong) or B (good). Ratings are admin-only
// (table entry_seeds); nothing here is shown on public pages.
//
// Groups: entries are ordered seeds by number, then tier A, tier B, unrated
// (random within each tier) and snaked into the groups: 1 → A, 2 → B, …,
// last group, then back. The top G seeds always land in G different groups.
//
// Knockout: the qualifiers are ordered by seed/tier before the bracket is
// built, so seed 1 and seed 2 (if they win their groups) can only meet in the
// final. An unseeded group winner goes after the seeded ones.
import { seedBracket } from "./formatPlanner";

export type SeedTier = "A" | "B";

export interface SeedInfo {
  seed: number | null;
  tier: SeedTier | null;
}

/** 0 = numbered seed, 1 = tier A, 2 = tier B, 3 = unrated. */
export function seedClass(info: SeedInfo | null | undefined): 0 | 1 | 2 | 3 {
  if (info?.seed != null && info.seed > 0) return 0;
  if (info?.tier === "A") return 1;
  if (info?.tier === "B") return 2;
  return 3;
}

/** Seeded or tier A: the entries the draw tries to keep apart. */
export function isStrong(info: SeedInfo | null | undefined): boolean {
  return seedClass(info) <= 1;
}

/** Sort key: lower is stronger. */
function compareSeed(a: SeedInfo | null | undefined, b: SeedInfo | null | undefined): number {
  const ca = seedClass(a), cb = seedClass(b);
  if (ca !== cb) return ca - cb;
  if (ca === 0) return (a!.seed as number) - (b!.seed as number);
  return 0;
}

/** Small deterministic RNG (mulberry32) for previews and tests. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fisherYates<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Entries in draw order: numbered seeds by number, then tier A, tier B and
 * unrated. Shuffled first, then stably sorted, so ties (same tier, or the
 * same seed number twice) are in random order.
 */
export function drawOrder<T>(entries: T[], seedOf: (e: T) => SeedInfo | null | undefined, rng: () => number = Math.random): T[] {
  return fisherYates(entries, rng).sort((a, b) => compareSeed(seedOf(a), seedOf(b)));
}

/**
 * The group each draw position goes to: a snake over the groups (A, B, C,
 * then C, B, A, …), skipping groups that are already full, so the given
 * sizes are kept exactly. Returns one group index per position, up to the
 * total capacity.
 */
export function snakeSlots(groupSizes: number[], count: number): number[] {
  const filled = groupSizes.map(() => 0);
  const capacity = groupSizes.reduce((s, n) => s + Math.max(0, n), 0);
  const total = Math.min(count, capacity);
  const out: number[] = [];
  let forward = true;
  while (out.length < total) {
    const order = groupSizes.map((_, i) => i);
    if (!forward) order.reverse();
    for (const g of order) {
      if (out.length >= total) break;
      if (filled[g] < groupSizes[g]) { filled[g]++; out.push(g); }
    }
    forward = !forward;
  }
  return out;
}

/**
 * Seeded group draw. Replaces the old fully random shuffle: with no seeds or
 * tiers at all it is still a random draw (everyone is "unrated").
 * Group sizes are respected exactly; like the old deal, entries beyond the
 * total size are left out (the planner always sizes groups to the entry count).
 */
export function seedGroups<T>(
  entries: T[],
  groupSizes: number[],
  seedOf: (e: T) => SeedInfo | null | undefined,
  rng: () => number = Math.random,
): T[][] {
  const ordered = drawOrder(entries, seedOf, rng);
  const groups: T[][] = groupSizes.map(() => []);
  snakeSlots(groupSizes, ordered.length).forEach((g, i) => groups[g].push(ordered[i]));
  return groups;
}

/** Groups holding two or more strong (seeded or tier A) entries. */
export function strongClashes<T>(groups: T[][], seedOf: (e: T) => SeedInfo | null | undefined): number[] {
  const out: number[] = [];
  groups.forEach((g, i) => { if (g.filter(e => isStrong(seedOf(e))).length >= 2) out.push(i); });
  return out;
}

// --- knockout ---------------------------------------------------------------

/** Round-1 meetings between teams from the same group, for a slot-ordered bracket. */
function sameGroupMeetings<T>(slots: (T | null)[], groupOf: Map<T, number>): number {
  let n = 0;
  for (let i = 0; i + 1 < slots.length; i += 2) {
    const a = slots[i], b = slots[i + 1];
    if (a && b && groupOf.get(a) === groupOf.get(b)) n++;
  }
  return n;
}

/**
 * The qualifiers in bracket seed order (index 0 = top seed).
 *
 * `qualifiers[g]` is group g's qualifiers in finishing order (index 0 won the
 * group). Within each finishing rank the teams are ordered by seed/tier, with
 * unseeded teams last and group order as the tiebreak. So the best seeded
 * group winner is bracket seed 1, the next is bracket seed 2, and so on.
 *
 * seedKnockout turns this into bracket slots (and keeps same-group teams
 * apart in round 1).
 */
export function knockoutSeedOrder<T>(qualifiers: T[][], seedOf: (e: T) => SeedInfo | null | undefined): T[] {
  const G = qualifiers.length;
  const groupOf = new Map<T, number>();
  qualifiers.forEach((q, g) => q.forEach(t => groupOf.set(t, g)));

  // Groups ordered by their winner's seed (empty groups last, then group order).
  const groupOrder = Array.from({ length: G }, (_, g) => g).sort((x, y) => {
    const ax = qualifiers[x][0], ay = qualifiers[y][0];
    if (!ax || !ay) return (ax ? 0 : 1) - (ay ? 0 : 1) || x - y;
    return compareSeed(seedOf(ax), seedOf(ay)) || x - y;
  });
  const pos = new Map(groupOrder.map((g, i) => [g, i]));
  const maxRank = qualifiers.reduce((m, q) => Math.max(m, q.length), 0);

  const bySeed: T[] = [];
  for (let r = 0; r < maxRank; r++) {
    const rank = groupOrder.filter(g => r < qualifiers[g].length).map(g => qualifiers[g][r]);
    bySeed.push(...rank.sort((a, b) =>
      compareSeed(seedOf(a), seedOf(b)) || (pos.get(groupOf.get(a)!)! - pos.get(groupOf.get(b)!)!)));
  }
  return bySeed;
}

/** The same ranks, but lower ranks follow the winners' group order (the old seedBracket, groups relabelled). */
function groupOrderFallback<T>(qualifiers: T[][], winnersFirst: T[]): T[] {
  const G = qualifiers.length;
  const groupOf = new Map<T, number>();
  qualifiers.forEach((q, g) => q.forEach(t => groupOf.set(t, g)));
  const order = winnersFirst.filter(t => qualifiers[groupOf.get(t)!][0] === t).map(t => groupOf.get(t)!);
  for (let g = 0; g < G; g++) if (!order.includes(g)) order.push(g);
  const maxRank = qualifiers.reduce((m, q) => Math.max(m, q.length), 0);
  const out: T[] = [];
  for (let r = 0; r < maxRank; r++) for (const g of order) if (r < qualifiers[g].length) out.push(qualifiers[g][r]);
  return out;
}

/**
 * Seed-aware replacement for `seedBracket(qualifiers)`: same output shape
 * (slot-ordered, length a power of 2, null = bye), same bye rules, but
 * bracket seeds follow the entry seeds instead of group letters, and no
 * round-1 match is between two teams of the same group where a swap of the
 * lower-placed teams avoids it. With no seeds at all it returns what
 * seedBracket does, apart from that repair.
 */
export function seedKnockout<T>(qualifiers: T[][], seedOf: (e: T) => SeedInfo | null | undefined): (T | null)[] {
  const groupOf = new Map<T, number>();
  qualifiers.forEach((q, g) => q.forEach(t => groupOf.set(t, g)));
  const place = (order: T[]) => avoidSameGroupOpeners(seedBracket([order]), groupOf, new Map(order.map((t, i) => [t, i])));
  // Seed order first (a seed who finished second stays a high runner-up, so
  // seed 2 can't be drawn against seed 1 in round 1). Only if swaps can't
  // clear a same-group opener there, use the group-order fallback.
  const bySeed = knockoutSeedOrder(qualifiers, seedOf);
  const seeded = place(bySeed);
  const clashSeed = sameGroupMeetings(seeded, groupOf);
  if (clashSeed === 0) return seeded;
  const fallback = place(groupOrderFallback(qualifiers, bySeed));
  return sameGroupMeetings(fallback, groupOf) < clashSeed ? fallback : seeded;
}

/**
 * seedBracket can still pair two teams from the same group in round 1 when
 * the group count isn't a power of 2 (e.g. 3 or 7 groups, top 2: in 7 groups
 * the Group E winner met the Group E runner-up). Fix each such pair by
 * swapping its lower-placed team with the lower-placed team of another full
 * pair, when that leaves neither pair same-group. Top-placed teams (and byes)
 * never move.
 */
export function avoidSameGroupOpeners<T>(slots: (T | null)[], groupOf: Map<T, number>, place: Map<T, number>): (T | null)[] {
  const out = [...slots];
  const same = (a: T | null, b: T | null) => !!a && !!b && groupOf.get(a) === groupOf.get(b);
  const lowerIdx = (i: number) => (place.get(out[i]!)! > place.get(out[i + 1]!)! ? i : i + 1);
  for (let i = 0; i + 1 < out.length; i += 2) {
    if (!same(out[i], out[i + 1])) continue;
    const li = lowerIdx(i), ki = li === i ? i + 1 : i;
    // Try pairs from the bottom of the bracket up: the lowest seeds move.
    for (let j = out.length - 2; j >= 0; j -= 2) {
      if (j === i || !out[j] || !out[j + 1]) continue;
      const lj = lowerIdx(j), kj = lj === j ? j + 1 : j;
      if (same(out[ki], out[lj]) || same(out[kj], out[li])) continue;
      [out[li], out[lj]] = [out[lj], out[li]];
      break;
    }
  }
  return out;
}

/** Planner hint for the Seeding screen: "7 groups · seed at least 7". */
export function seedingSummary(groupsCount: number, seeded: number, tierA: number): {
  minSeeds: number;
  strong: number;
  /** Strong entries beyond one per group: that many groups get two. */
  overflow: number;
} {
  const strong = seeded + tierA;
  return { minSeeds: groupsCount, strong, overflow: groupsCount > 0 ? Math.max(0, strong - groupsCount) : 0 };
}
