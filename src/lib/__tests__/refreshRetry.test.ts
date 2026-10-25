import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefresher } from "../refreshRetry";

describe("createRefresher (report blocker 6)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps the previous data when a fetch errors, flags it, and retries until it works", async () => {
    const stale: boolean[] = [];
    const r = createRefresher({ onStaleChange: s => stale.push(s), delaysMs: [1000, 2000] });
    const apply = vi.fn();
    const fetch = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ data: [1, 2], error: null });

    expect(await r.run("matches", fetch, apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(stale).toEqual([true]);

    await vi.advanceTimersByTimeAsync(1000); // retry 1: throws
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000); // retry 2: works
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(apply).toHaveBeenCalledWith([1, 2]);
    expect(stale).toEqual([true, false]);
  });

  it("stays stale until every failing table has recovered", async () => {
    const stale: boolean[] = [];
    const r = createRefresher({ onStaleChange: s => stale.push(s), delaysMs: [1000] });
    const bad = async () => ({ data: null, error: { message: "x" } });
    await r.run("teams", bad, () => {});
    await r.run("matches", bad, () => {});
    await r.run("teams", async () => ({ data: [], error: null }), () => {});
    expect(stale).toEqual([true]);
    await r.run("matches", async () => ({ data: [], error: null }), () => {});
    expect(stale).toEqual([true, false]);
  });

  it("a fresh successful load cancels the pending retry", async () => {
    const r = createRefresher({ onStaleChange: () => {}, delaysMs: [1000] });
    const fetch = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "x" } }).mockResolvedValue({ data: [], error: null });
    await r.run("teams", fetch, () => {});
    await r.run("teams", fetch, () => {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reset() drops pending retries (tournament switch / unmount)", async () => {
    const r = createRefresher({ onStaleChange: () => {}, delaysMs: [1000] });
    const fetch = vi.fn().mockResolvedValue({ data: null, error: { message: "x" } });
    await r.run("teams", fetch, () => {});
    r.reset();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("null data without an error means an empty table", async () => {
    const r = createRefresher({ onStaleChange: () => {} });
    const apply = vi.fn();
    expect(await r.run("teams", async () => ({ data: null, error: null }), apply)).toBe(true);
    expect(apply).toHaveBeenCalledWith([]);
  });
});
