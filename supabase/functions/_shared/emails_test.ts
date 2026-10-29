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
  adminRefusedRepeat,
  deadlineText,
  maskEmail,
  shareConfirmed,
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

// Sam paid their own share and named Ana, who hasn't paid hers yet.
const ownShare = (over: Partial<EmailData> = {}) => data({
  reg: { ...data().reg, player_email: "sam.lee@example.com", amount_due_cents: 4000, payment_paid_full_for_partner: false },
  registrationDeadline: "2026-11-19T07:59:00Z",
  registrationClosed: false,
  role: "partner",
  partnerShare: "due",
  registerUrl: "https://badminton.adawar.org/register/t1?category=c1",
  waiverLink: "https://badminton.adawar.org/waiver/abc",
  ...over,
});

Deno.test("partner who still owes their share is told how to pay it, with no amount", () => {
  const e = registrationReceived(ownShare());
  assertStringIncludes(e.html, "They paid their own share; yours is still to pay.");
  assertStringIncludes(e.html, "Pay your share");
  assertStringIncludes(e.html, "name <strong style=\"color:#ECEEF2\">Sam Lee</strong> as your partner");
  assertStringIncludes(e.html, "https://badminton.adawar.org/register/t1?category=c1");
  assertStringIncludes(e.text, "Sam's share: $40.00 CAD · e-Transfer (ref SL-123)");
  assertStringIncludes(e.text, "Your share: Not paid yet");
  assertStringIncludes(e.text, "Status: Waiting for your share");
  // The form they pay with has the waiver, so no separate waiver link.
  assert(!e.html.includes("/waiver/abc"), "no partner waiver link");
  assert(!e.text.includes("nothing else you need to do"), "doesn't say there's nothing to do");
  assert(!/Your share: \$/.test(e.text), "no amount for their share");
});

Deno.test("partner who already entered themselves has nothing to pay", () => {
  const e = registrationReceived(ownShare({ partnerShare: "entered", waiverLink: null }));
  assertStringIncludes(e.html, "Your own entry is in too, so there's nothing else to pay. We'll email you once a director confirms it.");
  assertStringIncludes(e.text, "Your share: On your own entry, waiting for a director");
  assert(!e.html.includes("Pay your share"));
});

Deno.test("partner whose own entry is already confirmed isn't told to wait or promised another email", () => {
  const e = registrationReceived(ownShare({ partnerShare: "confirmed", waiverLink: null }));
  assertStringIncludes(e.text, "1. You're all set");
  assertStringIncludes(e.text, "Your place is already confirmed, and Sam's share is in now too. There's nothing else to do.");
  assertStringIncludes(e.text, "Status: Confirmed");
  assertStringIncludes(e.text, "Your share: Paid · confirmed");
  assert(!e.text.includes("awaiting confirmation"));
  assert(!e.text.includes("You'll get"));
  const approved = registrationApproved(ownShare({ partnerShare: "confirmed" }));
  assert(!approved.text.includes("we'll email you"));
});

Deno.test("pay step gives the deadline and which email to use, without an amount", () => {
  const e = registrationReceived(ownShare());
  assertStringIncludes(e.text, "by Wednesday, November 18 at 11:59 pm");
  assertStringIncludes(e.text, "with the email address Sam registered with (s•••@example.com)");
  assert(!e.text.includes("sam.lee@example.com"), "full address isn't shown");
});

Deno.test("after registration closes, the pay step says to reply and carries the waiver link", () => {
  const e = registrationApproved(ownShare({ registrationClosed: true }));
  assertStringIncludes(e.text, "Registration has closed, so reply to this email and a director will arrange your share.");
  assertStringIncludes(e.text, "Accept the waiver: https://badminton.adawar.org/waiver/abc");
  assert(!e.html.includes("/register/t1"), "no link to the closed form");
  const noWaiver = registrationReceived(ownShare({ registrationClosed: true, waiverLink: null }));
  assert(!noWaiver.text.includes("Accept the waiver"));
});

Deno.test("a partner named on an entry that clashes gets neutral wording", () => {
  const e = registrationReceived(ownShare({ partnerShare: null, waiverLink: null }));
  assertStringIncludes(e.text, "Sam has entered you as their partner. If you weren't expecting this, just reply to this email.");
  assert(!e.text.includes("nothing else to pay"));
  assert(!e.html.includes("Pay your share"));
});

