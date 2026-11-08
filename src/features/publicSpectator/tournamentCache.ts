// The last tournament row seen for each public slug, kept on this device.
//
// A spectator page used to look the slug up (a round trip to the database in
// Virginia) before it could ask for any scores. Someone opening /t/<slug>
// again now starts on the row from last time, so the scores start loading at
// once, while the slug is still looked up in the background and the row
// replaced (or the page switched to "not found") when the answer comes back.
// The row holds only what every visitor can read anyway. Rows older than two
// weeks are ignored, so a slug reused for a later event never starts on the
// old one.

import type { Tournament } from "../../types";

const PREFIX = "ss-spectator-tournament:";
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type Saved = { v: 1; saved_at: number; row: Tournament };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function deviceStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // blocked (e.g. some private modes)
  }
}

export function readCachedTournament(slug: string, store: StorageLike | null = deviceStorage(), now = Date.now()): Tournament | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + slug);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Saved> | null;
    if (!saved || typeof saved !== "object" || saved.v !== 1 || typeof saved.saved_at !== "number") return null;
    if (now - saved.saved_at > MAX_AGE_MS) return null;
    const t = saved.row as Partial<Tournament> | undefined;
    // Only a row for this very slug, with an id and a name, is any use.
    if (!t || typeof t !== "object" || typeof t.id !== "string" || typeof t.name !== "string" || t.slug !== slug) {
      return null;
    }
    return t as Tournament;
  } catch {
    return null;
  }
}

export function writeCachedTournament(slug: string, t: Tournament, store: StorageLike | null = deviceStorage(), now = Date.now()): void {
  try {
    const saved: Saved = { v: 1, saved_at: now, row: t };
    store?.setItem(PREFIX + slug, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the page just won't get the head start next time.
  }
}

export function clearCachedTournament(slug: string, store: StorageLike | null = deviceStorage()): void {
  try {
    store?.removeItem(PREFIX + slug);
  } catch {
    // Blocked: nothing was stored either.
  }
}
