import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GIVE_UP_MS, JOIN_MAX_AGE_MS, startSpectatorPoll } from "../spectatorPoll";

// A fake page: a refresh takes `fetchMs`, the poll runs every 5 s, and the
// test flips the page between hidden and shown like a phone being locked.
// Refreshes numbered in `hang` never finish (a response that stalled).
function page({ fetchMs = 300, failEvery = 0, hang = [] as number[] } = {}) {
  let hidden = false;
  let listener: (() => void) | null = null;
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const poll = startSpectatorPoll({
    fetch: async () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (hang.includes(calls)) return new Promise<void>(() => {});
      await new Promise(r => setTimeout(r, fetchMs));
      active--;
      if (failEvery && calls % failEvery === 0) throw new Error("network blip");
    },
    firstDelay: 5_000,
    nextDelay: () => 5_000,
    isHidden: () => hidden,
    onVisibilityChange: cb => {
      listener = cb;
      return () => { listener = null; };
    },
  });
  return {
    poll,
    get calls() { return calls; },
    get maxActive() { return maxActive; },
    get subscribed() { return listener !== null; },
    lock() { hidden = true; listener?.(); },
    unlock() { hidden = false; listener?.(); },
  };
}

// Requests made in the next `ms` with the page left alone.
async function callsOver(p: ReturnType<typeof page>, ms: number) {
  const before = p.calls;
  await vi.advanceTimersByTimeAsync(ms);
  return p.calls - before;
}

// Small seeded random numbers, so the stress test is the same every run.
function rng(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe("spectator refresh loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refreshes about once every 5 s", async () => {
    const p = page();
    expect(await callsOver(p, 60_000)).toBe(11); // at 5 s, then every 5.3 s (5 s wait + 0.3 s refresh)
    expect(p.maxActive).toBe(1);
    p.poll.stop();
  });

  it("an unlock during a refresh doesn't start a second loop", async () => {
    const p = page({ fetchMs: 1_000 });
    for (let i = 0; i < 3; i++) {
      // Wait for the next refresh to start, then lock and unlock mid-flight.
      const start = p.calls;
      while (p.calls === start) await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      p.lock();
      p.unlock();
    }
    await vi.advanceTimersByTimeAsync(10_000); // let the dust settle
    // One loop: 5 s wait + 1 s refresh = one request per 6 s, 10 in 60 s.
    // The old code ran 4 loops here, about 40 requests.
    const n = await callsOver(p, 60_000);
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
    expect(p.maxActive).toBe(1);
    p.poll.stop();
  });

  it("50 lock/unlock cycles at random moments still leave exactly one loop", async () => {
    const p = page({ fetchMs: 800 });
    const rand = rng(42);
    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(Math.floor(rand() * 7_000));
      p.lock();
      await vi.advanceTimersByTimeAsync(Math.floor(rand() * 2_000));
      p.unlock();
    }
    await vi.advanceTimersByTimeAsync(10_000);
    const n = await callsOver(p, 60_000);
    expect(n).toBeGreaterThanOrEqual(10); // still refreshing...
    expect(n).toBeLessThanOrEqual(12); // ...but only once per cycle
    expect(p.maxActive).toBe(1);
    p.poll.stop();
  });

  it("refreshes at once when the page is shown, then keeps its normal pace", async () => {
    const p = page();
    await vi.advanceTimersByTimeAsync(6_000); // first refresh done at 5.3 s
    expect(p.calls).toBe(1);
    p.lock();
    await vi.advanceTimersByTimeAsync(1_000);
    p.unlock();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.calls).toBe(2); // straight away
    // The old 10.3 s timer is gone: next refresh is 5 s after this one ends.
    expect(await callsOver(p, 5_000)).toBe(0);
    expect(await callsOver(p, 600)).toBe(1);
    p.poll.stop();
  });

  it("doesn't refresh while the page is hidden", async () => {
    const p = page();
    p.lock();
    expect(await callsOver(p, 60_000)).toBe(0);
    p.unlock();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.calls).toBe(1);
    p.poll.stop();
  });

  it("a failed refresh doesn't stop the loop", async () => {
    const p = page({ failEvery: 2 });
    expect(await callsOver(p, 60_000)).toBe(11);
    p.poll.stop();
  });

  it("fetchNow joins the refresh already in flight", async () => {
    const p = page();
    const a = p.poll.fetchNow();
    const b = p.poll.fetchNow();
    await vi.advanceTimersByTimeAsync(300);
    await Promise.all([a, b]);
    expect(p.calls).toBe(1);
    expect(p.maxActive).toBe(1);
    p.poll.stop();
  });

  it("a refresh that never finishes doesn't stop the loop", async () => {
    const p = page({ hang: [1] });
    await vi.advanceTimersByTimeAsync(5_000); // refresh 1 starts and stalls
    expect(p.calls).toBe(1);
    expect(await callsOver(p, GIVE_UP_MS - 1_000)).toBe(0); // still waiting on it
    // The loop gives up on it, waits 5 s, and carries on as normal.
    expect(await callsOver(p, 1_000 + 5_000 + 100)).toBe(1);
    expect(await callsOver(p, 60_000)).toBeGreaterThanOrEqual(10);
    p.poll.stop();
  });

  it("unlocking during a long-stalled refresh refreshes at once instead of waiting on it", async () => {
    const p = page({ hang: [1] });
    await vi.advanceTimersByTimeAsync(5_000); // refresh 1 starts and stalls
    p.lock();
    await vi.advanceTimersByTimeAsync(JOIN_MAX_AGE_MS + 1_000);
    p.unlock();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.calls).toBe(2); // a new request, not a wait on the stalled one
    expect(await callsOver(p, 5_400)).toBe(1); // then the normal pace
    p.poll.stop();
  });

  it("unlocking during a fresh refresh joins it instead of sending another", async () => {
    const p = page({ fetchMs: 2_000 });
    await vi.advanceTimersByTimeAsync(5_500); // refresh 1 in flight for 0.5 s
    p.lock();
    p.unlock();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.calls).toBe(1);
    expect(p.maxActive).toBe(1);
    p.poll.stop();
  });

  it("stop() during a refresh: nothing more afterwards", async () => {
    const p = page({ fetchMs: 1_000 });
    await vi.advanceTimersByTimeAsync(5_200); // refresh 1 in flight
    p.poll.stop();
    expect(await callsOver(p, 120_000)).toBe(0);
  });

  it("stop() ends the loop and stops listening", async () => {
    const p = page();
    await vi.advanceTimersByTimeAsync(7_000);
    p.poll.stop();
    const n = p.calls;
    p.lock();
    p.unlock();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.calls).toBe(n);
    expect(p.subscribed).toBe(false);
  });
});
