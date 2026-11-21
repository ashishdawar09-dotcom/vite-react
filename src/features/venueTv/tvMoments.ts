// The venue TV's "moments": short cut-ins that take the middle of the screen
// whatever design is showing, then hand it back. The announcement line stays
// at the top and the live scores stay along the bottom.
//
//   call   the desk has just called a match to a court: the two sides, with
//          their player cards, and the court number.
//   champ  an event has its champions: when the final is confirmed, again
//          when a volunteer uploads the winners photo, and every few minutes
//          afterwards as the day's highlights.
//
// Everything here is plain logic on the TV model (no DOM), so it is tested
// on its own; tvEngine.ts draws the result.

import type { TvCategory, TvMatch, TvModel } from "./tvModel";

/** How long a court call stays up. */
export const CALL_MOMENT_MS = 9_000;
/** How long a champions card stays up. */
export const CHAMP_MOMENT_MS = 14_000;
/** A call older than this (the TV was asleep, or just reconnected) isn't replayed. */
export const CALL_FRESH_MS = 120_000;
/** A champions card comes back this often once any event is decided. */
export const HIGHLIGHT_EVERY_MS = 6 * 60_000;
/** Moments waiting their turn; the oldest is dropped beyond this. */
export const MAX_MOMENTS = 6;

export type Moment =
  | { kind: "call"; id: string; matchId: string; dur: number }
  | { kind: "champ"; id: string; catId: string; dur: number; reason: "won" | "photo" | "highlight" };

/** Matches called since the previous feed update, in the order they were called. */
export function newCalls(prev: TvModel, next: TvModel, now: number): TvMatch[] {
  return next.courts
    .filter((m): m is TvMatch => !!m && m.status === "called" && !!m.a && !!m.b && m.court != null)
    .filter(m => prev.byId[m.id]?.status !== "called")
    .filter(m => m.calledAt == null || now - m.calledAt <= CALL_FRESH_MS)
    .sort((x, y) => (x.calledAt ?? 0) - (y.calledAt ?? 0));
}

/** Events decided since the previous feed update. An event the previous feed didn't know isn't news. */
export function newChampions(prev: TvModel, next: TvModel): TvCategory[] {
  return next.categories.filter(c => c.finished && !!c.champion && prev.catById[c.id] !== undefined && !prev.catById[c.id].finished);
}

/** A queued call is only shown while its match is still being called, or has just gone on. */
export function callStillOn(model: TvModel, matchId: string): boolean {
  const m = model.byId[matchId];
  return !!m && m.court != null && !!m.a && !!m.b && (m.status === "called" || (m.status === "live" && !m.ending));
}

/** A champions card is only shown while the event still has its champion (a result can be undone). */
export function champStillOn(model: TvModel, catId: string): boolean {
  const c = model.catById[catId];
  return !!c && c.finished && !!c.champion && !!model.teams[c.champion];
}

export const callMoment = (m: TvMatch): Moment => ({ kind: "call", id: `call:${m.id}:${m.calledAt ?? 0}`, matchId: m.id, dur: CALL_MOMENT_MS });
export const champMoment = (catId: string, reason: "won" | "photo" | "highlight", key = ""): Moment =>
  ({ kind: "champ", id: `${reason}:${catId}:${key}`, catId, dur: CHAMP_MOMENT_MS, reason });

/**
 * Adds a moment unless this exact one was queued before. `seen` remembers
 * every id for the life of the page, so a feed update that repeats a state
 * never replays it. Returns true when it was added.
 */
export function queueMoment(queue: Moment[], seen: Set<string>, m: Moment): boolean {
  if (seen.has(m.id)) return false;
  seen.add(m.id);
  queue.push(m);
  while (queue.length > MAX_MOMENTS) queue.shift();
  return true;
}

/** The decided events in programme order. */
export const decided = (model: TvModel): TvCategory[] =>
  model.categories.filter(c => c.finished && !!c.champion && !!model.teams[c.champion]).sort((x, y) => x.order - y.order);

/** The next decided event for the highlights, after the one shown last (round and round). */
export function nextHighlight(model: TvModel, lastCatId: string | null): TvCategory | null {
  const list = decided(model);
  if (!list.length) return null;
  const i = list.findIndex(c => c.id === lastCatId);
  return list[(i + 1) % list.length];
}
