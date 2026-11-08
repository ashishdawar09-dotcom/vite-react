import { startSpectatorPoll } from "../../lib/spectatorPoll";
import type { Match } from "../../types";

// The venue TV's score feed: the cached /api/snapshot feed (RPC fallback, see
// db.liveSnapshot) every 5 s while anything is on court, 15 s otherwise,
// paused while the screen is hidden and fetched at once when it's shown.
//
// The TV used to run its own loop that waited for each request to finish
// before scheduling the next, and skipped wake-ups while one was in flight.
// On the database fallback a response body that stalls part-way never settles
// (the 15 s request timeout ends once the headers arrive), so one such request
// froze the TV on "Reconnecting" until someone reloaded it.
//
// It now runs on the spectator pages' loop (lib/spectatorPoll.ts): a request
// is joined only while it is under 10 s old, and the loop stops waiting for
// one after 60 s. Requests are numbered here, so an answer from a request the
// loop has moved past is dropped, and that request counts as a failed try
// (once, when the next request goes out). After giving up, the loop waits its
// last pace before asking again: 5 s if a match was on court, else 15 s.

export const POLL_LIVE_MS = 5_000;
export const POLL_IDLE_MS = 15_000;

type FeedMatch = Pick<Match, "status" | "court_number" | "court_allocated_at">;
type FeedSnapshot = { tournament: unknown; matches: FeedMatch[] };

/** Something on court: a match live, or one called to a court and not started yet. */
export function feedIsBusy(snap: { matches: FeedMatch[] }): boolean {
  return snap.matches.some(m => m.status === "live" || (m.status === "pending" && m.court_number != null && !!m.court_allocated_at));
}

export type TvFeedOptions<S extends FeedSnapshot> = {
  /** One snapshot request (db.liveSnapshot). */
  load: () => Promise<S | null>;
  /** The wait before the next request, given the normal one (db.liveSnapshotPollDelay). */
  pollDelay: (normalMs: number) => number;
  /** A snapshot arrived, at `receivedAt` on this device's clock. */
  onSnapshot: (snap: S, receivedAt: number) => void;
  /** A try that brought no snapshot: an error, no tournament, or no answer. */
  onFailure: () => void;
  isHidden: () => boolean;
  /** Calls `cb` on every visibility change; returns an unsubscribe. */
  onVisibilityChange: (cb: () => void) => () => void;
};

export function startTvFeed<S extends FeedSnapshot>(o: TvFeedOptions<S>): { stop: () => void } {
  let stopped = false;
  let sent = 0; // requests sent so far; only the newest one's answer counts
  let answered = 0; // the newest request that answered or was written off
  let busy = false; // the last try showed something on court
  const poll = startSpectatorPoll({
    fetch: async () => {
      // The previous request never answered: the loop gave up on it, or the
      // screen was shown again long after it went out. It counts as a failed try.
      if (answered < sent) {
        answered = sent;
        busy = false;
        o.onFailure();
      }
      const mine = ++sent;
      let snap: S | null;
      try {
        snap = await o.load();
      } catch {
        snap = null;
      }
      if (stopped || mine !== sent) return; // late: the loop has moved past this request
      answered = mine;
      if (snap && snap.tournament) {
        busy = feedIsBusy(snap);
        o.onSnapshot(snap, Date.now());
      } else {
        busy = false;
        o.onFailure();
      }
    },
    firstDelay: 0,
    nextDelay: () => o.pollDelay(busy ? POLL_LIVE_MS : POLL_IDLE_MS),
    isHidden: o.isHidden,
    onVisibilityChange: o.onVisibilityChange,
  });
  return {
    stop: () => {
      stopped = true;
      poll.stop();
    },
  };
}
