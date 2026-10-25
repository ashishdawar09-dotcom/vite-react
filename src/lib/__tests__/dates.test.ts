import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDate, localToday, parseLocalDate } from "../dates";

// Pin a negative-offset zone so the UTC-midnight bug would show up here.
beforeEach(() => { vi.stubEnv("TZ", "America/Vancouver"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("parseLocalDate", () => {
  it("keeps the calendar day in Pacific time", () => {
    const d = parseLocalDate("2026-11-21")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getDay()]).toEqual([2026, 10, 21, 6]);
  });

  it("returns null for empty or malformed input", () => {
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
    expect(parseLocalDate("")).toBeNull();
    expect(parseLocalDate("Nov 21")).toBeNull();
  });
});

describe("formatLocalDate", () => {
  it("shows Saturday 21 Nov, not Friday 20 Nov", () => {
    expect(new Date("2026-11-21").getDate()).toBe(20); // the bug this guards against
    expect(formatLocalDate("2026-11-21", { weekday: "short", month: "short", day: "numeric" }, "en-GB")).toBe("Sat 21 Nov");
    expect(formatLocalDate("2026-11-21", { weekday: "long", year: "numeric", month: "long", day: "numeric" }, "en-US"))
      .toBe("Saturday, November 21, 2026");
  });

  it("falls back to the raw string when it can't parse", () => {
    expect(formatLocalDate("TBD", { month: "short" })).toBe("TBD");
  });
});

describe("localToday", () => {
  it("uses the local day, not the UTC day, on a Pacific evening", () => {
    const eveningOfEvent = new Date("2026-11-22T02:30:00Z"); // 6:30 pm Nov 21 in Vancouver
    expect(eveningOfEvent.toISOString().slice(0, 10)).toBe("2026-11-22");
    expect(localToday(eveningOfEvent)).toBe("2026-11-21");
  });
});
