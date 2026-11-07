import { describe, expect, it } from "vitest";
import {
  applyPing,
  formRank,
  formSpot,
  formTopic,
  isFormSpot,
  isSitePath,
  listVisitors,
  newBook,
  pruneBook,
  sitePageLabel,
  siteRank,
  STALE_AWAY_MS,
  STALE_IN_FRONT_MS,
  timeOnPage,
  TOURNAMENT_SITE,
} from "../liveVisitors";

const NOW = Date.UTC(2026, 10, 7, 15, 0, 0);
const ID_A = "0c4a7700-aaaa-4000-8000-000000000001";
const ID_B = "0c4a7700-bbbb-4000-8000-000000000002";
const here = (id: string, n: number, at: string, extra: Record<string, unknown> = {}) => ({ id, n, at, visible: true, since: NOW - 60_000, ...extra });

describe("applyPing", () => {
  it("adds a page, then follows it to the next step", () => {
    const b = newBook();
    expect(applyPing(b, here(ID_A, 1, "you"), isFormSpot, NOW)).toBe(true);
    expect(applyPing(b, here(ID_A, 2, "events"), isFormSpot, NOW + 1000)).toBe(true);
    expect([...b.here.values()]).toEqual([{ id: ID_A, at: "events", visible: true, since: NOW - 60_000, seen: NOW + 1000 }]);
  });
  it("ignores a message older than one already seen (requests can arrive out of order)", () => {
    const b = newBook();
    applyPing(b, here(ID_A, 3, "pay"), isFormSpot, NOW);
    expect(applyPing(b, here(ID_A, 2, "events"), isFormSpot, NOW)).toBe(false);
    expect(applyPing(b, here(ID_A, 3, "events"), isFormSpot, NOW)).toBe(false);
    expect(b.here.get(ID_A)?.at).toBe("pay");
  });
  it("removes a page on bye, and a late 'here' can't bring it back", () => {
    const b = newBook();
    applyPing(b, here(ID_A, 1, "you"), isFormSpot, NOW);
    expect(applyPing(b, { id: ID_A, n: 3, bye: true }, isFormSpot, NOW)).toBe(true);
    expect(applyPing(b, here(ID_A, 2, "you"), isFormSpot, NOW)).toBe(false);
    expect(b.here.size).toBe(0);
  });
  it("takes a page back after a bye when it sends a newer message (back from the back/forward cache)", () => {
    const b = newBook();
    applyPing(b, here(ID_A, 1, "you"), isFormSpot, NOW);
    applyPing(b, { id: ID_A, n: 2, bye: true }, isFormSpot, NOW);
    expect(applyPing(b, here(ID_A, 3, "you"), isFormSpot, NOW)).toBe(true);
    expect(b.here.size).toBe(1);
  });
  it("reads a beacon's bye, whose values arrive as text", () => {
    const b = newBook();
    applyPing(b, here(ID_A, 1, "you"), isFormSpot, NOW);
    expect(applyPing(b, { id: ID_A, n: "2", bye: "true" }, isFormSpot, NOW)).toBe(true);
    expect(b.here.size).toBe(0);
    expect(applyPing(b, { id: ID_B, n: "1", at: "you", visible: "false", since: String(NOW - 1000) }, isFormSpot, NOW)).toBe(true);
    expect(b.here.get(ID_B)).toMatchObject({ visible: false, since: NOW - 1000 });
    expect(applyPing(b, { id: ID_B, n: "2.5", bye: "true" }, isFormSpot, NOW)).toBe(false);
    expect(applyPing(b, { id: ID_B, n: "-3", bye: "true" }, isFormSpot, NOW)).toBe(false);
  });
  it("a bye for a page never seen changes nothing", () => {
    expect(applyPing(newBook(), { id: ID_A, n: 1, bye: true }, isFormSpot, NOW)).toBe(false);
  });
  it("ignores anything malformed (the channel is public)", () => {
    const b = newBook();
    for (const bad of [
      null, "x", 5, [],
      { ...here(ID_A, 1, "you"), id: "short" },
      { ...here(ID_A, 1, "you"), id: "has spaces in it!!" },
      { ...here(ID_A, 1, "you"), n: 0 },
      { ...here(ID_A, 1, "you"), n: 1.5 },
      { ...here(ID_A, 1, "you"), n: "one" },
      { ...here(ID_A, 1, "you"), n: "1e3" },
      here(ID_A, 1, "admin"),
      { id: ID_A, n: 1, visible: true, since: NOW },
    ]) {
      expect(applyPing(b, bad, isFormSpot, NOW)).toBe(false);
    }
    expect(b.here.size).toBe(0);
  });
  it("never puts a start time in the future, and counts a page as in front unless it says otherwise", () => {
    const b = newBook();
    applyPing(b, { id: ID_A, n: 1, at: "you", since: NOW + 3_600_000 }, isFormSpot, NOW);
    expect(b.here.get(ID_A)).toMatchObject({ since: NOW, visible: true });
    applyPing(b, { id: ID_B, n: 1, at: "you", since: "soon", visible: false }, isFormSpot, NOW);
    expect(b.here.get(ID_B)).toMatchObject({ since: NOW, visible: false });
  });
});

