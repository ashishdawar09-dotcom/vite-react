import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { approvalRecipients } from "./approval_recipients.ts";

const ben = { player_email: "Ben@x.com", partner_email: "ana@x.com" };

Deno.test("a new team emails both players", () => {
  assertEquals(approvalRecipients(ben, []), { player: true, partner: true });
});

Deno.test("the pair's second entry emails nobody once the first entry's email went to both", () => {
  const ana = { player_email: "ANA@x.com", partner_email: "ben@x.com ", approval_email_status: "sent" };
  assertEquals(approvalRecipients(ben, [ana]), { player: false, partner: false });
});

Deno.test("a failed or unfinished email on the other entry doesn't skip anyone", () => {
  for (const status of ["failed: partner failed: 500", "sending", null]) {
    const ana = { player_email: "ana@x.com", partner_email: "ben@x.com", approval_email_status: status };
    assertEquals(approvalRecipients(ben, [ana]), { player: true, partner: true });
  }
});

Deno.test("only the person not yet emailed gets one", () => {
  // The director paired them by hand and approved Ana's solo entry first.
  const anaSolo = { player_email: "ana@x.com", partner_email: null, approval_email_status: "sent" };
  assertEquals(approvalRecipients(ben, [anaSolo]), { player: true, partner: false });
});

Deno.test("a solo entry has no partner copy", () => {
  assertEquals(approvalRecipients({ player_email: "sam@x.com", partner_email: null }, []), { player: true, partner: false });
});
