import { describe, expect, it } from "vitest";
import type { WaitlistRow } from "../../../lib/db";
import { alertProblem, dialHref, joinedLabel, prettyPhone, waitlistCsv } from "../waitlist";

const row = (over: Partial<WaitlistRow> = {}): WaitlistRow => ({
  id: "w1",
  name: "Harpreet Sandhu",
  email: "harpreet@example.com",
  phone: "6045551234",
  // Nov 8 2026, 3:12 pm in Abbotsford (UTC-7 year-round from Nov 1, 2026).
  created_at: "2026-11-08T22:12:00Z",
  admin_email_status: "sent",
  category_id: "c1",
  category_name: "Mixed Doubles 18–34",
  ...over,
});

describe("prettyPhone", () => {
  it("groups a 10-digit number", () => expect(prettyPhone("6045551234")).toBe("604 555 1234"));
  it("shows a leading 1 as +1", () => expect(prettyPhone("16045551234")).toBe("+1 604 555 1234"));
  it("puts + before an overseas number", () => expect(prettyPhone("447700900123")).toBe("+447700900123"));
  it("ignores stray symbols", () => expect(prettyPhone("(604) 555-1234")).toBe("604 555 1234"));
});

describe("dialHref", () => {
  it("dials a 10-digit number as is", () => expect(dialHref("tel", "6045551234")).toBe("tel:6045551234"));
  it("adds + to a number with its country code", () => expect(dialHref("tel", "16045551234")).toBe("tel:+16045551234"));
  it("adds + to an overseas number", () => expect(dialHref("sms", "447700900123")).toBe("sms:+447700900123"));
});

describe("joinedLabel", () => {
  it("shows Abbotsford time", () => {
    const s = joinedLabel("2026-11-08T22:12:00Z");
    expect(s).toMatch(/Nov/);
    expect(s).toMatch(/8/);
    // The year-round UTC-7 rule depends on the runtime's time-zone data, so
    // accept 3:12 (UTC-7) or 2:12 (an older UTC-8 table), never UTC itself.
    expect(s).toMatch(/[23]:12/);
    expect(s).not.toMatch(/10:12/);
  });
});

describe("alertProblem", () => {
  it("says nothing when the email went out", () => expect(alertProblem("sent")).toBeNull());
  it("flags a failed send", () => expect(alertProblem("failed: 500")).toMatch(/didn't send/));
  it("flags a tournament with no director email", () => expect(alertProblem("not configured")).toMatch(/no director email/));
  it("flags a status that never got written", () => expect(alertProblem(null)).toMatch(/isn't confirmed/));
});

describe("waitlistCsv", () => {
  it("numbers people in the order given and formats each column", () => {
    const csv = waitlistCsv([
      row(),
      row({ id: "w2", name: "Mei Chen", phone: "7785550000", admin_email_status: null, category_id: null, category_name: null }),
    ]);
    const [head, a, b] = csv.split("\n");
    expect(head).toBe("Place,Name,Event,Mobile,Email,Joined date,Joined time,Alert email");
    expect(a.startsWith("1,Harpreet Sandhu,Mixed Doubles 18–34,604 555 1234,harpreet@example.com,")).toBe(true);
    expect(a.endsWith(",sent")).toBe(true);
    expect(b.startsWith("2,Mei Chen,,778 555 0000,")).toBe(true);
    expect(b.endsWith(",")).toBe(true);
  });

  it("writes +1 numbers without the +1, and guards an overseas +", () => {
    const csv = waitlistCsv([row({ phone: "16045551234" }), row({ id: "w2", phone: "447700900123" })]);
    const [, a, b] = csv.split("\n");
    expect(a).toContain(",604 555 1234,");
    expect(b).toContain(",'+447700900123,");
  });

  it("quotes commas and quotes", () => {
    const csv = waitlistCsv([row({ name: 'Sandhu, "Harry"' })]);
    expect(csv.split("\n")[1]).toContain('"Sandhu, ""Harry"""');
  });

  it("stops a name from running as a spreadsheet formula", () => {
    for (const name of ["=HYPERLINK(\"x\")", "+1+2", "-3", "@SUM(A1)"]) {
      const line = waitlistCsv([row({ name })]).split("\n")[1];
      const nameCell = line.slice(2); // after "1,"
      expect(nameCell.startsWith("'") || nameCell.startsWith("\"'")).toBe(true);
    }
  });

  it("is just the header for an empty list", () => {
    expect(waitlistCsv([])).toBe("Place,Name,Event,Mobile,Email,Joined date,Joined time,Alert email");
  });
});
