import { describe, it, expect } from "vitest";
import { addSeed, eventChip, moveSeedUp, nextTier, rankEntries, removeSeed, type Draft } from "./seedingDraft";

describe("seeding draft", () => {
  it("numbers seeds in tap order and closes gaps on clear", () => {
    let d: Draft = {};
    d = addSeed(d, "a"); d = addSeed(d, "b"); d = addSeed(d, "c");
    expect([d.a.seed, d.b.seed, d.c.seed]).toEqual([1, 2, 3]);
    d = removeSeed(d, "a");
    expect([d.a.seed, d.b.seed, d.c.seed]).toEqual([null, 1, 2]);
    d = addSeed(d, "a");
    expect(d.a.seed).toBe(3);
  });
  it("keeps the tier when a seed is added or cleared", () => {
    let d: Draft = { a: { seed: null, tier: "A" } };
    d = addSeed(d, "a");
    expect(d.a).toEqual({ seed: 1, tier: "A" });
    expect(removeSeed(d, "a").a).toEqual({ seed: null, tier: "A" });
  });
  it("moves a seed up one place", () => {
    const d: Draft = { a: { seed: 1, tier: null }, b: { seed: 2, tier: null } };
    const m = moveSeedUp(d, "b");
    expect([m.a.seed, m.b.seed]).toEqual([2, 1]);
    expect(moveSeedUp(m, "b")).toBe(m);
  });
  it("cycles tiers none → A → B → none", () => {
    expect([nextTier(null), nextTier("A"), nextTier("B")]).toEqual(["A", "B", null]);
  });
  it("ranks seeds, A, B, then the rest by name", () => {
    const es = ["Zed", "Amy", "Bob", "Cat", "Dan"].map(label => ({ label }));
    const d: Draft = { Dan: { seed: 2, tier: null }, Zed: { seed: 1, tier: null }, Cat: { seed: null, tier: "B" }, Bob: { seed: null, tier: "A" } };
    expect(rankEntries(es, e => e.label, d).map(e => e.label)).toEqual(["Zed", "Dan", "Bob", "Cat", "Amy"]);
  });
  it("shortens event names for the chips", () => {
    expect(eventChip("Men's Doubles 18–34")).toBe("MD 18–34");
    expect(eventChip("Super Doubles 50+")).toBe("SD 50+");
    expect(eventChip("Men's Singles")).toBe("MS");
    expect(eventChip("Youth Girls' Singles")).toBe("YGS");
    expect(eventChip("Mixed Doubles 18–34")).toBe("XD 18–34");
    expect(eventChip("Mixed Doubles 35+")).toBe("XD 35+");
    expect(eventChip("Women's Doubles 35+")).toBe("WD 35+");
  });
  it("gives every Shuttle Storm event its own chip", () => {
    const events = ["Youth Boys' Singles", "Youth Girls' Singles", "Super Doubles 50+", "Women's Doubles 18–34", "Women's Doubles 35+",
      "Men's Singles", "Mixed Doubles 18–34", "Men's Doubles 35+", "Men's Doubles 18–34", "Mixed Doubles 35+"];
    expect(new Set(events.map(eventChip)).size).toBe(events.length);
  });
});
