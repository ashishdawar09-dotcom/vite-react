import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  BRIEFING_KINDS, briefingRecipients, courtCallKey, defaultMorningSendAt, deliveryFromEvent, playerPlan, scheduleWindow, signSvix,
  verifySvix, WEBHOOK_EVENTS,
} from "./raceday.ts";
import { buildBody } from "./mailer.ts";
import { type BriefingData, type FullHouseData, fullHouseEmail, playerBriefing } from "./emails.ts";

Deno.test("court call key: same allocation same key, new allocation new key", () => {
  const a = courtCallKey("m1", 3, "2026-11-21T17:00:00Z", "p1");
  assertEquals(a, courtCallKey("m1", 3, "2026-11-21T17:00:00Z", "p1"));
  assert(a !== courtCallKey("m1", 3, "2026-11-21T17:20:00Z", "p1"));
  assert(a !== courtCallKey("m1", 4, "2026-11-21T17:00:00Z", "p1"));
  assert(a !== courtCallKey("m1", 3, "2026-11-21T17:00:00Z", "p2"));
  assert(courtCallKey("m1", 3, null, "p1").length <= 256);
});

Deno.test("delivery events map to statuses with their reasons", () => {
  const ev = (type: string, extra: Record<string, unknown> = {}) => ({
    type, created_at: "2026-11-21T17:00:01.000Z", data: { email_id: "e-1", to: ["a@b.co"], tags: { app: "badminton" }, ...extra },
  });
  assertEquals(deliveryFromEvent(ev("email.delivered")), { emailId: "e-1", status: "delivered", detail: null, at: "2026-11-21T17:00:01.000Z" });
  assertEquals(deliveryFromEvent(ev("email.bounced", { bounce: { message: "Mailbox full", type: "Permanent", subType: "General" } }))?.detail, "Mailbox full");
  assertEquals(deliveryFromEvent(ev("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed" } }))?.detail, "Permanent / Suppressed");
  assertEquals(deliveryFromEvent(ev("email.failed", { failed: { reason: "reached_daily_quota" } }))?.detail, "reached_daily_quota");
  assertEquals(deliveryFromEvent(ev("email.suppressed", { suppressed: { message: "On the suppression list", type: "OnAccountSuppressionList" } }))?.status, "suppressed");
  assertEquals(deliveryFromEvent(ev("email.complained"))?.status, "complained");
  assertEquals(deliveryFromEvent(ev("email.delivery_delayed"))?.status, "delivery_delayed");
  // Ignored: engagement and other events, missing ids, junk.
  assertEquals(deliveryFromEvent(ev("email.opened")), null);
  assertEquals(deliveryFromEvent(ev("email.sent")), null);
  assertEquals(deliveryFromEvent({ type: "email.delivered", data: {} }), null);
  assertEquals(deliveryFromEvent("nope"), null);
  assertEquals(deliveryFromEvent(null), null);
  assertEquals(WEBHOOK_EVENTS.length, 6);
});

Deno.test("svix signatures: valid, tampered, stale and rotated", async () => {
  const secret = "whsec_" + btoa("0123456789abcdef0123456789abcdef");
  const body = '{"type":"email.delivered","data":{"email_id":"e-1"}}';
  const now = 1_763_744_400_000;
  const ts = String(now / 1000);
  const sig = await signSvix(secret, "msg_1", ts, body);
  assert(sig);
  const h = (signature: string, timestamp = ts, id = "msg_1") => ({ id, timestamp, signature });
  assert(await verifySvix(secret, h(`v1,${sig}`), body, now));
  // Several signatures (secret rotation): any match passes.
  assert(await verifySvix(secret, h(`v1,AAAA v1,${sig}`), body, now));
  assert(!(await verifySvix(secret, h(`v1,${sig}`), body + " ", now)));
  assert(!(await verifySvix(secret, h(`v1,${sig}`, ts, "msg_2"), body, now)));
  assert(!(await verifySvix(secret, h(`v2,${sig}`), body, now)));
  assert(!(await verifySvix(secret, h(`v1,${sig}`), body, now + 6 * 60_000)));
  assert(!(await verifySvix("", h(`v1,${sig}`), body, now)));
  assert(!(await verifySvix(secret, { id: null, timestamp: ts, signature: `v1,${sig}` }, body, now)));
  assert(!(await verifySvix(secret, h(`v1,${sig}`, "12.5"), body, now)));
  // Known vector from Svix's docs format: the same inputs always give the same signature.
  assertEquals(await signSvix(secret, "msg_1", ts, body), sig);
});

