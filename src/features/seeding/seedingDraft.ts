// Pure helpers for the Seeding screen's unsaved list (keyed by entry).
import type { SeedTier } from "../../lib/seeding";

export type Draft = Record<string, { seed: number | null; tier: SeedTier | null }>;

const maxSeed = (d: Draft) => Object.values(d).reduce((m, v) => Math.max(m, v.seed ?? 0), 0);

/** Gives `key` the next seed number (1 if none yet). */
export function addSeed(d: Draft, key: string): Draft {
  return { ...d, [key]: { tier: d[key]?.tier ?? null, seed: maxSeed(d) + 1 } };
}

/** Clears `key`'s seed and closes the gap (3, 4 → 2, 3). */
export function removeSeed(d: Draft, key: string): Draft {
  const gone = d[key]?.seed;
  if (gone == null) return d;
  const out: Draft = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === key) out[k] = { ...v, seed: null };
    else out[k] = v.seed != null && v.seed > gone ? { ...v, seed: v.seed - 1 } : v;
  }
  return out;
}

/** Swaps `key` with the seed one place above it (3 ↔ 2). */
export function moveSeedUp(d: Draft, key: string): Draft {
  const s = d[key]?.seed;
  if (s == null || s <= 1) return d;
  const out: Draft = { ...d };
  for (const [k, v] of Object.entries(d)) if (v.seed === s - 1) out[k] = { ...v, seed: s };
  out[key] = { ...d[key], seed: s - 1 };
  return out;
}

export function nextTier(t: SeedTier | null): SeedTier | null {
  return t === null ? "A" : t === "A" ? "B" : null;
}

/** Seeds by number, then tier A, tier B, then the rest by name. */
export function rankEntries<E extends { label: string }>(entries: E[], keyOf: (e: E) => string, d: Draft): E[] {
  const rank = (e: E) => {
    const v = d[keyOf(e)];
    if (v?.seed != null) return v.seed;
    return v?.tier === "A" ? 10_000 : v?.tier === "B" ? 20_000 : 30_000;
  };
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** "Men's Doubles 18–34" → "MD 18–34", "Super Doubles 50+" → "SD 50+". */
export function eventChip(name: string): string {
  const words = name.replace(/[’']s\b/g, "").split(/\s+/).filter(Boolean);
  const letters = words.filter(w => !/\d/.test(w)).map(w => w[0].toUpperCase()).join("");
  const rest = words.filter(w => /\d/.test(w)).join(" ");
  return [letters, rest].filter(Boolean).join(" ") || name;
}
