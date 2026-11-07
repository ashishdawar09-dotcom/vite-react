import { describe, expect, it } from "vitest";
import { ScoreTaps, type ScorePatch, type ScoredMatch } from "../scoreTaps";

// A save that stays open until the test lands or fails it, like a slow phone.
type Call = { id: string; patch: ScorePatch; land: () => void; fail: (e: unknown) => void };

function harness() {
  const calls: Call[] = [];
  const failures: unknown[] = [];
  let open = 0;
  let mostOpen = 0;
  const taps = new ScoreTaps(
    (id, patch) => new Promise<void>((resolve, reject) => {
      open++;
      mostOpen = Math.max(mostOpen, open);
      calls.push({
        id, patch,
        land: () => { open--; resolve(); },
        fail: (e) => { open--; reject(e); },
      });
    }),
    (e) => failures.push(e),
  );
  return { taps, calls, failures, mostOpen: () => mostOpen };
}

const live = (over: Partial<ScoredMatch> = {}): ScoredMatch => ({
  id: "m1", score_a: 0, score_b: 0, status: "live", confirmed: false, started_at: "2026-11-21T17:00:00Z", ...over,
});
// Let the saver's awaits run.
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("score taps (QA review item 6)", () => {
  it("keeps every quick tap: 5 for one side and 3 for the other save 5–3 (the rehearsal saved 1–1)", async () => {
    const { taps, calls, mostOpen } = harness();
    const m = live();
    for (let i = 0; i < 5; i++) taps.step(m, "a", 1);
    for (let i = 0; i < 3; i++) taps.step(m, "b", 1);
    // The screen shows every tap at once, though the server still says 0–0.
    expect([taps.shown(m, "a"), taps.shown(m, "b")]).toEqual([5, 3]);
    // One save at a time: the first tap's, then the newest numbers together.
    expect(calls.map((c) => c.patch)).toEqual([{ score_a: 1 }]);
    calls[0].land();
    await settle();
    expect(calls.map((c) => c.patch)).toEqual([{ score_a: 1 }, { score_a: 5, score_b: 3 }]);
    calls[1].land();
    await settle();
    expect(calls).toHaveLength(2);
    expect(mostOpen()).toBe(1);
    // The server catches up and the screen follows it.
    const after = live({ score_a: 5, score_b: 3 });
    taps.serverSaw(after);
    expect([taps.shown(after, "a"), taps.shown(after, "b")]).toEqual([5, 3]);
  });

  it("steps from the number on screen, not the server's older one", async () => {
    const { taps, calls } = harness();
    const m = live({ score_a: 20, score_b: 19 });
    taps.step(m, "a", 1);
    taps.step(m, "a", 1); // the server still says 20
    expect(taps.shown(m, "a")).toBe(22);
    calls[0].land();
    await settle();
    expect(calls[1].patch).toEqual({ score_a: 22 });
  });

  it("keeps showing the scorer's number while older numbers come back from the server", async () => {
    const { taps, calls } = harness();
    const m = live();
    taps.step(m, "a", 1);
    taps.step(m, "a", 1);
    taps.step(m, "a", 1);
    calls[0].land();
    await settle();
    taps.serverSaw(live({ score_a: 1 })); // the first save's echo, while the second is on the way
    expect(taps.shown(live({ score_a: 1 }), "a")).toBe(3);
    calls[1].land();
    await settle();
    taps.serverSaw(live({ score_a: 1 })); // a refetch that started before the last save
    expect(taps.shown(live({ score_a: 1 }), "a")).toBe(3);
    taps.serverSaw(live({ score_a: 3 }));
    expect(taps.shown(live({ score_a: 3 }), "a")).toBe(3);
    // Caught up: from now on the screen is the server's.
    expect(taps.shown(live({ score_a: 4 }), "a")).toBe(4);
  });

  it("shows a change made elsewhere once our save has landed", async () => {
    const { taps, calls } = harness();
    const m = live();
    taps.step(m, "a", 1);
    calls[0].land();
    await settle();
    taps.serverSaw(live({ score_a: 7 }));
    expect(taps.shown(live({ score_a: 7 }), "a")).toBe(7);
  });

  it("never goes below 0", async () => {
    const { taps, calls } = harness();
    const m = live();
    taps.step(m, "a", -1);
    expect(taps.shown(m, "a")).toBe(0);
    expect(calls).toHaveLength(0);
    taps.step(m, "b", 1);
    taps.step(m, "b", -1);
    taps.step(m, "b", -1);
    expect(taps.shown(m, "b")).toBe(0);
    calls[0].land();
    await settle();
    expect(calls.map((c) => c.patch)).toEqual([{ score_b: 1 }, { score_b: 0 }]);
  });

  it("a failed save puts the server's score back, says so once, and lets the scorer tap again", async () => {
    const { taps, calls, failures } = harness();
    const m = live({ score_a: 4 });
    taps.step(m, "a", 1);
    taps.step(m, "a", 1);
    taps.step(m, "b", 1); // waits behind the failing save
    const waited = taps.flush("m1");
    calls[0].fail(new Error("offline"));
    await settle();
    expect(await waited).toBe(false);
    expect(failures).toHaveLength(1);
    expect([taps.shown(m, "a"), taps.shown(m, "b")]).toEqual([4, 0]);
    expect(calls).toHaveLength(1);
    taps.step(m, "a", 1);
    expect(calls[1].patch).toEqual({ score_a: 5 });
  });

  it("Confirm: taps wait while the result is written, and flush waits for the last tap's save", async () => {
    const { taps, calls } = harness();
    const m = live();
    taps.step(m, "a", 1);
    taps.step(m, "a", 1);
    taps.step(m, "a", 1);
    const release = taps.lock(m);
    expect(taps.isLocked("m1")).toBe(true);
    taps.step(m, "a", 1); // a stray tap during Confirm is ignored
    expect(taps.shown(m, "a")).toBe(3);
    let flushed: boolean | null = null;
    void taps.flush("m1").then((ok) => { flushed = ok; });
    calls[0].land();
    await settle();
    expect(flushed).toBeNull(); // the last tap (3) is still saving
    expect(calls[1].patch).toEqual({ score_a: 3 });
    calls[1].land();
    await settle();
    expect(flushed).toBe(true);
    expect(calls).toHaveLength(2);
    release();
    taps.step(m, "a", 1);
    expect(taps.shown(m, "a")).toBe(4);
  });

  it("a typed score goes through the same queue: resolves when saved, rejects when not", async () => {
    const { taps, calls } = harness();
    const m = live();
    taps.step(m, "a", 1);
    const typed = taps.type(m, "a", 15);
    expect(taps.shown(m, "a")).toBe(15);
    calls[0].land();
    await settle();
    expect(calls[1].patch).toEqual({ score_a: 15 });
    calls[1].land();
    await expect(typed).resolves.toBeUndefined();

    const bad = taps.type(live({ score_a: 15 }), "b", 7);
    calls[2].fail(new Error("offline"));
    await expect(bad).rejects.toThrow();
  });

  it("a reschedule, restart or result clears the scorer's numbers", async () => {
    const { taps, calls } = harness();
    const m = live();
    taps.step(m, "a", 1);
    calls[0].land();
    await settle();
    const rescheduled = live({ status: "pending", started_at: null, score_a: 0 });
    taps.serverSaw(rescheduled);
    expect(taps.shown(rescheduled, "a")).toBe(0);
    // Started again later: steps from the server's 0, not the old 1.
    const restarted = live({ started_at: "2026-11-21T18:00:00Z", score_a: 0 });
    taps.step(restarted, "a", 1);
    expect(taps.shown(restarted, "a")).toBe(1);
  });

  it("saves for different matches don't wait for each other", () => {
    const { taps, calls } = harness();
    taps.step(live({ id: "m1" }), "a", 1);
    taps.step(live({ id: "m2" }), "b", 1);
    expect(calls.map((c) => [c.id, c.patch])).toEqual([["m1", { score_a: 1 }], ["m2", { score_b: 1 }]]);
  });

  it("tells subscribers about every tap", () => {
    const { taps } = harness();
    let heard = 0;
    const off = taps.subscribe(() => { heard++; });
    const before = taps.version();
    taps.step(live(), "a", 1);
    expect(heard).toBeGreaterThan(0);
    expect(taps.version()).toBeGreaterThan(before);
    off();
  });
});
