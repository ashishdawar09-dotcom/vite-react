import { describe, expect, it } from "vitest";
import { formatClubNumber, optinCode, optinLink, optinMessage } from "../whatsapp";

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
    expect(formatClubNumber("919812345678")).toBe("+919812345678");
  });
});
