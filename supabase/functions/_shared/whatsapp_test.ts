import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatClubNumber, joinNames, maskNumber, optinCode, optinLink, optinMessage, parseCommand, toWhatsAppNumber,
} from "./whatsapp.ts";

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

Deno.test("the opt-in code is the start of the registration id, the partner's the end", () => {
  assertEquals(optinCode("1a2b3c4d-0000-4000-8000-0000ab12cd34"), "1A2B3C4D");
  assertEquals(optinCode("1a2b3c4d-0000-4000-8000-0000ab12cd34", "player"), "1A2B3C4D");
  assertEquals(optinCode("1a2b3c4d-0000-4000-8000-0000ab12cd34", "partner"), "AB12CD34");
});

Deno.test("the opt-in link opens WhatsApp with the code typed in", () => {
  const link = optinLink("919818338393", "Shuttle Storm Abbotsford 2026", "E9794751")!;
  assertEquals(link.startsWith("https://wa.me/919818338393?text="), true);
  const msg = decodeURIComponent(link.split("text=")[1]);
  assertEquals(msg, optinMessage("Shuttle Storm Abbotsford 2026", "E9794751"));
  assertEquals(parseCommand(msg), { kind: "join", code: "E9794751", labelled: true });
  assertEquals(optinLink(null, "x", "E9794751"), null);
  assertEquals(optinLink("12345", "x", "E9794751"), null);
});

Deno.test("club numbers are written the way people read them", () => {
  assertEquals(formatClubNumber("919818338393"), "+91 98183 38393");
  assertEquals(formatClubNumber("17789646999"), "+1 778 964 6999");
  assertEquals(formatClubNumber("447946095800"), "+447946095800");
});

Deno.test("the button's message is read as a join", () => {
  const msg = "Hi! Please send me WhatsApp updates for Shuttle Storm Abbotsford 2026. My code: 1A2B3C4D";
  assertEquals(parseCommand(msg), { kind: "join", code: "1A2B3C4D", labelled: true });
  assertEquals(parseCommand("code 1a2b3c4d"), { kind: "join", code: "1A2B3C4D", labelled: true });
  assertEquals(parseCommand(" 1a2b3c4d "), { kind: "join", code: "1A2B3C4D", labelled: false });
});

Deno.test("STOP and START, and nothing else, are commands", () => {
  assertEquals(parseCommand("STOP"), { kind: "stop" });
  assertEquals(parseCommand("stop please"), { kind: "stop" });
  assertEquals(parseCommand("STOP sending these"), { kind: "stop" });
  assertEquals(parseCommand("Unsubscribe"), { kind: "stop" });
  assertEquals(parseCommand("start"), { kind: "start" });
  assertEquals(parseCommand("START!"), { kind: "start" });
  assertEquals(parseCommand("Can I cancel my entry?"), null);
  assertEquals(parseCommand("Where do I park? It's deadbeef late"), null);
  assertEquals(parseCommand("Thanks!"), null);
});

Deno.test("questions that start with start or stop are just questions", () => {
  assertEquals(parseCommand("Start time tomorrow?"), null);
  assertEquals(parseCommand("Start time is 9:30 right"), null);
  assertEquals(parseCommand("Stop by the desk?"), null);
  assertEquals(parseCommand("Stopping by the desk at 9 to pick up my shirt"), null);
});
