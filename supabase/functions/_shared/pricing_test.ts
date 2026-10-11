import { assertEquals } from "jsr:@std/assert@1";
import { cardCents, etransferCents } from "./pricing.ts";

const cat = (team_size: number, price: number | string | null, price_basis = "per_player") => ({ team_size, price, price_basis });

Deno.test("e-transfer amount follows the category price and basis", () => {
  assertEquals(etransferCents(cat(1, 25), false), 2500);
  assertEquals(etransferCents(cat(1, 25), true), 2500); // singles: paysForBoth irrelevant
  assertEquals(etransferCents(cat(2, 20), false), 2000); // per player, own share
  assertEquals(etransferCents(cat(2, 20), true), 4000); // per player, pays for both
  assertEquals(etransferCents(cat(2, 40, "per_team"), true), 4000);
  assertEquals(etransferCents(cat(2, 40, "per_team"), false), 4000);
  assertEquals(etransferCents(cat(1, "12.50"), false), 1250); // numeric strings from Postgres
  assertEquals(etransferCents(cat(1, null), false), null);
});

Deno.test("card amount is e-transfer + 3%, rounded to the cent", () => {
  assertEquals(cardCents(4000), 4120);
  assertEquals(cardCents(2500), 2575);
  assertEquals(cardCents(1250), 1288); // 1287.5 rounds up
  assertEquals(cardCents(0), 0);
});

Deno.test("youth and student concessions apply per player when cheaper", () => {
  const fees = { youth_price: 30, student_price: 30 };
  const adult = { age: 30, student: false };
  const youth = { age: 16, student: false };
  const student = { age: 21, student: true };
  assertEquals(etransferCents(cat(1, 40), false, adult, undefined, fees), 4000);
  assertEquals(etransferCents(cat(1, 40), false, youth, undefined, fees), 3000);
  assertEquals(etransferCents(cat(1, 40), false, student, undefined, fees), 3000);
  // Paying for both: each share priced for its own player.
  assertEquals(etransferCents(cat(2, 40), true, adult, youth, fees), 7000);
  assertEquals(etransferCents(cat(2, 40), true, student, student, fees), 6000);
  // Own share only when the partner pays separately.
  assertEquals(etransferCents(cat(2, 40), false, youth, adult, fees), 3000);
  // Never raises a price: youth categories already at $30, or cheaper.
  assertEquals(etransferCents(cat(1, 25), false, youth, undefined, fees), 2500);
  // Per-team prices and tournaments without concessions are unchanged.
  assertEquals(etransferCents(cat(2, 70, "per_team"), true, youth, youth, fees), 7000);
  assertEquals(etransferCents(cat(1, 40), false, youth), 4000);
  // 18 and over pay the adult fee.
  assertEquals(etransferCents(cat(1, 40), false, { age: 18, student: false }, undefined, fees), 4000);
});
