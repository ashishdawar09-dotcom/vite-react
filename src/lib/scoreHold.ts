// What a score box shows after a save, while the save is in flight.
//
// A saved number is held on screen until the server reports it back, so the
// box doesn't flick back to the old score (and Confirm doesn't read it). The
// prop may pass through values from earlier saves on the way; those don't end
// the hold. Any other value means someone else changed the score, and the
// hold is dropped.

export type ScoreHold = {
  /** Number on screen. */
  next: number;
  /** Values the prop may still show on the way to `next` (the score before, earlier saves). */
  passing: number[];
  /** The save that wrote `next`. */
  seq: number;
  /** That save has come back OK. */
  settled: boolean;
};

let seqCounter = 0;

/** Decide whether `typed` needs a write, given the server `value` and any current hold. */
export function commitScore(hold: ScoreHold | null, value: number, typed: number): { write: boolean; hold: ScoreHold | null; seq: number } {
  const shown = hold ? hold.next : value;
  if (typed === shown) return { write: false, hold, seq: hold?.seq ?? 0 };
  const seq = ++seqCounter;
  const passing = hold ? [...hold.passing, hold.next] : [value];
  return { write: true, hold: { next: typed, passing, seq, settled: false }, seq };
}

/** The server value changed (or a render happened); keep or drop the hold. */
export function holdAfterProp(hold: ScoreHold | null, value: number): ScoreHold | null {
  if (!hold) return null;
  if (value === hold.next) return hold.settled ? null : hold;
  return hold.passing.includes(value) ? hold : null;
}

/** A save came back. Only the latest save decides; a failed latest save drops the hold. */
export function holdAfterWrite(hold: ScoreHold | null, seq: number, ok: boolean): ScoreHold | null {
  if (!hold || hold.seq !== seq) return hold;
  return ok ? { ...hold, settled: true } : null;
}