Deno.test("the other player's card payment isn't described as on the reader's statement", () => {
  const card = { ...data().reg, payment_method: "card", amount_due_cents: 4120, payment_paid_full_for_partner: false };
  const partner = registrationReceived(ownShare({ reg: card }));
  assertStringIncludes(partner.text, "Sam's share: $41.20 CAD · Paid by card");
  assert(!partner.text.includes("your statement"));
  const player = registrationReceived(data({ reg: card }));
  assertStringIncludes(player.text, "shows on your statement");
});

Deno.test("paid-for-both partner copy says there's nothing for them to pay", () => {
  const e = registrationReceived(data({ role: "partner", waiverLink: null }));
  assertStringIncludes(e.html, "Sam has submitted the entry for you both.");
  assertStringIncludes(e.text, "They paid for you both, so there's nothing for you to pay.");
  assertStringIncludes(e.text, "Payment: $80.00 CAD · e-Transfer (ref SL-123)");
  assertStringIncludes(e.text, "Your share: Paid by Sam");
  const withWaiver = registrationReceived(data({ role: "partner", waiverLink: "https://badminton.adawar.org/waiver/abc" }));
  assertStringIncludes(withWaiver.text, "nothing for you to pay");
  assertStringIncludes(withWaiver.html, "/waiver/abc");
});

Deno.test("approval tells a partner who owes their share that their place is held", () => {
  const e = registrationApproved(ownShare());
  assertEquals(e.subject, "One step left: pay your share for Mixed Doubles at Shuttle Storm Abbotsford 2026");
  assert(!e.html.includes("approved.gif"), "no big YOU'RE IN header");
  assert(!e.html.includes("You&#39;re in. "), "no You're in alt text");
  assertStringIncludes(e.html, "/email/hero.gif");
  assertStringIncludes(e.html, "One step left, Ana.");
  assertStringIncludes(e.html, "your place on the team is held. Your share isn't paid yet.");
  assertStringIncludes(e.text, "Status: Place held · waiting for your share");
  assertStringIncludes(e.text, "Pay your share: https://badminton.adawar.org/register/t1?category=c1");

  const entered = registrationApproved(ownShare({ partnerShare: "entered" }));
  assertEquals(entered.subject, "You're in! Mixed Doubles at Shuttle Storm Abbotsford 2026");
  assertStringIncludes(entered.html, "Your own entry is in too; we'll email you when your share is confirmed.");

  const player = registrationApproved(ownShare({ role: "player", partnerShare: null }));
  assertStringIncludes(player.html, "You're in, Sam.");
  assertStringIncludes(player.text, "Payment: $40.00 CAD");
});

Deno.test("second half of a pair gets a short share-paid email", () => {
  const e = shareConfirmed(data({
    reg: { ...data().reg, player_name: "Ana Diaz", partner_name: "Sam Lee", payment_method: "card", amount_due_cents: 4120, payment_paid_full_for_partner: false },
  }));
  assertEquals(e.subject, "Your share is paid: Mixed Doubles at Shuttle Storm Abbotsford 2026");
  assertStringIncludes(e.html, "You're all set, Ana.");
  assertStringIncludes(e.html, "You and Sam Lee are in, and there's nothing else to pay.");
  assertStringIncludes(e.text, "Payment: $41.20 CAD · Paid by card");
  assert(!/<[a-z]/i.test(e.text), "text part has no tags");
});

Deno.test("second half that paid for both is told one share will be refunded", () => {
  const e = shareConfirmed(data({ reg: { ...data().reg, player_name: "Ana Diaz", partner_name: "Sam Lee" } }));
  assertStringIncludes(e.text, "You paid for you both, but Sam had already paid their own share, so one share will be refunded to you.");
});

Deno.test("directors hear about a refused repeat entry, escaped", () => {
  const e = adminRefusedRepeat({
    category: { name: "Mixed <Doubles>" }, playerName: "Ana <b>Diaz</b>", playerEmail: "ana@x.com", paidBy: "Sam Lee", reference: "REF-9",
  });
  assertStringIncludes(e.subject, "Refused repeat entry: Ana <b>Diaz</b> · Mixed <Doubles>");
  assertStringIncludes(e.html, "Ana &lt;b&gt;Diaz&lt;/b&gt;");
  assert(!e.html.includes("<b>Diaz"));
  assertStringIncludes(e.text, "They gave e-Transfer reference REF-9. If that e-Transfer arrives, refund it.");
});

Deno.test("deadline and masked email helpers", () => {
  assertEquals(deadlineText("2026-11-19T07:59:00Z"), "Wednesday, November 18 at 11:59 pm");
  assertEquals(deadlineText(null), null);
  assertEquals(maskEmail("sam.lee@example.com"), "s•••@example.com");
  assertEquals(maskEmail("not an email"), null);
});
