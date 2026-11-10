import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { photoInviteEmail, type PhotoInviteData } from "./emails.ts";
import { BRIEFING_KINDS } from "./raceday.ts";

const LINK = "https://badminton.adawar.org/photo/3f1c2b9e-6d7a-4c1e-9b2a-1f0e5d4c3b2a";
const data = (over: Partial<PhotoInviteData> = {}): PhotoInviteData => ({
  tournament: {
    name: "Shuttle Storm Abbotsford 2026",
    event_date: "2026-11-21",
    event_time: "09:00:00",
    venue_name: "UFV Athletic Centre – North Gym",
    venue_address: "1395 McKenzie Road, Abbotsford, BC",
    venue_map_url: "https://maps.app.goo.gl/x",
    rules_url: "https://shuttlestorm.adawar.org/rules",
    waiver_url: "https://shuttlestorm.adawar.org/waiver",
    contact_info: "Tournament directors",
  },
  player: { name: "Gurmeet Singh Ghera" },
  photoUrl: LINK,
  hasPhoto: false,
  appAssetBase: "https://badminton.adawar.org/email",
  assetBase: "https://shuttlestorm.adawar.org/email",
  privacyUrl: "https://shuttlestorm.adawar.org/privacy",
  ...over,
});

Deno.test("the photo invite is a briefing kind", () => {
  assert(BRIEFING_KINDS.includes("photo_invite"));
});

Deno.test("invites the player by first name, with their own link", () => {
  const e = photoInviteEmail(data());
  assertEquals(e.subject, "Gurmeet, add your photo to your Shuttle Storm Abbotsford 2026 player profile");
  assertStringIncludes(e.html, `href="${LINK}"`);
  assertStringIncludes(e.html, "Add my photo");
  assertStringIncludes(e.html, "https://badminton.adawar.org/email/photo-invite.jpg");
  assertStringIncludes(e.html, "Gurmeet Singh Ghera");
  assertStringIncludes(e.html, "hall TV");
  assertStringIncludes(e.html, "parent or guardian");
  assertStringIncludes(e.html, "November 21");
  assertStringIncludes(e.text, `Add my photo: ${LINK}`);
  assertStringIncludes(e.text, "Hi Gurmeet,");
});

Deno.test("a player who already has a photo is asked to check or change it", () => {
  const e = photoInviteEmail(data({ hasPhoto: true }));
  assertEquals(e.subject, "Gurmeet, check your photo for Shuttle Storm Abbotsford 2026");
  assertStringIncludes(e.html, "Change my photo");
  assertStringIncludes(e.html, "already has a photo");
});

Deno.test("escapes names and the directors' note, and keeps unsafe links out", () => {
  const e = photoInviteEmail(data({ player: { name: "Sam <b>Lee</b>" }, notes: "Bring <shoes>\nSee you there", photoUrl: "javascript:alert(1)" }));
  assert(!e.html.includes("<b>Lee</b>"));
  assertStringIncludes(e.html, "Sam &lt;b&gt;Lee&lt;/b&gt;");
  assertStringIncludes(e.html, "Bring &lt;shoes&gt;<br>See you there");
  assert(!e.html.includes("javascript:"));
  assert(!e.text.includes("javascript:"));
});
