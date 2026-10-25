import { describe, expect, it } from "vitest";
import { commitScore, holdAfterProp, holdAfterWrite } from "../scoreHold";

describe("score box hold (blockers 4 and review S4)", () => {
  it("holds a typed score until the server returns it", () => {
    const c = commitScore(null, 15, 21);
    expect(c.write).toBe(true);
    let h = c.hold;
    expect(h?.next).toBe(21);
    h = holdAfterProp(h, 15); // realtime hasn't caught up yet
    expect(h?.next).toBe(21);
    h = holdAfterWrite(h, c.seq, true);
    h = holdAfterProp(h, 21);
    expect(h).toBeNull();
  });

  it("doesn't write a number that is already what the box shows", () => {
    expect(commitScore(null, 15, 15).write).toBe(false);
    const first = commitScore(null, 15, 21);
    expect(commitScore(first.hold, 15, 21).write).toBe(false);
  });

  it("re-typing the original score while a save is in flight writes it, and the box keeps showing it", () => {
    const first = commitScore(null, 15, 21);
    const second = commitScore(first.hold, 15, 15);
    expect(second.write).toBe(true);
    let h = second.hold;
    expect(h?.next).toBe(15);
    // The first write lands: realtime briefly reports 21. Keep showing 15.
    h = holdAfterWrite(h, first.seq, true);
    h = holdAfterProp(h, 21);
    expect(h?.next).toBe(15);
    // The second write lands and the server is back to 15.
    h = holdAfterWrite(h, second.seq, true);
    h = holdAfterProp(h, 15);
    expect(h).toBeNull();
  });

  it("lets go when the score changes some other way", () => {
    const c = commitScore(null, 15, 21);
    expect(holdAfterProp(c.hold, 7)).toBeNull();
  });

  it("lets go when the latest save fails", () => {
    const c = commitScore(null, 15, 21);
    expect(holdAfterWrite(c.hold, c.seq, false)).toBeNull();
  });

  it("an older save failing doesn't drop the newer hold", () => {
    const a = commitScore(null, 15, 21);
    const b = commitScore(a.hold, 15, 18);
    expect(holdAfterWrite(b.hold, a.seq, false)?.next).toBe(18);
  });
});
