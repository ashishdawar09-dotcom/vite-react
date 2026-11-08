// The spectator refresh loop: one live-score refresh at a time, every few
// seconds, paused while the page is hidden and run at once when it's shown.
//
// It used to live inline in useTournamentData, where it could split in two.
// Unlocking a phone while a refresh was in flight started a fresh loop, and
// the in-flight one rescheduled itself as well, so every such unlock added a
// loop for the rest of the visit. In Chrome, three unlocks took one page
// from 4 to 18 requests per 30 s (perf audit, Nov 7 2026).
//
// Here each (re)start bumps a generation number, and a loop that finds a
// newer generation after its refresh stops instead of rescheduling. Callers
// share a request in flight while it is fresh, so two refreshes don't run at
// once; one that has run for a long time is likely stuck (a response that
// stalled part-way, a phone that slept mid-request), so it is not joined, and
// the loop stops waiting for it after GIVE_UP_MS. The caller drops a late
// answer from a request it has moved past (useTournamentData does).

/** A refresh in flight is joined only while it is younger than this. */
export const JOIN_MAX_AGE_MS = 10_000;
/** The loop waits this long for one refresh, then carries on without it.
 *  Above the slowest normal refresh (the 8 s feed timeout, then up to three
 *  15 s database tries), so it only acts on a stall. */
export const GIVE_UP_MS = 60_000;

export type SpectatorPollOptions = {
  /** One refresh. Errors are logged and the loop carries on. */
  fetch: () => Promise<void>;
  /** Delay before the first scheduled refresh. */
  firstDelay: number;
  /** Delay before each later refresh, read after every refresh. */
  nextDelay: () => number;
  isHidden: () => boolean;
  /** Calls `cb` on every visibility change; returns an unsubscribe. */
  onVisibilityChange: (cb: () => void) => () => void;
};

export type SpectatorPoll = {
  /** Refresh now, or join a fresh refresh already in flight. */
  fetchNow: () => Promise<void>;
  /** Stops the loop for good. */
  stop: () => void;
};

export function startSpectatorPoll(o: SpectatorPollOptions): SpectatorPoll {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let inFlight: { promise: Promise<void>; startedAt: number } | null = null;

  const fetchShared = (): Promise<void> => {
    const now = Date.now();
    if (inFlight && now - inFlight.startedAt < JOIN_MAX_AGE_MS) return inFlight.promise;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const entry = { startedAt: now, promise: Promise.resolve() };
    entry.promise = Promise.race([
      o.fetch().catch(err => {
        console.warn("[spectatorPoll] refresh failed; will retry", err);
      }),
      new Promise<void>(resolve => { giveUp = setTimeout(resolve, GIVE_UP_MS); }),
    ]).finally(() => {
      clearTimeout(giveUp);
      if (inFlight === entry) inFlight = null;
    });
    inFlight = entry;
    return entry.promise;
  };

  const schedule = (delay: number) => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    const mine = ++generation;
    timer = setTimeout(async () => {
      timer = null;
      if (stopped || mine !== generation) return;
      if (!o.isHidden()) await fetchShared();
      // A newer loop started while this refresh ran (the page was shown
      // again): that loop carries on and this one ends here.
      if (stopped || mine !== generation) return;
      schedule(o.nextDelay());
    }, delay);
  };

  const unsubscribe = o.onVisibilityChange(() => {
    if (stopped || o.isHidden()) return;
    schedule(0); // shown again: refresh now and restart the cycle from here
  });

  schedule(o.firstDelay);

  return {
    fetchNow: () => (stopped ? Promise.resolve() : fetchShared()),
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unsubscribe();
    },
  };
}
