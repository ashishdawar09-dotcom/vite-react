import { assertEquals } from "jsr:@std/assert@1";
import { validateConsent, waiverSigner } from "./waiver.ts";

const t = { id: "t1", waiver_text: "Waiver", waiver_version: "v2" };
const ok = { accepted_rules: true, accepted_waiver: true, accepted_codes_of_conduct: true, waiver_version: "v2" };

Deno.test("consent needs all three acceptances and the current version", () => {
  assertEquals(validateConsent(undefined, t, "Sam Lee").ok, false);
  assertEquals(validateConsent({ ...ok, accepted_waiver: false, age: 30, signature: "Sam Lee" }, t, "Sam Lee").ok, false);
  const stale = validateConsent({ ...ok, waiver_version: "v1", age: 30, signature: "Sam Lee" }, t, "Sam Lee");
  assertEquals(stale.ok ? 0 : stale.status, 409);
});

Deno.test("adults sign their own name; under-19s need a guardian who signs", () => {
  assertEquals(validateConsent({ ...ok, age: 30, signature: " sam  lee " }, t, "Sam Lee").ok, true);
  assertEquals(validateConsent({ ...ok, age: 30, signature: "Pat Lee" }, t, "Sam Lee").ok, false);
  assertEquals(validateConsent({ ...ok, age: 18, signature: "Sam Lee" }, t, "Sam Lee").ok, false);
  const minor = validateConsent({ ...ok, age: 12, guardian_name: "Pat Lee", signature: "Pat Lee" }, t, "Sam Lee");
  assertEquals(minor.ok && minor.value.guardian_name, "Pat Lee");
  assertEquals(validateConsent({ ...ok, age: 3, signature: "Sam Lee" }, t, "Sam Lee").ok, false);
});

const reg = {
  player_name: "Sam Lee", player_email: "sam@example.com", partner_name: "Pat Kim", partner_email: "pat@example.com",
  approved_player_id: "p1", approved_partner_id: "p2",
};

Deno.test("a doubles link is the partner's: partner role, email, age and player", () => {
  const s = waiverSigner(reg);
  assertEquals([s.solo, s.role, s.name, s.email, s.ageColumn, s.playerId], [false, "partner", "Pat Kim", "pat@example.com", "partner_age", "p2"]);
});

Deno.test("a link on an entry with no partner is the player's own (singles added by a director)", () => {
  for (const partner_name of [null, "", "  "]) {
    const s = waiverSigner({ ...reg, partner_name, partner_email: null, approved_partner_id: null });
    assertEquals([s.solo, s.role, s.name, s.email, s.ageColumn, s.playerId], [true, "player", "Sam Lee", "sam@example.com", "player_age", "p1"]);
  }
});
