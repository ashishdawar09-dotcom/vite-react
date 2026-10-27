import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { joinNames, maskNumber, toWhatsAppNumber } from "./whatsapp.ts";

Deno.test("10-digit Canadian numbers get the country code", () => {
  assertEquals(toWhatsAppNumber("7789646999"), "17789646999");
  assertEquals(toWhatsAppNumber("(778) 964-6999"), "17789646999");
  assertEquals(toWhatsAppNumber(" 604.555.0123 "), "16045550123");
});

Deno.test("11-digit numbers starting with 1 are kept", () => {
  assertEquals(toWhatsAppNumber("17789646999"), "17789646999");
  assertEquals(toWhatsAppNumber("+1 778 964 6999"), "17789646999");
  assertEquals(toWhatsAppNumber("1-604-555-0123"), "16045550123");
});

Deno.test("international numbers are kept when marked or long enough", () => {
  assertEquals(toWhatsAppNumber("+91 98123 45678"), "919812345678");
  assertEquals(toWhatsAppNumber("0091 98123 45678"), "919812345678");
  assertEquals(toWhatsAppNumber("919812345678"), "919812345678");
  assertEquals(toWhatsAppNumber("+44 20 7946 0958"), "442079460958");
});

Deno.test("numbers that can't be right are skipped, not guessed", () => {
  assertEquals(toWhatsAppNumber(null), null);
  assertEquals(toWhatsAppNumber(""), null);
  assertEquals(toWhatsAppNumber("12345"), null);
  assertEquals(toWhatsAppNumber("27789646999"), null); // 11 digits, no leading 1
  assertEquals(toWhatsAppNumber("1234567890"), null);  // area code can't start with 1
  assertEquals(toWhatsAppNumber("7781646999"), null);  // exchange can't start with 1
  assertEquals(toWhatsAppNumber("+0 1234 5678"), null);
});

Deno.test("masking keeps only the last four digits", () => {
  assertEquals(maskNumber("17789646999"), "*******6999");
  assertEquals(maskNumber("123"), "****");
});

Deno.test("names are joined by first name, without repeats", () => {
  assertEquals(joinNames(["Asha Patel"]), "Asha");
  assertEquals(joinNames(["Asha Patel", "Ravi Patel"]), "Asha & Ravi");
  assertEquals(joinNames(["Asha", "Ravi", "Meena K"]), "Asha, Ravi & Meena");
  assertEquals(joinNames(["Asha", "Asha"]), "Asha");
  assertEquals(joinNames([]), "there");
});
