import { describe, expect, it } from "vitest";
import { MAX_AGE_MS, clearCachedTournament, readCachedTournament, writeCachedTournament } from "../tournamentCache";
import type { Tournament } from "../../../types";

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

const row = { id: "t-1", name: "Shuttle Storm", slug: "shuttle-storm", num_courts: 4 } as unknown as Tournament;
const T0 = Date.UTC(2026, 10, 8);
const saved = (r: unknown, savedAt = T0) => JSON.stringify({ v: 1, saved_at: savedAt, row: r });

describe("spectator tournament cache", () => {
  it("gives back the row it saved for that slug", () => {
    const s = memoryStore();
    writeCachedTournament("shuttle-storm", row, s, T0);
    expect(readCachedTournament("shuttle-storm", s, T0 + 60_000)).toEqual(row);
  });

  it("has nothing for a slug it never saw", () => {
    expect(readCachedTournament("other", memoryStore(), T0)).toBeNull();
  });

  it("ignores a row saved under one slug but belonging to another", () => {
    const s = memoryStore();
    s.setItem("ss-spectator-tournament:other", saved(row));
    expect(readCachedTournament("other", s, T0)).toBeNull();
  });

  it("ignores a row older than two weeks (a slug reused for a later event)", () => {
    const s = memoryStore();
    writeCachedTournament("shuttle-storm", row, s, T0);
    expect(readCachedTournament("shuttle-storm", s, T0 + MAX_AGE_MS - 1)).toEqual(row);
    expect(readCachedTournament("shuttle-storm", s, T0 + MAX_AGE_MS + 1)).toBeNull();
  });

  it("ignores broken or incomplete entries", () => {
    const s = memoryStore();
    const bad = [
      "{not json", "null", "42",
      JSON.stringify(row), // a bare row, no envelope
      JSON.stringify({ v: 2, saved_at: T0, row }),
      JSON.stringify({ v: 1, row }),
      saved({ name: "x", slug: "a" }),
      saved({ id: 7, name: "x", slug: "a" }),
      saved({ id: "t", slug: "a" }),
      saved(null),
    ];
    for (const b of bad) {
      s.setItem("ss-spectator-tournament:a", b);
      expect(readCachedTournament("a", s, T0)).toBeNull();
    }
  });

  it("forgets a slug", () => {
    const s = memoryStore();
    writeCachedTournament("shuttle-storm", row, s, T0);
    clearCachedTournament("shuttle-storm", s);
    expect(readCachedTournament("shuttle-storm", s, T0)).toBeNull();
  });

  it("copes with storage that is missing or throws", () => {
    const throwing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(readCachedTournament("a", throwing, T0)).toBeNull();
    expect(() => writeCachedTournament("a", row, throwing, T0)).not.toThrow();
    expect(() => clearCachedTournament("a", throwing)).not.toThrow();
    expect(readCachedTournament("a", null, T0)).toBeNull();
    expect(() => writeCachedTournament("a", row, null, T0)).not.toThrow();
  });
});
