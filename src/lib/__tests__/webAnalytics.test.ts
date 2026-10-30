import { describe, expect, it } from "vitest";
import { webAnalyticsBeforeSend } from "../webAnalytics";

const ORIGIN = "https://badminton.adawar.org";
const view = (path: string) => ({ type: "pageview" as const, url: ORIGIN + path });

describe("webAnalyticsBeforeSend", () => {
  it("counts the public pages unchanged", () => {
    for (const path of [
      "/register/e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb?utm_source=meta",
      "/t/shuttle-storm",
      "/t/shuttle-storm/results",
      "/t/shuttle-storm/tv",
      "/p/2f85e0a8-45ea-434a-9f22-23da48861343",
    ]) {
      expect(webAnalyticsBeforeSend(view(path))).toEqual(view(path));
    }
  });

  it("blanks the waiver token", () => {
    const sent = webAnalyticsBeforeSend(view("/waiver/151d6987-1d40-47b5-98b7-492183878c2b"));
    expect(sent?.url).toBe(`${ORIGIN}/waiver/[token]`);
  });

  it("skips the admin app and the payments page", () => {
    for (const path of ["/", "/?tab=players", "/payments", "/registered", "/tv"]) {
      expect(webAnalyticsBeforeSend(view(path))).toBeNull();
    }
  });

  it("skips an event whose URL can't be read", () => {
    expect(webAnalyticsBeforeSend({ type: "pageview", url: "not a url" })).toBeNull();
  });
});
