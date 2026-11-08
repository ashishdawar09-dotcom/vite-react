import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GIVE_UP_MS, JOIN_MAX_AGE_MS } from "../../lib/spectatorPoll";
import type { Match } from "../../types";
import { feedIsBusy, POLL_IDLE_MS, POLL_LIVE_MS, startTvFeed } from "./tvFeed";

type FeedMatch = Pick<Match, "status" | "court_number" | "court_allocated_at">;
type Snap = { tournament: { id: string } | null; matches: FeedMatch[]; n: number };

const CALLED_AT = "2026-11-21T17:00:00Z";
const queued: FeedMatch = { status: "pending", court_number: null, court_allocated_at: null };
const idle = (n: number): Snap => ({ tournament: { id: "t1" }, matches: [queued], n });
const live = (n: number): Snap => ({ tournament: { id: "t1" }, matches: [queued, { status: "live", court_number: 1, court_allocated_at: CALLED_AT }], n });
const called = (n: number): Snap => ({ tournament: { id: "t1" }, matches: [queued, { status: "pending", court_number: 2, court_allocated_at: CALLED_AT }], n });

/** What request n gets: a snapshot (or null) after `ms`, an error, or no answer ever. */
type Answer = Snap | null | "fail" | "hang";

// A fake venue TV. Request n is answered with `answer(n)` after `ms`;
// "hang" never settles (a response body that stalled part-way), though the
// test can still answer it late with `answerLate`.
function tv(answer: (n: number) => Answer = idle, { ms = 300, pollDelay = (normalMs: number) => normalMs } = {}) {
  let hidden = false;
  let listener: (() => void) | null = null;
  let calls = 0;
  let failures = 0;
  const shown: number[] = [];
  const delays: number[] = [];
  const stalled = new Map<number, (s: Snap) => void>();
  const feed = startTvFeed<Snap>({
    load: () => {
      const n = ++calls;
      const a = answer(n);
      return new Promise<Snap | null>((resolve, reject) => {
        if (a === "hang") stalled.set(n, resolve);
        else setTimeout(() => (a === "fail" ? reject(new Error("network blip")) : resolve(a)), ms);
      });
    },
    pollDelay: normalMs => {
      delays.push(normalMs);
      return pollDelay(normalMs);
    },
    onSnapshot: snap => {
      shown.push(snap.n);
      failures = 0;
    },
    onFailure: () => {
      failures++;
    },
    isHidden: () => hidden,
    onVisibilityChange: cb => {
      listener = cb;
      return () => { listener = null; };
    },
  });
  return {
    feed,
    get calls() { return calls; },
    get failures() { return failures; },
    /** Which requests' snapshots reached the screen, in order. */
    get shown() { return shown; },
    /** The normal delay the feed asked for after each try (before pollDelay). */
    get delays() { return delays; },
    get subscribed() { return listener !== null; },
    answerLate(n: number, snap: Snap) { stalled.get(n)?.(snap); },
    lock() { hidden = true; listener?.(); },
    unlock() { hidden = false; listener?.(); },
  };
}

// Requests made in the next `ms` with the TV left alone.
async function callsOver(t: ReturnType<typeof tv>, ms: number) {
  const before = t.calls;
  await vi.advanceTimersByTimeAsync(ms);
  return t.calls - before;
}

