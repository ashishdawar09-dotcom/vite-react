import { describe, expect, it } from "vitest";
import { dataUrlBytes, fitWithin, MAX_EDGE } from "./photoResize";

describe("shrinking a photo before upload", () => {
  it("keeps the shape and brings the long edge down to 1200", () => {
    expect(fitWithin(4032, 3024)).toEqual({ w: 1200, h: 900 });   // iPhone landscape
    expect(fitWithin(3024, 4032)).toEqual({ w: 900, h: 1200 });   // iPhone portrait
    expect(fitWithin(1536, 2048)).toEqual({ w: 900, h: 1200 });
    expect(Math.max(...Object.values(fitWithin(8000, 6000)))).toBe(MAX_EDGE);
  });
  it("never enlarges a small photo", () => {
    expect(fitWithin(640, 480)).toEqual({ w: 640, h: 480 });
    expect(fitWithin(1200, 1200)).toEqual({ w: 1200, h: 1200 });
  });
  it("treats an unreadable size as nothing to draw", () => {
    expect(fitWithin(0, 100)).toEqual({ w: 0, h: 0 });
    expect(fitWithin(NaN, 100)).toEqual({ w: 0, h: 0 });
  });
  it("counts the bytes a data URL holds", () => {
    expect(dataUrlBytes("data:image/jpeg;base64,AAAA")).toBe(3);
    expect(dataUrlBytes("data:image/jpeg;base64,AAA=")).toBe(2);
    expect(dataUrlBytes("data:image/jpeg;base64,AA==")).toBe(1);
    expect(dataUrlBytes("nonsense")).toBe(0);
  });
});
