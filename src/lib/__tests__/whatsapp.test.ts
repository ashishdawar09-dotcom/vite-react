import { describe, expect, it } from "vitest";
import { chatMessage, formatClubNumber, optinCode, optinLink, optinMessage, waLink } from "../whatsapp";

const reg = "1a2b3c4d-0000-4000-8000-000000000000";

describe("WhatsApp opt-in link", () => {
  it("uses the start of the registration id as the code", () => {
    expect(optinCode(reg)).toBe("1A2B3C4D");
    expect(optinMessage("Shuttle Storm", reg)).toBe("Hi! Please send me WhatsApp updates for Shuttle Storm. My code: 1A2B3C4D");
  });

  it("opens WhatsApp to the club number with the message typed in", () => {
    const link = optinLink("17789646999", "Shuttle Storm", reg)!;
    expect(link.startsWith("https://wa.me/17789646999?text=")).toBe(true);
    expect(decodeURIComponent(link.split("text=")[1])).toBe(optinMessage("Shuttle Storm", reg));
  });

  it("gives no link without a usable club number", () => {
    expect(optinLink(null, "x", reg)).toBeNull();
    expect(optinLink("12345", "x", reg)).toBeNull();
    expect(optinLink("0123456789", "x", reg)).toBeNull();
  });

  it("formats the club number for people to read", () => {
    expect(formatClubNumber("17789646999")).toBe("+1 778 964 6999");
    expect(formatClubNumber("919812345678")).toBe("+91 98123 45678");
    expect(formatClubNumber("447946095800")).toBe("+447946095800");
  });
});

describe("Chat with us link", () => {
  const msg = chatMessage("Shuttle Storm Abbotsford 2026", ["Men's Singles", "Mixed Doubles 35+"]);

  it("names the tournament and the events entered, nothing personal", () => {
    expect(msg).toBe("Hi! I've just entered Shuttle Storm Abbotsford 2026 (Men's Singles, Mixed Doubles 35+) and have a question: ");
    expect(chatMessage("Shuttle Storm", [])).toBe("Hi! I've just entered Shuttle Storm and have a question: ");
  });

  // Same rules as parseCommand in supabase/functions/_shared/whatsapp.ts:
  // the bot answers only codes and STOP/START, so a question must be neither.
  it("is never read as an opt-in code or STOP/START", () => {
    for (const m of [msg, chatMessage("Stop Smash Open", ["Start Ups"]), chatMessage("Code 1A2B3C4D Cup", [])]) {
      expect(/^(stop|unsubscribe)\b/i.test(m.trim())).toBe(false);
      expect(/^(start|resume)[\s.!]*$/i.test(m.trim())).toBe(false);
    }
    expect(/\bcode\W{0,3}([0-9a-f]{8})\b/i.test(msg)).toBe(false);
  });

  it("opens WhatsApp to the club number with the question started", () => {
    const link = waLink("919818338393", msg)!;
    expect(link.startsWith("https://wa.me/919818338393?text=")).toBe(true);
    expect(decodeURIComponent(link.split("text=")[1])).toBe(msg);
    expect(waLink(null, msg)).toBeNull();
    expect(waLink("12345", msg)).toBeNull();
  });
});
