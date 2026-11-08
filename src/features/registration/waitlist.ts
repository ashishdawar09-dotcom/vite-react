// Helpers for the admin Waitlist panel (Players tab): how a waitlist row's
// phone, join time and alert-email status read, and the CSV the directors
// download. People join from the public "we're full" page (join-waitlist).

import type { WaitlistRow } from "../../lib/db";

const TZ = "America/Vancouver";
const joinedFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

// 7789646999 → 778 964 6999 and 17789646999 → +1 778 964 6999; any other
// length (an overseas number with its country code) gets a "+" in front.
export function prettyPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : "";
}

// Call / Text link for a stored number (digits only, 10 to 15 of them). Ten
// digits is a local North American number; anything longer already starts
// with its country code, so it gets a "+" in front to dial from Canada.
export function dialHref(kind: "tel" | "sms", digits: string): string {
  const d = digits.replace(/\D/g, "");
  return `${kind}:${d.length === 10 ? d : `+${d}`}`;
}

// "Nov 8, 3:12 p.m." in Abbotsford time.
export function joinedLabel(iso: string): string {
  return joinedFmt.format(new Date(iso));
}

// What to tell the directors when a name's alert email didn't go out, or
// null when it did. The name is on this list either way.
export function alertProblem(status: string | null): string | null {
  if (status === "sent") return null;
  if (status === "not configured") return "No alert email: no director email is set for this tournament.";
  if (status && status.startsWith("failed")) return "The alert email to the directors didn't send.";
  return "The alert email to the directors isn't confirmed.";
}

// Spreadsheet apps run a cell that starts with = + - @ (or a tab or carriage
// return) as a formula. Names come from a public form, so those get a leading
// apostrophe, which shows the text as typed.
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// The Mobile column: North American numbers without the +1, so no cell starts
// with "+" (a spreadsheet would read that as a formula). An overseas number
// keeps its "+" and so gets the apostrophe guard below.
function csvPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  return prettyPhone(d.length === 11 && d.startsWith("1") ? d.slice(1) : d);
}

export function waitlistCsv(rows: WaitlistRow[]): string {
  const head = ["Place", "Name", "Mobile", "Email", "Joined date", "Joined time", "Alert email"];
  const lines = rows.map((r, i) => {
    const at = new Date(r.created_at);
    return [
      String(i + 1),
      r.name,
      csvPhone(r.phone),
      r.email,
      dateFmt.format(at),
      timeFmt.format(at),
      r.admin_email_status ?? "",
    ].map(cell).join(",");
  });
  return [head.join(","), ...lines].join("\n");
}
