import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { joinNames, maskNumber, optinCode, parseCommand, toWhatsAppNumber } from "./whatsapp.ts";

Deno.test("10-digit Canadian numbers get the country code", () => {
  assertEquals(toWhatsAppNumber("7789646999"), "17789646999");
  assertEquals(toWhatsAppNumber("(778) 964-6999"), "17789646999");
  assertEquals(toWhatsAppNumber(" 604.555.0123 "), "16045550123");
});

Deno.test("11-digit numbers starting with 1 are kept", () => {
  assertEquals(toWhatsAppNumber("17789646999"), "17789646999");
  assertEquals(toWhatsAppNumber("+1 778 964 6999"), "17789646999");
});

Deno.test("international numbers are kept when marked or long enough", () => {
  assertEquals(toWhatsAppNumber("+91 98123 45678"), "919812345678");
  assertEquals(toWhatsAppNumber("0091 98123 45678"), "919812345678");
  assertEquals(toWhatsAppNumber("919812345678"), "919812345678");
});

Deno.test("numbers that can't be right are skipped, not guessed", () => {
  assertEquals(toWhatsAppNumber(null), null);
  assertEquals(toWhatsAppNumber("12345"), null);
  assertEquals(toWhatsAppNumber("27789646999"), null); // 11 digits, no leading 1
  assertEquals(toWhatsAppNumber("1234567890"), null);  // area code can't start with 1
});

Deno.test("masking keeps only the last four digits, also for WhatsApp IDs", () => {
  assertEquals(maskNumber("17789646999"), "*******6999");
  assertEquals(maskNumber("17789646999@s.whatsapp.net"), "*******6999");
  assertEquals(maskNumber("123"), "****");
});

Deno.test("names are joined by first name, without repeats", () => {
  assertEquals(joinNames(["Asha Patel"]), "Asha");
  assertEquals(joinNames(["Asha Patel", "Ravi Patel"]), "Asha & Ravi");
  assertEquals(joinNames(["Asha", "Ravi", "Meena K"]), "Asha, Ravi & Meena");
  assertEquals(joinNames([]), "there");
});

Deno.test("the opt-in code is the start of the registration id", () => {
  assertEquals(optinCode("1a2b3c4d-0000-4000-8000-000000000000"), "1A2B3C4D");
});

Deno.test("the button's message is read as a join", () => {
  const msg = "Hi Shuttle Storm! Please send me WhatsApp updates for Shuttle Storm Abbotsford 2026. My code: 1A2B3C4D";
  assertEquals(parseCommand(msg), { kind: "join", code: "1A2B3C4D" });
  assertEquals(parseCommand("code 1a2b3c4d"), { kind: "join", code: "1A2B3C4D" });
  assertEquals(parseCommand(" 1a2b3c4d "), { kind: "join", code: "1A2B3C4D" });
});

Deno.test("STOP and START, and nothing else, are commands", () => {
  assertEquals(parseCommand("STOP"), { kind: "stop" });
  assertEquals(parseCommand("stop please"), { kind: "stop" });
  assertEquals(parseCommand("Unsubscribe"), { kind: "stop" });
  assertEquals(parseCommand("start"), { kind: "start" });
  assertEquals(parseCommand("Can I cancel my entry?"), null);
  assertEquals(parseCommand("Where do I park? It's deadbeef late"), null);
  assertEquals(parseCommand("Thanks!"), null);
});
