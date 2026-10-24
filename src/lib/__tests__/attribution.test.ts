import { describe, expect, it } from "vitest";
import { parseAttribution } from "../attribution";

const REG = "https://badminton.adawar.org/register/e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb";

describe("parseAttribution", () => {
  it("reads utm tags from a Meta ad link", () => {
    const a = parseAttribution(
      `${REG}?utm_source=meta&utm_medium=paid_social&utm_campaign=shuttlestorm26_cold&utm_content=poster&fbclid=IwAR123`,
      "https://lm.facebook.com/",
    );
    expect(a).toEqual({
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: "shuttlestorm26_cold",
      utm_content: "poster",
      click_id: "meta",
      referrer_host: "lm.facebook.com",
      landing_path: "/register/e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb",
    });
  });

  it("keeps only which ad network a click ID came from, never the ID", () => {
    const a = parseAttribution(`${REG}?gclid=Cj0KCQ-secret`, "");
    expect(a.click_id).toBe("google");
    expect(JSON.stringify(a)).not.toContain("secret");
  });

  it("accepts the click marker handed over by the Shuttle Storm site", () => {
    const a = parseAttribution(`${REG}?utm_source=google&utm_medium=cpc&click=google`, "https://shuttlestorm.adawar.org/");
    expect(a.utm_source).toBe("google");
    expect(a.click_id).toBe("google");
    expect(a.referrer_host).toBe("shuttlestorm.adawar.org");
  });

  it("ignores same-site referrers and clips long values", () => {
    const long = "x".repeat(500);
    const a = parseAttribution(`${REG}?utm_campaign=${long}`, `${REG}?step=2`);
    expect(a.referrer_host).toBeUndefined();
    expect(a.utm_campaign).toHaveLength(100);
  });

  it("returns an empty result for a bad URL", () => {
    expect(parseAttribution("not a url", "")).toEqual({});
  });
});
