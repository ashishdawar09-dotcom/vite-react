import { describe, expect, it } from "vitest";
import { isCancelledMatch, matchLoserId, resultLabel } from "../matchOutcome";

const base = { team_a_id: "A", team_b_id: "B", winner_id: null as string | null, confirmed: false, is_bye: false, is_walkover: false };
const mk = (o: Partial<typeof base>): typeof base => ({ ...base, ...o });

describe("isCancelledMatch", () => {
  it("is a confirmed match with no winner", () => {
    expect(isCancelledMatch(mk({ confirmed: true }))).toBe(true);
  });

  it("covers rows cancelled before the fix (is_walkover true, no winner)", () => {
    expect(isCancelledMatch(mk({ confirmed: true, is_walkover: true }))).toBe(true);
  });

  it("is not a real walkover, a played match, a bye or an unfinished match", () => {
    expect(isCancelledMatch(mk({ confirmed: true, is_walkover: true, winner_id: "A" }))).toBe(false);
    expect(isCancelledMatch(mk({ confirmed: true, winner_id: "B" }))).toBe(false);
    expect(isCancelledMatch(mk({ confirmed: true, is_bye: true }))).toBe(false);
    expect(isCancelledMatch(mk({}))).toBe(false);
  });
});

describe("matchLoserId", () => {
  it("is the other side of the winner", () => {
    expect(matchLoserId(mk({ confirmed: true, winner_id: "A" }))).toBe("B");
    expect(matchLoserId(mk({ confirmed: true, winner_id: "B" }))).toBe("A");
  });

  it("is nobody for a cancelled match (used to be team A)", () => {
    expect(matchLoserId(mk({ confirmed: true }))).toBeNull();
    expect(matchLoserId(mk({ confirmed: true, is_walkover: true }))).toBeNull();
  });

  it("is nobody when the winner isn't one of the sides", () => {
    expect(matchLoserId(mk({ confirmed: true, winner_id: "Z" }))).toBeNull();
  });
});

describe("resultLabel", () => {
  it("labels cancelled matches Cancelled, never W/O", () => {
    expect(resultLabel(mk({ confirmed: true, is_walkover: true }))).toBe("Cancelled");
    expect(resultLabel(mk({ confirmed: true }))).toBe("Cancelled");
  });

  it("keeps W/O for a real walkover", () => {
    expect(resultLabel(mk({ confirmed: true, is_walkover: true, winner_id: "A" }))).toBe("W/O");
  });

  it("is empty for a normal result", () => {
    expect(resultLabel(mk({ confirmed: true, winner_id: "A" }))).toBeNull();
  });
});
