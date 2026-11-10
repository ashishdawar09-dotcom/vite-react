import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { onDeckEmail, onDeckKey, onDeckPush, parseExpected, stageName, venueClock } from "./on_deck.ts";

const NOW = Date.parse("2026-11-21T17:30:00Z"); // 10:30 am at the venue

Deno.test("venue clock is UTC-7 all year, 12-hour", () => {
  assertEquals(venueClock(Date.parse("2026-11-21T16:00:00Z")), "9:00 am");
  assertEquals(venueClock(Date.parse("2026-11-21T19:05:00Z")), "12:05 pm");
  assertEquals(venueClock(Date.parse("2026-11-22T02:42:00Z")), "7:42 pm");
  assertEquals(venueClock(Date.parse("2026-11-21T07:00:00Z")), "12:00 am");
});

Deno.test("on-deck key: one per player per match", () => {
  assertEquals(onDeckKey("m1", "p1"), onDeckKey("m1", "p1"));
  assert(onDeckKey("m1", "p1") !== onDeckKey("m1", "p2"));
  assert(onDeckKey("m1", "p1") !== onDeckKey("m2", "p1"));
});

Deno.test("expected time: kept only when believable", () => {
  assertEquals(parseExpected("2026-11-21T17:40:00.000Z", NOW), Date.parse("2026-11-21T17:40:00Z"));
  assertEquals(parseExpected("2026-11-21T21:00:00Z", NOW), null); // 3.5 hours ahead
  assertEquals(parseExpected("2026-11-21T16:00:00Z", NOW), null); // 1.5 hours ago
  assertEquals(parseExpected("soon", NOW), null);
  assertEquals(parseExpected(12345, NOW), null);
});

Deno.test("stage names", () => {
  assertEquals(stageName({ stage: "group", group_idx: 1, round_idx: null, is_bronze: false }, null), "Group B");
  assertEquals(stageName({ stage: "knockout", group_idx: null, round_idx: 2, is_bronze: false }, 2), "Final");
  assertEquals(stageName({ stage: "knockout", group_idx: null, round_idx: 1, is_bronze: false }, 2), "Semi-final");
  assertEquals(stageName({ stage: "knockout", group_idx: null, round_idx: 0, is_bronze: false }, 2), "Quarter-final");
  assertEquals(stageName({ stage: "knockout", group_idx: null, round_idx: 0, is_bronze: false }, 3), "Round 1");
  assertEquals(stageName({ stage: "knockout", group_idx: null, round_idx: 2, is_bronze: true }, 2), "3rd place");
});

Deno.test("the email names the event, stage, opponent and the expected call, and escapes names", () => {
  const m = onDeckEmail({
    tournament: "Shuttle Storm '26", event: "Men's Singles", stage: "Group B", player: "Sam <b>", opponent: "Alex & Jo",
    expectedAt: Date.parse("2026-11-21T17:42:00Z"), replyTo: true,
  });
  assertStringIncludes(m.subject, "You're up soon");
  assertStringIncludes(m.subject, "Men's Singles");
  assertStringIncludes(m.text, "about 10:42 am");
  assertStringIncludes(m.text, "against Alex & Jo");
  assertStringIncludes(m.text, "Reply to this email");
  assertStringIncludes(m.html, "Sam &lt;b&gt;");
  assertStringIncludes(m.html, "Alex &amp; Jo");
  assert(!m.html.includes("<b>,"));
  const none = onDeckEmail({ tournament: "T", event: "E", stage: "Final", player: "P", opponent: "O", expectedAt: null, replyTo: false });
  assertStringIncludes(none.text, "in the next few minutes");
  assert(!none.text.includes("Reply to this email"));
});

Deno.test("the push is one short line", () => {
  const p = onDeckPush({ tournament: "T", event: "WD 35+", stage: "Final", player: "P", opponent: "A & B", expectedAt: Date.parse("2026-11-21T18:20:00Z"), replyTo: false });
  assertEquals(p.title, "🏸 You're up soon");
  assertEquals(p.body, "WD 35+ (Final) vs A & B: court call about 11:20 am. Stay close to the courts.");
});