Deno.test("briefing recipients: active players with real addresses, in name order", () => {
  const r = briefingRecipients([
    { id: "3", name: " Zoe K ", email: "zoe@gmail.com", active: true },
    { id: "1", name: "Amar S", email: " amar@yahoo.ca ", active: true },
    { id: "2", name: "Benched", email: "b@gmail.com", active: false },
    { id: "4", name: "No Mail", email: null, active: true },
    { id: "5", name: "Bad", email: "not-an-email", active: true },
    { id: "6", name: "Test", email: "admin@scratch.test", active: true },
  ]);
  assertEquals(r, [
    { id: "1", name: "Amar S", email: "amar@yahoo.ca" },
    { id: "3", name: "Zoe K", email: "zoe@gmail.com" },
  ]);
});

Deno.test("morning send time and the scheduling window", () => {
  assertEquals(defaultMorningSendAt("2026-11-21"), "2026-11-21T14:00:00.000Z"); // 7:00 am UTC-7
  assertEquals(defaultMorningSendAt(null), null);
  const now = Date.parse("2026-11-20T20:00:00Z");
  assertEquals(scheduleWindow("2026-11-21T14:00:00Z", now), { at: "2026-11-21T14:00:00.000Z", error: null });
  assertEquals(scheduleWindow(null, now), { at: null, error: null });
  assert(scheduleWindow("2026-11-20T19:59:00Z", now).error);
  assert(scheduleWindow("2026-11-20T20:00:30Z", now).error);
  assert(scheduleWindow("2027-01-20T20:00:00Z", now).error);
  assert(scheduleWindow("tomorrow", now).error);
});

Deno.test("player plan: events, partners and the first timed match", () => {
  const nameById = new Map([["p1", "Amar Singh"], ["p2", "Raj Gill"], ["p3", "Kim Lee"], ["p4", "Jo Park"], ["p5", "Ava B"]]);
  const categories = [{ id: "md", name: "Men's Doubles 35+" }, { id: "ms", name: "Men's Singles" }, { id: "xd", name: "Mixed Doubles 35+" }];
  const teams = [
    { id: "t1", category_id: "md", p1_id: "p2", p2_id: "p1" },
    { id: "t2", category_id: "md", p1_id: "p3", p2_id: "p4" },
    { id: "t3", category_id: "ms", p1_id: "p1", p2_id: null },
  ];
  const matches = [
    { id: "m1", category_id: "md", team_a_id: "t2", team_b_id: "t1", status: "pending", scheduled_at: "2026-11-21T18:12:00Z", court_number: 2 },
    { id: "m2", category_id: "ms", team_a_id: "t3", team_b_id: null, status: "pending", scheduled_at: "2026-11-21T19:00:00Z", court_number: null },
    { id: "m0", category_id: "md", team_a_id: "t1", team_b_id: "t2", status: "completed", scheduled_at: "2026-11-21T16:30:00Z", court_number: 1 },
  ];
  // Unpaired in Mixed: listed without a partner.
  const plan = playerPlan("p1", { categories, playerCategoryIds: ["xd", "md"], teams, matches, nameById });
  assertEquals(plan.entries, [
    { category: "Men's Doubles 35+", partner: "Raj Gill" },
    { category: "Men's Singles", partner: null },
    { category: "Mixed Doubles 35+", partner: null },
  ]);
  assertEquals(plan.firstMatch, { at: "2026-11-21T18:12:00.000Z", category: "Men's Doubles 35+", court: 2, opponent: "Kim Lee & Jo Park" });
  // Nobody timed: no first match promised.
  assertEquals(playerPlan("p5", { categories, playerCategoryIds: [], teams, matches, nameById }), { entries: [], firstMatch: null });
});

