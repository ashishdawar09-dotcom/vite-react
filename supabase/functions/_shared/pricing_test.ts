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