// Small seeded random numbers, so the wake-up test is the same every run.
function rng(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe("venue TV feed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a request that never settles doesn't freeze the TV", async () => {
    const t = tv(n => (n === 1 ? "hang" : idle(n)));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toBe(1); // the first request goes out at once, and stalls
    expect(await callsOver(t, GIVE_UP_MS - 1)).toBe(0); // still waiting on it
    // After 60 s the feed stops waiting, waits its idle 15 s and asks again.
    // (The old loop waited for ever here: the TV stayed on "Reconnecting".)
    expect(await callsOver(t, 1 + POLL_IDLE_MS)).toBe(1);
    expect(t.failures).toBe(1); // the stalled request counts as a failed try
    await vi.advanceTimersByTimeAsync(300);
    expect(t.shown).toEqual([2]);
    expect(t.failures).toBe(0);
    // Then its normal pace: a 15 s wait plus a 0.3 s answer.
    expect(await callsOver(t, 60_000)).toBe(3);
    t.feed.stop();
  });

  it("after giving up, asks again at its last pace: 5 s when a match was on court", async () => {
    const t = tv(n => (n === 2 ? "hang" : live(n)));
    await vi.advanceTimersByTimeAsync(300 + POLL_LIVE_MS); // request 1 answered (live); request 2 goes out at 5.3 s and stalls
    expect(t.calls).toBe(2);
    expect(await callsOver(t, GIVE_UP_MS - 1)).toBe(0);
    expect(await callsOver(t, 1 + POLL_LIVE_MS)).toBe(1); // 60 s, then 5 s
    expect(t.failures).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.shown).toEqual([1, 3]);
    t.feed.stop();
  });

  it("a slow answer overtaken when the screen is shown again is dropped, and counted once", async () => {
    const t = tv(n => (n === 1 ? "hang" : idle(n)));
    await vi.advanceTimersByTimeAsync(0); // request 1 goes out and is slow
    t.lock();
    await vi.advanceTimersByTimeAsync(12_000);
    t.unlock(); // 12 s old, too old to join: request 2 goes out
    await vi.advanceTimersByTimeAsync(100);
    expect(t.calls).toBe(2);
    expect(t.failures).toBe(1);
    t.answerLate(1, idle(1)); // request 1 answers while request 2 is still out
    await vi.advanceTimersByTimeAsync(0);
    expect(t.shown).toEqual([]); // request 2's answer is the one that counts
    expect(t.failures).toBe(1); // not counted twice
    await vi.advanceTimersByTimeAsync(200);
    expect(t.shown).toEqual([2]);
    expect(t.failures).toBe(0);
    t.feed.stop();
  });

  it("drops a stalled request's answer once a newer request has gone out", async () => {
    const t = tv(n => (n === 1 ? "hang" : idle(n)));
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS + POLL_IDLE_MS + 300); // request 2 has answered
    expect(t.shown).toEqual([2]);
    t.answerLate(1, idle(1)); // request 1 finally answers, with older scores
    await vi.advanceTimersByTimeAsync(0);
    expect(t.shown).toEqual([2]); // they don't replace the newer ones
    expect(t.failures).toBe(0);
    t.feed.stop();
  });

  it("still shows a slow answer that arrives before the next request", async () => {
    const t = tv(n => (n === 1 ? "hang" : idle(n)));
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS + 2_000); // given up on, next request not sent yet
    t.answerLate(1, idle(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.shown).toEqual([1]); // still the newest scores there are
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    expect(t.calls).toBe(2);
    expect(t.failures).toBe(0); // it answered, so it isn't counted as a failure
    t.feed.stop();
  });

  it("keeps the TV's pace: 5 s while a match is live or called, 15 s otherwise and after a failure", async () => {
    const t = tv(n => (n <= 2 ? live(n) : n === 3 ? "fail" : n <= 5 ? called(n) : idle(n)));
    await vi.advanceTimersByTimeAsync(60_000);
    // Requests at 0, 5.3, 10.6 (fails), 25.9, 31.2, 36.5, 51.8 s.
    expect(t.delays).toEqual([POLL_LIVE_MS, POLL_LIVE_MS, POLL_IDLE_MS, POLL_LIVE_MS, POLL_LIVE_MS, POLL_IDLE_MS, POLL_IDLE_MS]);
    expect(t.calls).toBe(7);
    t.feed.stop();
  });

  it("waits as long as pollDelay says (30 s while the cached feed is down)", async () => {
    const t = tv(idle, { pollDelay: () => 30_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toBe(1);
    expect(await callsOver(t, 30_299)).toBe(0);
    expect(await callsOver(t, 1)).toBe(1); // 30 s after the 0.3 s answer
    t.feed.stop();
  });

  it("counts failed tries until scores arrive, then starts again from zero", async () => {
    const t = tv(n => (n === 1 ? "fail" : n === 2 ? null : n === 3 ? { tournament: null, matches: [], n } : idle(n)));
    await vi.advanceTimersByTimeAsync(300);
    expect(t.failures).toBe(1); // an error
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS + 300);
    expect(t.failures).toBe(2); // no snapshot
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS + 300);
    expect(t.failures).toBe(3); // no tournament in it
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS + 300);
    expect(t.failures).toBe(0);
    expect(t.shown).toEqual([4]);
    t.feed.stop();
  });

  it("doesn't ask while the screen is hidden, and asks at once when it's shown", async () => {
    const t = tv();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.calls).toBe(1);
    t.lock();
    expect(await callsOver(t, 120_000)).toBe(0);
    t.unlock();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toBe(2);
    t.feed.stop();
  });

  it("shown again long after a request stalled: asks again at once instead of waiting on it", async () => {
    const t = tv(n => (n === 1 ? "hang" : idle(n)));
    await vi.advanceTimersByTimeAsync(0); // request 1 goes out and stalls
    t.lock();
    await vi.advanceTimersByTimeAsync(JOIN_MAX_AGE_MS + 1_000);
    t.unlock();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toBe(2);
    expect(t.failures).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.shown).toEqual([2]);
    t.feed.stop();
  });

  it("shown again during a fresh request: joins it instead of sending another", async () => {
    const t = tv(idle, { ms: 2_000 });
    await vi.advanceTimersByTimeAsync(500); // request 1 in flight for 0.5 s
    t.lock();
    t.unlock();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toBe(1);
    t.feed.stop();
  });

  it("30 sleeps and wakes at random moments still leave one loop", async () => {
    const t = tv(idle, { ms: 800 });
    const rand = rng(7);
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(Math.floor(rand() * 20_000));
      t.lock();
      await vi.advanceTimersByTimeAsync(Math.floor(rand() * 5_000));
      t.unlock();
    }
    await vi.advanceTimersByTimeAsync(20_000);
    // One loop asks every 15.8 s (15 s wait + 0.8 s answer): 3 or 4 a minute.
    const n = await callsOver(t, 60_000);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(4);
    t.feed.stop();
  });

  it("stop(): no more requests, a late answer is dropped, and it stops listening", async () => {
    const t = tv(n => (n === 1 ? "hang" : idle(n)));
    await vi.advanceTimersByTimeAsync(0);
    t.feed.stop();
    t.answerLate(1, idle(1));
    expect(await callsOver(t, 120_000)).toBe(0);
    expect(t.shown).toEqual([]);
    expect(t.failures).toBe(0);
    expect(t.subscribed).toBe(false);
  });

  it("busy means a match live, or called to a court and not started", () => {
    expect(feedIsBusy(live(1))).toBe(true);
    expect(feedIsBusy(called(1))).toBe(true);
    expect(feedIsBusy(idle(1))).toBe(false);
    expect(feedIsBusy({ matches: [{ status: "pending", court_number: 3, court_allocated_at: null }] })).toBe(false);
    expect(feedIsBusy({ matches: [{ status: "completed", court_number: 1, court_allocated_at: CALLED_AT }] })).toBe(false);
  });
});