describe("pruneBook", () => {
  it("drops a page in front after 75 s of silence (closed without a bye)", () => {
    const b = newBook();
    applyPing(b, here(ID_A, 1, "you"), isFormSpot, NOW);
    expect(pruneBook(b, NOW + STALE_IN_FRONT_MS)).toBe(false);
    expect(pruneBook(b, NOW + STALE_IN_FRONT_MS + 1)).toBe(true);
    expect(b.here.size).toBe(0);
  });
  it("keeps a page in the background as away for 5 minutes", () => {
    const b = newBook();
    applyPing(b, here(ID_A, 1, "pay", { visible: false }), isFormSpot, NOW);
    expect(pruneBook(b, NOW + 4 * 60_000)).toBe(false);
    expect(pruneBook(b, NOW + STALE_AWAY_MS + 1)).toBe(true);
  });
  it("forgets message numbers of pages long gone", () => {
    const b = newBook();
    applyPing(b, here(ID_A, 1, "you"), isFormSpot, NOW);
    applyPing(b, { id: ID_A, n: 2, bye: true }, isFormSpot, NOW);
    pruneBook(b, NOW + 29 * 60_000);
    expect(b.last.has(ID_A)).toBe(true);
    pruneBook(b, NOW + 31 * 60_000);
    expect(b.last.has(ID_A)).toBe(false);
  });
});

describe("listVisitors", () => {
  it("lists the furthest along first, then the longest there, and counts the away ones", () => {
    const b = newBook();
    applyPing(b, here(ID_A, 1, "you", { since: NOW - 5 * 60_000 }), isFormSpot, NOW);
    applyPing(b, here(ID_B, 1, "pay", { visible: false }), isFormSpot, NOW);
    applyPing(b, here("0c4a7700-cccc-4000-8000-000000000003", 1, "you", { since: NOW - 60_000 }), isFormSpot, NOW);
    const l = listVisitors(b, formRank);
    expect(l.total).toBe(3);
    expect(l.away).toBe(1);
    expect(l.visitors.map((v) => v.id)).toEqual([ID_B, ID_A, "0c4a7700-cccc-4000-8000-000000000003"]);
  });
});

describe("form places", () => {
  const page = { loaded: true, found: true, success: false, full: false, closed: false, step: "events" as const };
  it("is the step while the form shows, nothing while loading or not found", () => {
    expect(formSpot(page)).toBe("events");
    expect(formSpot({ ...page, loaded: false })).toBeNull();
    expect(formSpot({ ...page, found: false })).toBeNull();
  });
  it("names the page shown instead of the form, success first", () => {
    expect(formSpot({ ...page, success: true, full: true })).toBe("done");
    expect(formSpot({ ...page, full: true, closed: true })).toBe("full");
    expect(formSpot({ ...page, closed: true })).toBe("closed");
  });
  it("knows its places and ranks payment first", () => {
    expect(isFormSpot("pay")).toBe(true);
    expect(isFormSpot("toString")).toBe(false);
    expect(formRank("pay")).toBeLessThan(formRank("you"));
    expect(formTopic("t-1")).toBe("reg-form:t-1");
  });
});

describe("website places", () => {
  it("takes plain page paths only", () => {
    for (const ok of ["/", "/register", "/guides/badminton-abbotsford"]) expect(isSitePath(ok)).toBe(true);
    for (const bad of ["", "register", "/Register", "/faq?x=1", "/faq#a", "javascript:alert(1)", "/" + "a".repeat(81)]) expect(isSitePath(bad)).toBe(false);
  });
  it("names pages the way the site does", () => {
    expect(sitePageLabel("/")).toBe("Home");
    expect(sitePageLabel("/categories")).toBe("Events");
    expect(sitePageLabel("/guides/badminton-serve-rules")).toBe("Guide");
    expect(sitePageLabel("/new-page")).toBe("/new-page");
    expect(siteRank("/register")).toBeLessThan(siteRank("/"));
  });
  it("Shuttle Storm '26 has its website", () => {
    expect(TOURNAMENT_SITE["e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb"]).toEqual({ topic: "site:shuttlestorm" });
  });
});

describe("timeOnPage", () => {
  it("reads like a person would say it", () => {
    expect(timeOnPage(NOW - 20_000, NOW)).toBe("just opened");
    expect(timeOnPage(NOW - 4 * 60_000, NOW)).toBe("4 min");
    expect(timeOnPage(NOW - 60 * 60_000, NOW)).toBe("1 h");
    expect(timeOnPage(NOW - 65 * 60_000, NOW)).toBe("1 h 5 min");
    expect(timeOnPage(NOW + 5_000, NOW)).toBe("just opened");
  });
});
