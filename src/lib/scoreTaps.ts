// Score taps and typed scores for live matches: the +/− buttons on the
// Matches tab and on the match cards, and the cards' score boxes.
//
// The screen used to step from the last score the server had sent back and
// save that number. Admin screens only hear about a save through realtime and
// a refetch, about a second later, so every tap in that second started from
// the same old score and most were lost: in the Nov 4 rehearsal, 5 quick taps
// for one side and 3 for the other saved 1–1. Confirm read the old score too.
//
// Now each tap steps from the number on screen. A match has at most one save
// in flight, and it always writes the newest numbers, so saves can't land out
// of order and the last number tapped is the one saved. The screen keeps
// showing the scorer's number until the server reports it back.

import type { Match } from "../types";

export type Side = "a" | "b";
export type ScorePatch = { score_a?: number; score_b?: number };
export type ScoredMatch = Pick<Match, "id" | "score_a" | "score_b" | "status" | "confirmed" | "started_at">;

type SideState = {
  /** Number on screen. */
  wanted: number;
  /** Number the last successful save wrote for this side, or null. */
  saved: number | null;
  /** Server values we may still see on the way to `wanted`: the score before, and numbers since. */
  passing: number[];
};

type MatchState = {
  a?: SideState;
  b?: SideState;
  /** Which run of the match the numbers belong to; a reschedule, restart or result starts another. */
  session: string;
  saving: boolean;
  /** Confirm or Save is writing the result: taps are ignored so nothing lands after it. */
  locks: number;
  /** Callers waiting for the saves to finish (true: all landed; false: one failed). */
  waiters: Array<(ok: boolean) => void>;
  /** The latest server copy of the match, to settle against once the saves finish. */
  server: ScoredMatch;
};

const sessionOf = (m: ScoredMatch) => `${m.status}|${m.confirmed ? 1 : 0}|${m.started_at ?? ""}`;
const serverScore = (m: ScoredMatch, side: Side) => (side === "a" ? m.score_a : m.score_b) ?? 0;

export class ScoreTaps {
  private matches = new Map<string, MatchState>();
  private listeners = new Set<() => void>();
  private ver = 0;

  private readonly save: (matchId: string, patch: ScorePatch) => Promise<void>;
  private readonly onSaveFailed: (error: unknown) => void;

  constructor(
    save: (matchId: string, patch: ScorePatch) => Promise<void>,
    onSaveFailed: (error: unknown) => void = () => {},
  ) {
    this.save = save;
    this.onSaveFailed = onSaveFailed;
  }

  // ---- store plumbing (useSyncExternalStore) ----
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  version = (): number => this.ver;
  private emit() {
    this.ver++;
    for (const l of [...this.listeners]) l();
  }

  /** The number to show for one side: the scorer's while it's ahead of the server, else the server's. */
  shown(m: ScoredMatch, side: Side): number {
    const st = this.matches.get(m.id);
    const s = st && st.session === sessionOf(m) ? st[side] : undefined;
    return s ? s.wanted : serverScore(m, side);
  }

  /** True while a Confirm or Save for this match is writing its result. */
  isLocked(matchId: string): boolean {
    return (this.matches.get(matchId)?.locks ?? 0) > 0;
  }

  /** A +/− tap: one step from the number on screen, never below 0. */
  step(m: ScoredMatch, side: Side, delta: number): void {
    if (this.isLocked(m.id)) return;
    this.want(m, side, Math.max(0, this.shown(m, side) + delta));
  }

