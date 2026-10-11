import { assertEquals } from "jsr:@std/assert@1";
import { validateConsent } from "./waiver.ts";

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
