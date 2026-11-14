import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { prettyPhone, WAITLIST_CLOSED, waitlistAlert } from "./waitlist.ts";

Deno.test("prettyPhone spaces a 10-digit number and leaves others alone", () => {
  assertEquals(prettyPhone("7789646999"), "778 964 6999");
  assertEquals(prettyPhone("917789646999"), "917789646999");
});

Deno.test("waitlistAlert names the person, their contacts and the list size", () => {
  const m = waitlistAlert({ tournament: "Shuttle Storm Abbotsford 2026", name: "Jas Gill", email: "jas@example.com", phone: "6045550123", position: 3 });
  assertEquals(m.subject, "Waitlist #3: Jas Gill wants a spot at Shuttle Storm Abbotsford 2026");
  assertStringIncludes(m.text, "Mobile: 604 555 0123");
  assertStringIncludes(m.text, "Email: jas@example.com");
  assertStringIncludes(m.text, "3 people are on the waitlist now.");
  assertStringIncludes(waitlistAlert({ tournament: "T", name: "A B", email: "a@b.co", phone: "6045550123", position: 1 }).text, "1 person is on the waitlist now.");
});

Deno.test("waitlistAlert escapes what people type", () => {
  const m = waitlistAlert({ tournament: "T", name: "<b>x</b>", email: "a@b.co", phone: "6045550123", position: 1 });
  assert(!m.html.includes("<b>x</b>"));
  assertStringIncludes(m.html, "&lt;b&gt;x&lt;/b&gt;");
});

Deno.test("waitlistAlert names the event when one was chosen", () => {
  const m = waitlistAlert({
    tournament: "Shuttle Storm Abbotsford 2026", name: "Jas Gill", email: "jas@example.com", phone: "6045550123",
    event: "Mixed Doubles 18–34", position: 4,
  });
  assertEquals(m.subject, "Waitlist #4: Jas Gill wants a spot in Mixed Doubles 18–34 at Shuttle Storm Abbotsford 2026");
  assertStringIncludes(m.text, "Event: Mixed Doubles 18–34");
  assert(!waitlistAlert({ tournament: "T", name: "A B", email: "a@b.co", phone: "6045550123", event: null, position: 1 }).text.includes("Event:"));
});

Deno.test("the closed-waitlist answer says sorry and fully booked, and promises nothing", () => {
  assertStringIncludes(WAITLIST_CLOSED, "really sorry");
  assertStringIncludes(WAITLIST_CLOSED, "fully booked");
  assert(!/spot opens|contact you/i.test(WAITLIST_CLOSED));
});
