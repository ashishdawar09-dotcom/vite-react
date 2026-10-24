import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanAttribution, cleanHeardFrom } from "./attribution.ts";

Deno.test("heard_from accepts only listed answers", () => {
  assertEquals(cleanHeardFrom("google_search"), "google_search");
  assertEquals(cleanHeardFrom("Google"), null);
  assertEquals(cleanHeardFrom(42), null);
  assertEquals(cleanHeardFrom(undefined), null);
});

Deno.test("attribution keeps allowlisted keys and clips values", () => {
  const out = cleanAttribution({
    utm_source: " meta ",
    utm_campaign: "x".repeat(300),
    click_id: "meta",
    gclid: "secret",
    player_email: "a@b.c",
    referrer_host: "lm.facebook.com\n",
  });
  assertEquals(out, {
    utm_source: "meta",
    utm_campaign: "x".repeat(100),
    referrer_host: "lm.facebook.com",
    click_id: "meta",
  });
});

Deno.test("attribution rejects junk", () => {
  assertEquals(cleanAttribution(null), null);
  assertEquals(cleanAttribution("utm_source=meta"), null);
  assertEquals(cleanAttribution([1, 2]), null);
  assertEquals(cleanAttribution({ click_id: "tiktok", utm_source: 5 }), null);
});
