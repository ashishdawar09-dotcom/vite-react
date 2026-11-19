// Run: npx -y deno test supabase/functions/volunteer-desk-admin/
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isDeskKey } from "../volunteer-desk/desk.ts";
import { checkInvite, checkWindow, cleanEmail, cleanName, copyLink, emailLink, inviteEmail, newKey, parseTime, windowText } from "./invite.ts";

const NOW = new Date("2026-11-16T02:00:00Z");
const FROM = "2026-11-21T07:00:00-07:00";
const UNTIL = "2026-11-21T22:00:00-07:00";

Deno.test("names are tidied and bounded", () => {
  assertEquals(cleanName("  Priya   Sharma "), "Priya Sharma");
  assertEquals(cleanName("Sam\n\tLee"), "Sam Lee");
  assertEquals(cleanName(""), null);
  assertEquals(cleanName("   "), null);
  assertEquals(cleanName("x".repeat(61)), null);
  assertEquals(cleanName("x".repeat(60)), "x".repeat(60));
  assertEquals(cleanName(42), null);
  assertEquals(cleanName(null), null);
});

Deno.test("emails are lowercased and checked", () => {
  assertEquals(cleanEmail("  Priya@Example.COM "), "priya@example.com");
  for (const bad of ["priya", "priya@", "@example.com", "priya@example", "a b@example.com", "a@b@c.com", "", null, 5, `${"a".repeat(250)}@x.co`]) {
    assertEquals(cleanEmail(bad), null);
  }
});

Deno.test("a time needs a date, a time and an offset", () => {
  assert(parseTime(FROM));
  assert(parseTime("2026-11-21T14:00:00Z"));
  assert(parseTime("2026-11-21T14:00:00.000Z"));
  for (const bad of ["2026-11-21", "2026-11-21T07:00:00", "tomorrow", "", null, 1795000000000, "2026-13-45T07:00:00Z"]) assertEquals(parseTime(bad), null);
});

Deno.test("the hours must run forwards, end in the future and last 3 days at most", () => {
  assertEquals(checkWindow(FROM, UNTIL, NOW), { from: "2026-11-21T14:00:00.000Z", until: "2026-11-22T05:00:00.000Z" });
  assert("error" in checkWindow(UNTIL, FROM, NOW));
  assert("error" in checkWindow(FROM, FROM, NOW));
  assert("error" in checkWindow("2026-11-01T07:00:00-07:00", "2026-11-01T22:00:00-07:00", NOW)); // already over
  assert("error" in checkWindow(FROM, "2026-11-25T22:00:00-07:00", NOW)); // 4 days
  assert("error" in checkWindow(null, UNTIL, NOW));
  // a link that has started but not ended is fine (changing hours on the day)
  assert(!("error" in checkWindow("2026-11-15T07:00:00-07:00", "2026-11-16T22:00:00-07:00", NOW)));
});

Deno.test("an invite is checked as a whole", () => {
  assertEquals(checkInvite({ name: " Priya ", email: "PRIYA@example.com", valid_from: FROM, valid_until: UNTIL }, NOW), {
    name: "Priya", email: "priya@example.com", valid_from: "2026-11-21T14:00:00.000Z", valid_until: "2026-11-22T05:00:00.000Z",
  });
  assert("error" in checkInvite({ name: "", email: "p@example.com", valid_from: FROM, valid_until: UNTIL }, NOW));
  assert("error" in checkInvite({ name: "Priya", email: "nope", valid_from: FROM, valid_until: UNTIL }, NOW));
  assert("error" in checkInvite({ name: "Priya", email: "p@example.com", valid_from: UNTIL, valid_until: FROM }, NOW));
});

Deno.test("new keys are desk keys and never repeat", () => {
  const keys = new Set(Array.from({ length: 200 }, newKey));
  assertEquals(keys.size, 200);
  for (const k of keys) assert(isDeskKey(k), k);
});

Deno.test("the emailed link carries the key in the query, the copied one after the #", () => {
  const k = "A".repeat(43);
  assertEquals(emailLink("https://desk.adawar.org", k), `https://desk.adawar.org/?k=${k}`);
  assertEquals(emailLink("https://desk.adawar.org/", k), `https://desk.adawar.org/?k=${k}`);
  assertEquals(copyLink("https://desk.adawar.org", k), `https://desk.adawar.org/#k=${k}`);
});

Deno.test("hours read in BC time (UTC-7 all year)", () => {
  assertEquals(windowText("2026-11-21T14:00:00.000Z", "2026-11-22T05:00:00.000Z"), "Saturday, November 21, 7:00 am to 10:00 pm");
  assertEquals(windowText("2026-11-21T14:30:00.000Z", "2026-11-22T08:00:00.000Z"), "Saturday, November 21, 7:30 am to Sunday, November 22, 1:00 am");
});

Deno.test("the invite email has the link, the hours and the three steps, in both forms", () => {
  const link = `https://desk.adawar.org/?k=${"B".repeat(43)}`;
  const m = inviteEmail({ name: "Priya Sharma", tournament: "Shuttle Storm", link, valid_from: "2026-11-21T14:00:00.000Z", valid_until: "2026-11-22T05:00:00.000Z", again: false });
  assertEquals(m.subject, "Your check-in desk link for Shuttle Storm");
  for (const body of [m.html, m.text]) {
    assert(body.includes(link));
    assert(body.includes("Hi Priya"));
    assert(body.includes("Saturday, November 21, 7:00 am to 10:00 pm"));
    assert(body.includes("Tap Check in") && body.includes("Tap Take photo") && body.includes("Find the player"));
    assert(body.includes("under 19"));
    assert(!body.includes("replaces the one"));
  }
  assertEquals((m.html.match(/href="/g) ?? []).length, 1); // one link only: the desk
});

Deno.test("a second send says the old link is dead", () => {
  const m = inviteEmail({ name: "Priya", tournament: "Shuttle Storm", link: "https://desk.adawar.org/?k=x", valid_from: "2026-11-21T14:00:00.000Z", valid_until: "2026-11-22T05:00:00.000Z", again: true });
  assertEquals(m.subject, "Your new check-in desk link for Shuttle Storm");
  assert(m.html.includes("The old one no longer works.") && m.text.includes("The old one no longer works."));
});

Deno.test("names and tournament names can't inject HTML into the email", () => {
  const m = inviteEmail({ name: '<img src=x onerror=1>"', tournament: "<b>Cup</b> & Co", link: "https://desk.adawar.org/?k=x", valid_from: "2026-11-21T14:00:00.000Z", valid_until: "2026-11-22T05:00:00.000Z", again: false });
  assert(!m.html.includes("<img") && !m.html.includes("<b>Cup"));
  assert(m.html.includes("&lt;b&gt;Cup&lt;/b&gt; &amp; Co"));
});