  /**
   * A typed score. Resolves once it (or a later number for the match) is
   * saved; rejects if the save fails, and the screen goes back to the server's.
   */
  type(m: ScoredMatch, side: Side, value: number): Promise<void> {
    if (!this.isLocked(m.id)) this.want(m, side, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));
    return this.flush(m.id).then((ok) => { if (!ok) throw new Error("The score didn't save."); });
  }

  /** Wait until every save for the match has landed: true if they all did, false if one failed. */
  flush(matchId: string): Promise<boolean> {
    const st = this.matches.get(matchId);
    if (!st || !st.saving) return Promise.resolve(true);
    return new Promise((resolve) => st.waiters.push(resolve));
  }

  /**
   * Ignore taps on a match while its result is written (Confirm, Save), so no
   * tap saved after it can change the score of a decided match. Returns the
   * function that lets taps through again.
   */
  lock(m: ScoredMatch): () => void {
    const st = this.ensure(m);
    st.locks++;
    this.emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const cur = this.matches.get(m.id);
      if (!cur) return;
      cur.locks = Math.max(0, cur.locks - 1);
      this.settle(m.id);
      this.emit();
    };
  }

  /** The server's copy of a match arrived (refetch or snapshot): hand the screen back once it has caught up. */
  serverSaw(m: ScoredMatch): void {
    const st = this.matches.get(m.id);
    if (!st) return;
    st.server = m;
    if (this.settle(m.id)) this.emit();
  }

  // ---- internals ----

  private ensure(m: ScoredMatch): MatchState {
    let st = this.matches.get(m.id);
    if (!st || (st.session !== sessionOf(m) && !st.saving && st.locks === 0)) {
      st = { session: sessionOf(m), saving: false, locks: 0, waiters: [], server: m };
      this.matches.set(m.id, st);
    }
    return st;
  }

  private want(m: ScoredMatch, side: Side, next: number) {
    const st = this.ensure(m);
    const s = st[side];
    if (!s) {
      const from = serverScore(m, side);
      if (next === from) return;
      st[side] = { wanted: next, saved: null, passing: [from] };
    } else {
      if (next === s.wanted) return;
      if (!s.passing.includes(s.wanted)) s.passing.push(s.wanted);
      s.wanted = next;
    }
    this.emit();
    void this.pump(m.id);
  }

  /** Send the newest numbers, one save at a time, until nothing is unsaved. */
  private async pump(matchId: string) {
    const st = this.matches.get(matchId);
    if (!st || st.saving) return;
    st.saving = true;
    let ok = true;
    for (;;) {
      const patch: ScorePatch = {};
      if (st.a && st.a.saved !== st.a.wanted) patch.score_a = st.a.wanted;
      if (st.b && st.b.saved !== st.b.wanted) patch.score_b = st.b.wanted;
      if (patch.score_a === undefined && patch.score_b === undefined) break;
      try {
        await this.save(matchId, patch);
        if (patch.score_a !== undefined && st.a) st.a.saved = patch.score_a;
        if (patch.score_b !== undefined && st.b) st.b.saved = patch.score_b;
      } catch (e) {
        ok = false;
        // Not saved: every number not yet saved goes back to the server's
        // (said once, by onSaveFailed). The scorer taps again.
        for (const side of ["a", "b"] as const) {
          const s = st[side];
          if (s && s.saved !== s.wanted) st[side] = undefined;
        }
        this.onSaveFailed(e);
        break;
      }
    }
    st.saving = false;
    const waiters = st.waiters.splice(0);
    this.settle(matchId);
    this.emit();
    for (const w of waiters) w(ok);
  }

  /** Drop what the server has caught up with. True if anything changed. */
  private settle(matchId: string): boolean {
    const st = this.matches.get(matchId);
    if (!st || st.saving) return false;
    let changed = false;
    if (st.session !== sessionOf(st.server)) {
      // Confirmed, rescheduled, cancelled or restarted (here or by another admin).
      if (st.a || st.b) changed = true;
      st.a = undefined;
      st.b = undefined;
    }
    for (const side of ["a", "b"] as const) {
      const s = st[side];
      if (!s || s.saved !== s.wanted) continue;
      const v = serverScore(st.server, side);
      // The server shows our number, or a number we never had (someone else
      // changed it): the screen follows the server. An older number of ours
      // means our save's echo is still on the way, so keep ours.
      if (v === s.wanted || !s.passing.includes(v)) {
        st[side] = undefined;
        changed = true;
      }
    }
    if (!st.a && !st.b && st.locks === 0 && st.waiters.length === 0) this.matches.delete(matchId);
    return changed;
  }
}
