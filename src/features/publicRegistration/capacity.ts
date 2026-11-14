// Entry capacity for the public form. A tournament can stop taking entries at
// a fixed number (tournaments.entry_cap): one entry is one player in one
// event, so a doubles pair takes two and someone in three events takes three.
// The database counts and enforces it (entry_count, registration_capacity and
// the insert trigger on pending_registrations); these helpers only shape what
// the form shows.

import type { Category } from "../../types";

export type Capacity = {
  cap: number;
  // Entries taken, including the open seat beside a doubles player still
  // waiting for a partner, and entries not approved yet.
  taken: number;
  remaining: number;
  full: boolean;
  // False once a director has closed the waitlist (tournaments.waitlist_closed):
  // the full page then says sorry, fully booked, and offers no waitlist.
  waitlistOpen: boolean;
};

// The RPC's answer, or null when the tournament has no cap (or the answer is
// malformed): then the form shows no counter and nothing is blocked here.
export function parseCapacity(v: unknown): Capacity | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const cap = typeof o.cap === "number" && Number.isFinite(o.cap) && o.cap > 0 ? Math.floor(o.cap) : null;
  const taken = typeof o.taken === "number" && Number.isFinite(o.taken) && o.taken >= 0 ? Math.floor(o.taken) : null;
  if (cap === null || taken === null) return null;
  const remaining = Math.max(0, cap - taken);
  // Only an explicit false closes it: an answer from before the switch
  // existed has no such key and means open.
  return { cap, taken, remaining, full: remaining === 0, waitlistOpen: o.waitlist_open !== false };
}

// Spots a selection uses, counted the way the server counts: a doubles event
// takes two (you, and the partner you name or the one we find you), singles
// one. Paying your share of an entry that already named you takes none: your
// spot was counted when your partner entered.
export function spotsNeeded(categories: Category[], ids: string[], payingShareFor: string | null = null): number {
  let n = 0;
  for (const id of ids) {
    const c = categories.find((x) => x.id === id);
    if (!c || id === payingShareFor) continue;
    n += c.team_size === 2 ? 2 : 1;
  }
  return n;
}

export function spotsWord(n: number): string {
  return n === 1 ? "spot" : "spots";
}

// The line under the big number: more urgent as the count runs down.
export function urgencyLine(c: Capacity): string {
  const r = c.remaining;
  if (r <= 0) return `All ${c.cap} spots are taken.`;
  if (r === 1) return "Last spot. When it's gone, entries close.";
  if (r <= 3) return `Only ${r} spots left. When they're gone, entries close.`;
  if (r <= 10) return `Final ${r} spots. When they're gone, entries close.`;
  if (r <= 25) return `Almost full. When these ${r} go, entries close.`;
  return `Entries close for good at ${c.cap}.`;
}

// When a selection doesn't fit in what's left, the message for the events step.
export function overCapacityMessage(remaining: number, needed: number): string | null {
  if (needed <= remaining) return null;
  const left = `Only ${remaining} ${spotsWord(remaining)} ${remaining === 1 ? "is" : "are"} left`;
  return `${left} and your events need ${needed}. A doubles event takes 2 (you and your partner), singles 1. Remove an event to continue.`;
}
