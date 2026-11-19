import { describe, expect, it } from "vitest";
import { firstTime, initialsOf, safePhotoUrl } from "../winnerPhoto";

const BASE = "https://proj.supabase.co";

describe("safePhotoUrl", () => {
  it("accepts a photo in this project's photo storage", () => {
    const url = `${BASE}/storage/v1/object/public/player-photos/winners/t/c/1.jpg`;
    expect(safePhotoUrl(url, BASE)).toBe(url);
    expect(safePhotoUrl(url, `${BASE}/`)).toBe(url);
  });
  it("refuses anything else", () => {
    expect(safePhotoUrl("https://evil.example/x.jpg", BASE)).toBeNull();
    expect(safePhotoUrl(`${BASE}.evil.example/storage/v1/object/public/player-photos/x.jpg`, BASE)).toBeNull();
    expect(safePhotoUrl(`${BASE}/storage/v1/object/public/other-bucket/x.jpg`, BASE)).toBeNull();
    expect(safePhotoUrl("javascript:alert(1)", BASE)).toBeNull();
    expect(safePhotoUrl(`data:image/png;base64,AAAA`, BASE)).toBeNull();
    expect(safePhotoUrl(null, BASE)).toBeNull();
    expect(safePhotoUrl(undefined, BASE)).toBeNull();
    expect(safePhotoUrl(42, BASE)).toBeNull();
  });
  it("shows nothing when the project address is unknown", () => {
    expect(safePhotoUrl("/storage/v1/object/public/player-photos/x.jpg", "")).toBeNull();
  });
});

describe("initialsOf", () => {
  it("uses the first and last name", () => {
    expect(initialsOf("Gurpreet Singh Gill")).toBe("GG");
    expect(initialsOf("  amy   adams ")).toBe("AA");
    expect(initialsOf("Balvir")).toBe("B");
    expect(initialsOf("Chloé Dubois")).toBe("CD");
  });
  it("is empty for an empty name", () => {
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });
});

describe("firstTime", () => {
  it("is true once per key, then false", () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    expect(firstTime("a", store)).toBe(true);
    expect(firstTime("a", store)).toBe(false);
    expect(firstTime("b", store)).toBe(true);
  });
  it("never throws when storage is blocked", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(firstTime("a", broken)).toBe(true);
  });
});