Deno.test("mailer body: plain sends unchanged, options only when given", () => {
  const mail = { to: "a@b.co", subject: "S", html: "<p>H</p>", text: "H", fromName: "Shuttle Storm", replyTo: "d@x.co" };
  assertEquals(JSON.parse(buildBody(mail)), {
    from: "Shuttle Storm <no-reply@adawar.org>", to: ["a@b.co"], subject: "S", html: "<p>H</p>", text: "H", reply_to: "d@x.co",
  });
  const b = JSON.parse(buildBody(mail, {
    from: "Tournament <notify@adawar.org>", scheduledAt: "2026-11-21T14:00:00.000Z",
    tags: [{ name: "kind", value: "briefing day/before" }],
  }));
  assertEquals(b.from, "Tournament <notify@adawar.org>");
  assertEquals(b.scheduled_at, "2026-11-21T14:00:00.000Z");
  assertEquals(b.tags, [{ name: "kind", value: "briefing_day_before" }]);
});

const T = {
  name: "Shuttle Storm Abbotsford 2026", event_date: "2026-11-21", event_time: "09:30:00",
  venue_name: "UFV Athletic Centre – North Gym", venue_address: "Building E, Room 105", venue_map_url: "https://maps.app.goo.gl/x",
  rules_url: "https://shuttlestorm.adawar.org/rules", waiver_url: null, contact_info: "Ashish · 778 964 6999",
};
const brief = (over: Partial<BriefingData> = {}): BriefingData => ({
  tournament: T, kind: "day_before", player: { name: "Amar Singh" },
  entries: [{ category: "Men's Doubles 35+", partner: "Raj <Gill>" }, { category: "Men's Singles", partner: null }],
  firstMatch: null, notes: null, liveUrl: "https://badminton.adawar.org/t/shuttle-storm",
  profileUrl: "https://badminton.adawar.org/p/abc", assetBase: "https://shuttlestorm.adawar.org/email", ...over,
});

Deno.test("briefing email: day before, no times set", () => {
  const e = playerBriefing(brief());
  assertEquals(e.subject, "Tomorrow: your plan for Shuttle Storm Abbotsford 2026");
  assertStringIncludes(e.html, "See you tomorrow, Amar.");
  assertStringIncludes(e.html, "Raj &lt;Gill&gt;"); // escaped
  assert(!e.html.includes("Raj <Gill>"));
  assertStringIncludes(e.html, "Watch the live page");
  assertStringIncludes(e.html, "https://badminton.adawar.org/t/shuttle-storm");
  assertStringIncludes(e.html, "https://badminton.adawar.org/p/abc");
  assertStringIncludes(e.html, "9:30 am");
  assertStringIncludes(e.text, "Your events: Men's Doubles 35+ with Raj <Gill>\n  Men's Singles");
  assertStringIncludes(e.text, "Your matches: https://badminton.adawar.org/p/abc");
  assertStringIncludes(e.text, "Reply to this email");
});

Deno.test("briefing email: morning of, with a timed first match and directors' notes", () => {
  const e = playerBriefing(brief({
    kind: "morning_of",
    firstMatch: { at: "2026-11-21T17:12:00.000Z", category: "Men's Doubles 35+", court: 2, opponent: "Kim & Jo" },
    notes: "Park in Lot B.\nLunch <free> at noon.",
  }));
  assertEquals(e.subject, "Today: Shuttle Storm Abbotsford 2026 starts at 9:30 am");
  assertStringIncludes(e.html, "Game day, Amar.");
  assertStringIncludes(e.html, "About 10:12 am"); // 17:12Z at UTC-7
  assertStringIncludes(e.html, "Court 2");
  assertStringIncludes(e.html, "Park in Lot B.<br>Lunch &lt;free&gt; at noon.");
  assertStringIncludes(e.text, "First match: About 10:12 am · Men's Doubles 35+ · Court 2\n  vs Kim & Jo");
  assertStringIncludes(e.text, "From the directors: Park in Lot B.\n  Lunch <free> at noon.");
});

