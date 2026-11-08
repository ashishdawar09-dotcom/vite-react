import { describe, expect, it } from "vitest";
import { filmAllowed } from "./tvFilm";

describe("filmAllowed", () => {
  it("lets every TV play the film when it's switched on", () => {
    expect(filmAllowed("")).toBe(true);
    expect(filmAllowed("?design=floor")).toBe(true);
  });
  it("keeps it off on a TV whose link says ?film=0", () => {
    expect(filmAllowed("?film=0")).toBe(false);
    expect(filmAllowed("?design=sports&film=0")).toBe(false);
  });
});
