import { describe, expect, it } from "vitest";
import { hintAllowedOn } from "../iosInstallHintPaths";

describe("hintAllowedOn", () => {
  it("never shows on the player forms, whose button bar it would cover", () => {
    expect(hintAllowedOn("/register/e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb")).toBe(false);
    expect(hintAllowedOn("/waiver/151d6987-1d40-47b5-98b7-492183878c2b")).toBe(false);
    expect(hintAllowedOn("/photo/3f1c2b9e-6d7a-4c1e-9b2a-1f0e5d4c3b2a")).toBe(false);
    expect(hintAllowedOn("/photo/preview")).toBe(false);
  });
  it("still shows in the app", () => {
    expect(hintAllowedOn("/")).toBe(true);
    expect(hintAllowedOn("/t/shuttle-storm")).toBe(true);
    expect(hintAllowedOn("/registrations")).toBe(true);
  });
});
