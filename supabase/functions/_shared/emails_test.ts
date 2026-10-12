import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  addDays,
  adminNewEntry,
  buildIcs,
  calendarUrl,
  clockTime,
  type EmailData,
  longDate,
  registrationApproved,
  registrationReceived,
} from "./emails.ts";

const data = (over: Partial<EmailData> = {}): EmailData => ({
  tournament: {
    name: "Shuttle Storm Abbotsford 2026",
    event_date: "2026-11-21",
    event_time: "09:30:00",
    venue_name: "UFV Athletic Centre – North Gym",
    venue_address: "1395 McKenzie Road, Abbotsford, BC",
    venue_map_url: "https://maps.app.goo.gl/x",
    rules_url: "https://shuttlestorm.adawar.org/rules",
    waiver_url: "https://shuttlestorm.adawar.org/waiver",
    contact_info: "Tournament directors\nAshish · 778 000 0000",
  },
  category: { name: "Mixed Doubles", team_size: 2 },
  reg: {
    player_name: "Sam Lee",
    partner_name: "Ana Diaz",
    payment_method: "etransfer",
    payment_reference: "SL-123",
    amount_due_cents: 8000,
    payment_paid_full_for_partner: true,
  },
  role: "player",
  assetBase: "https://shuttlestorm.adawar.org/email",
  ...over,
});

Deno.test("dates and times read naturally, whatever the server zone", () => {
  assertEquals(longDate("2026-11-21"), "Saturday, November 21, 2026");
  assertEquals(longDate("2026-11-21", { year: false }), "Saturday, November 21");
  assertEquals(addDays("2026-11-01", -1), "2026-10-31");
  assertEquals(clockTime("09:30:00"), "9:30 am");
  assertEquals(clockTime("13:05"), "1:05 pm");
  assertEquals(clockTime(null), null);
});

Deno.test("player confirmation: names, payment, draw date and plain text", () => {
  const e = registrationReceived(data());
  assertEquals(e.subject, "We've got your registration: Shuttle Storm Abbotsford 2026");
  assertStringIncludes(e.html, "You're on the list, Sam.");
  assertStringIncludes(e.html, "Sam Lee &amp; Ana Diaz");
  assertStringIncludes(e.html, "$80.00 CAD · e-Transfer (ref SL-123)");
  assertStringIncludes(e.html, "Friday, November 20");
  assertStringIncludes(e.html, "https://shuttlestorm.adawar.org/email/hero.gif");
  assert(!/<[a-z]/i.test(e.text), "text part has no tags");
  assertStringIncludes(e.text, "Players: Sam Lee & Ana Diaz");
});

Deno.test("player data is escaped everywhere it appears", () => {
  const e = registrationReceived(data({
    reg: { ...data().reg, player_name: `<img src=x onerror=alert(1)> "Bo"`, payment_reference: "<b>x</b>" },
  }));
  assert(!e.html.includes("<img src=x"), "name is escaped");
  assert(!e.html.includes("<b>x</b>"), "reference is escaped");
  assertStringIncludes(e.html, "&lt;img src=x onerror=alert(1)&gt;");
});

Deno.test("partner copy carries the waiver link while it's needed", () => {
  const link = "https://badminton.adawar.org/waiver/11111111-2222-3333-4444-555555555555";
  const e = registrationReceived(data({ role: "partner", waiverLink: link }));
  assertEquals(e.subject, "Sam Lee entered you in Mixed Doubles: Shuttle Storm Abbotsford 2026");
  assertStringIncludes(e.html, "You're on the team, Ana.");
  assertStringIncludes(e.html, `href="${link}"`);
  assertStringIncludes(e.text, `Accept the waiver: ${link}`);
  const done = registrationReceived(data({ role: "partner", waiverLink: null }));
  assert(!done.html.includes("/waiver/1111"), "no link once accepted");
});

Deno.test("only http(s) links are used", () => {
  const e = registrationReceived(data({ role: "partner", waiverLink: "javascript:alert(1)" }));
  assert(!e.html.includes("javascript:"));
  const t = { ...data().tournament, venue_map_url: "javascript:alert(1)" };
  assert(!registrationApproved(data({ tournament: t })).html.includes("javascript:"));
});

Deno.test("approval email and calendar invite use Vancouver time", () => {
  const e = registrationApproved(data({ role: "partner" }));
  assertEquals(e.subject, "You're in! Mixed Doubles at Shuttle Storm Abbotsford 2026");
  assertStringIncludes(e.html, "You're in, Ana.");
  assertStringIncludes(e.html, "with Sam Lee");
  const cal = calendarUrl(data().tournament)!;
  assertStringIncludes(cal, "dates=20261121T093000%2F20261121T170000");
  assertStringIncludes(cal, "ctz=America%2FVancouver");
  const ics = buildIcs(data().tournament, "reg-1")!;
  assertStringIncludes(ics, "DTSTART;TZID=America/Vancouver:20261121T093000");
  assertStringIncludes(ics, "LOCATION:UFV Athletic Centre – North Gym\\, 1395 McKenzie Road\\, Abbotsford\\, BC");
  assert(ics.includes("\r\n"));
});

Deno.test("directors' alert: what to check, contact details, escaped", () => {
  const base = data();
  const e = adminNewEntry({
    tournament: base.tournament,
    category: base.category,
    reg: {
      ...base.reg,
      player_email: "sam@example.com", player_phone: "604 555 0100", player_age: 16, player_fee_type: "youth",
      partner_email: "ana@example.com", partner_phone: null, partner_age: 34, partner_fee_type: "standard",
      comments: "<script>x</script>", submitted_at: "2026-10-11T18:31:14Z",
    },
    waiverRequired: true, playerWaiver: true, partnerWaiver: false,
    adminUrl: "https://badminton.adawar.org",
  });
  assertEquals(e.subject, "New entry: Sam Lee & Ana Diaz · Mixed Doubles · e-Transfer to match");
  assertStringIncludes(e.html, "e-Transfer of <strong");
  assertStringIncludes(e.html, "SL-123");
  assertStringIncludes(e.html, "mailto:sam@example.com");
  assertStringIncludes(e.html, "age 16 · youth rate");
  assertStringIncludes(e.html, "Partner: Pending");
  assertStringIncludes(e.html, "Sun, Oct 11, 11:31 a.m.");
  assert(!e.html.includes("<script>"));
  assertStringIncludes(e.text, "Player: Sam Lee, sam@example.com, 604 555 0100, age 16 · youth rate");
});

Deno.test("e-Transfer confirmation gives the player nothing to do and no deadline", () => {
  const e = registrationReceived(data({ partnerWaiverPending: false }));
  assertStringIncludes(e.text, "There's nothing else you need to do");
  assert(!/make sure|48 hours|within \d/i.test(e.text), "no task or turnaround promise");
});

Deno.test("doubles entry without a partner is told about pairing", () => {
  const solo = data({ reg: { ...data().reg, partner_name: null, amount_due_cents: 4000 } });
  const e = registrationReceived(solo);
  assertStringIncludes(e.html, "To be paired");
  assertStringIncludes(e.html, "Partner pairings are posted by <strong");
  assertStringIncludes(e.text, "Thursday, November 19");
  assertStringIncludes(e.text, "Player: Sam Lee\n");
  const a = registrationApproved(solo);
  assertStringIncludes(a.text, "We'll pair you with another player if one is available; pairings are posted by Thursday, November 19.");
  assert(!registrationReceived(data()).html.includes("To be paired"));
});
