import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type InviteRow, pickInvitees } from "./whatsapp_invites.ts";

const LAUNCH = "2026-10-29T08:09:30Z";
let n = 0;
const row = (o: Partial<InviteRow>): InviteRow => ({
  id: `${String(++n).padStart(8, "0")}-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  status: "approved",
  submitted_at: "2026-10-20T10:00:00Z",
  player_name: "Priya Sharma",
  player_email: "priya@example.com",
  partner_name: null,
  partner_email: null,
  category: "Mixed Doubles",
  player_active: true,
  partner_active: null,
  ...o,
});

Deno.test("registrant and named partner each get their own code", () => {
  const r = row({ partner_name: "Jordan Lee", partner_email: "Jordan@Example.com", partner_active: true });
  const { invitees } = pickInvitees([r], new Set(), LAUNCH);
  assertEquals(invitees.map((i) => [i.name, i.email, i.role, i.code, i.other, i.otherInvited]), [
    ["Priya Sharma", "priya@example.com", "player", r.id.replace(/-/g, "").slice(0, 8).toUpperCase(), "Jordan Lee", true],
    ["Jordan Lee", "jordan@example.com", "partner", r.id.replace(/-/g, "").slice(-8).toUpperCase(), "Priya Sharma", false],
  ]);
});

Deno.test("a registrant only hears their partner is invited when the partner really is", () => {
  const noEmail = row({ partner_name: "Jordan Lee", partner_email: null });
  const optedIn = row({ player_name: "Mei Chen", player_email: "mei@example.com", partner_name: "Raj Patel", partner_email: "raj@example.com" });
  const both = row({ player_name: "Ola Nowak", player_email: "ola@example.com", partner_name: "Kai Berg", partner_email: "kai@example.com" });
  const { invitees } = pickInvitees([noEmail, optedIn, both], new Set([`${optedIn.id}:partner`]), LAUNCH);
  const flag = (name: string) => invitees.find((i) => i.name === name)!.otherInvited;
  assertEquals([flag("Priya Sharma"), flag("Mei Chen"), flag("Ola Nowak")], [false, false, true]);
});

Deno.test("one email per person, listing every category", () => {
  const a = row({ category: "Mixed Doubles", submitted_at: "2026-10-21T10:00:00Z" });
  const b = row({ category: "Women's Singles", submitted_at: "2026-10-20T10:00:00Z" });
  const { invitees } = pickInvitees([a, b], new Set(), LAUNCH);
  assertEquals(invitees.length, 1);
  assertEquals(invitees[0].categories, ["Women's Singles", "Mixed Doubles"]);
  assertEquals(invitees[0].registration_id, b.id); // the older entry's code
});

Deno.test("a parent entering two children gets one email per child", () => {
  const kid1 = row({ player_name: "Aarav K", player_email: "parent@example.com", category: "Youth Boys' Singles" });
  const kid2 = row({ player_name: "Diya K", player_email: "parent@example.com", category: "Youth Girls' Singles" });
  const { invitees } = pickInvitees([kid1, kid2], new Set(), LAUNCH);
  assertEquals(invitees.map((i) => i.name), ["Aarav K", "Diya K"]);
});

Deno.test("approved entries win over pending ones for the code", () => {
  const pending = row({ status: "pending", submitted_at: "2026-10-19T10:00:00Z" });
  const approved = row({ status: "approved", submitted_at: "2026-10-22T10:00:00Z", category: "Women's Doubles" });
  const { invitees } = pickInvitees([pending, approved], new Set(), LAUNCH);
  assertEquals(invitees[0].registration_id, approved.id);
});

Deno.test("skips late entries, dead statuses, withdrawn players and missing emails", () => {
  const rows = [
    row({ submitted_at: "2026-10-29T09:00:00Z" }), // saw the button
    row({ status: "rejected", player_name: "R" }),
    row({ status: "payment_expired", player_name: "E" }),
    row({ player_name: "Gone", player_active: false }),
    row({ player_name: "No Mail", player_email: "not-an-email" }),
    row({ player_name: "Kept", player_email: "kept@example.com" }),
  ];
  const { invitees, skipped } = pickInvitees(rows, new Set(), LAUNCH);
  assertEquals(invitees.map((i) => i.name), ["Kept"]);
  assertEquals(skipped, { after_launch: 1, status: 2, withdrawn: 1, opted_in: 0, no_email: 1 });
});

Deno.test("someone who entered themselves and is also a partner gets their own entry's code", () => {
  const own = row({ player_name: "Jordan Lee", player_email: "jordan@example.com", category: "Men's Singles", submitted_at: "2026-10-22T10:00:00Z" });
  const named = row({ partner_name: "Jordan Lee", partner_email: "jordan@example.com", partner_active: true, submitted_at: "2026-10-20T10:00:00Z" });
  const { invitees } = pickInvitees([named, own], new Set(), LAUNCH);
  const jordan = invitees.find((i) => i.name === "Jordan Lee")!;
  assertEquals([jordan.role, jordan.registration_id], ["player", own.id]);
  assertEquals(jordan.categories.sort(), ["Men's Singles", "Mixed Doubles"]);
});

Deno.test("anyone who already opted in (or stopped) through any entry is left out", () => {
  const a = row({ category: "Mixed Doubles", partner_name: "Jordan Lee", partner_email: "jordan@example.com" });
  const b = row({ category: "Women's Singles" });
  const { invitees, skipped } = pickInvitees([a, b], new Set([`${b.id}:player`]), LAUNCH);
  assertEquals(invitees.map((i) => [i.name, i.role]), [["Jordan Lee", "partner"]]);
  assertEquals(skipped.opted_in, 1);
});

Deno.test("an opt-in or STOP through any entry counts, even one made after launch", () => {
  const before = row({ category: "Mixed Doubles", partner_name: "Jordan Lee", partner_email: "jordan@example.com" });
  const after = row({ category: "Women's Doubles", submitted_at: "2026-10-30T10:00:00Z" });
  const jordanOwn = row({ player_name: "Jordan Lee", player_email: "jordan@example.com", status: "rejected" });
  const { invitees, skipped } = pickInvitees([before, after, jordanOwn], new Set([`${after.id}:player`, `${jordanOwn.id}:player`]),
    LAUNCH, new Set([`${jordanOwn.id}:player`]));
  assertEquals(invitees.length, 0, "Priya opted in after launch; Jordan sent STOP on an entry since rejected");
  assertEquals(skipped.opted_in, 2);
  // An opt-in on a rejected entry that was never stopped no longer brings
  // updates, so that person is still asked.
  assertEquals(pickInvitees([before, jordanOwn], new Set([`${jordanOwn.id}:player`]), LAUNCH).invitees.map((i) => i.name),
    ["Priya Sharma", "Jordan Lee"]);
});

Deno.test("the same address and first name is one person, however the rest was typed", () => {
  const priyas = row({ partner_name: "Jordan K Lee", partner_email: "jordan@example.com", submitted_at: "2026-10-19T10:00:00Z" });
  const jordans = row({ player_name: "Jordan Lee", player_email: "Jordan@example.com", category: "Men's Singles" });
  const { invitees } = pickInvitees([priyas, jordans], new Set(), LAUNCH);
  const jordan = invitees.filter((i) => i.email === "jordan@example.com");
  assertEquals(jordan.map((i) => [i.role, i.registration_id, i.categories]), [["player", jordans.id, ["Men's Singles", "Mixed Doubles"]]]);
  assertEquals(jordan[0].key, "jordan@example.com|jordan");
});

Deno.test("a partner on an approved entry gets that code, not their own pending duplicate's", () => {
  const approved = row({ partner_name: "Jordan Lee", partner_email: "jordan@example.com", partner_active: true });
  const dup = row({ status: "pending", player_name: "Jordan Lee", player_email: "jordan@example.com", partner_name: "Priya Sharma",
    partner_email: "priya@example.com", submitted_at: "2026-10-19T10:00:00Z" });
  const jordan = pickInvitees([approved, dup], new Set(), LAUNCH).invitees.find((i) => i.name === "Jordan Lee")!;
  assertEquals([jordan.role, jordan.registration_id], ["partner", approved.id]);
});

Deno.test("the linked player record's name comes along for the dry run", () => {
  const kid2 = row({ player_name: "Diya K", player_email: "parent@example.com", player_record: "Aarav K" });
  assertEquals(pickInvitees([kid2], new Set(), LAUNCH).invitees[0].record_name, "Aarav K");
});