Deno.test("svix signatures: Svix's published test vector", async () => {
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const body = '{"test": 2432232314}';
  assertEquals(await signSvix(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", "1614265330", body), "g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  assert(await verifySvix(secret, {
    id: "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp: "1614265330", signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  }, body, 1614265330_000));
});

Deno.test("briefing email: uses the neutral event banner, not the 'You're in' one", () => {
  const e = playerBriefing(brief());
  assertStringIncludes(e.html, "/email/hero.gif");
  assert(!e.html.includes("approved.gif"));
});

const full = (over: Partial<FullHouseData> = {}): FullHouseData => ({
  tournament: T, player: { name: "Amar Singh" },
  entries: [{ category: "Men's Doubles 35+", partner: "Raj <Gill>" }, { category: "Men's Singles", partner: null }],
  cap: 150, notes: null, waitlistUrl: "https://badminton.adawar.org/register/e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb",
  appAssetBase: "https://badminton.adawar.org/email/", assetBase: "https://shuttlestorm.adawar.org/email", ...over,
});

Deno.test("full-house email: thanks them by name, with the FULL HOUSE animation and the waitlist", () => {
  assert(BRIEFING_KINDS.includes("full_house"));
  const e = fullHouseEmail(full());
  assertEquals(e.subject, "It's a full house! Thank you, Amar");
  assertStringIncludes(e.html, "Thank you, Amar.<br>We're at");
  assertStringIncludes(e.html, "full capacity.");
  assertStringIncludes(e.html, "Full house · 150/150");
  assertStringIncludes(e.html, "all 150 entries are taken and the entry form is now closed");
  // Hero and waitlist bar from the app (one slash), step GIFs from the website.
  assertStringIncludes(e.html, 'src="https://badminton.adawar.org/email/full-house.gif"');
  assertStringIncludes(e.html, 'src="https://badminton.adawar.org/email/full-house-waitlist.gif"');
  assertStringIncludes(e.html, 'src="https://shuttlestorm.adawar.org/email/step-received.gif"');
  assertStringIncludes(e.html, 'src="https://shuttlestorm.adawar.org/email/step-draw.gif"');
  assert(!e.html.includes("approved.gif"));
  assertStringIncludes(e.html, 'href="https://badminton.adawar.org/register/e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb"');
  assertStringIncludes(e.html, "Join the waitlist");
  assertStringIncludes(e.html, "Partner not entered yet?");
  assertStringIncludes(e.html, "Raj &lt;Gill&gt;"); // escaped
  assert(!e.html.includes("Raj <Gill>"));
  assertStringIncludes(e.html, "150 of 150 taken");
  assertStringIncludes(e.text, "Hi Amar,");
  assertStringIncludes(e.text, "Your events: Men's Doubles 35+ with Raj <Gill>\n  Men's Singles");
  assertStringIncludes(e.text, "Event day: Saturday, November 21, 2026 · first serve 9:30 am");
  assertStringIncludes(e.text, "Join the waitlist: https://badminton.adawar.org/register/e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb");
  assertStringIncludes(e.text, "In the coming days");
});

Deno.test("full-house email: no cap, no events, directors' notes", () => {
  const e = fullHouseEmail(full({ cap: null, entries: [], notes: "Parking <free>.\nBring water." }));
  assertStringIncludes(e.html, "every entry is taken");
  assert(!e.html.includes("150"));
  assert(!e.html.includes("Your event"));
  assertStringIncludes(e.html, "Parking &lt;free&gt;.<br>Bring water.");
  assertStringIncludes(e.text, "From the directors: Parking <free>.\n  Bring water.");
});
