// The directors' email for a new waitlist name (join-waitlist).

// What join-waitlist answers once a director has closed the waitlist.
export const WAITLIST_CLOSED = "We're really sorry, we're fully booked and the waitlist is now closed.";

import { esc } from "./emails.ts";

// 7789646999 → 778 964 6999; anything else stays as typed digits.
export function prettyPhone(digits: string): string {
  return digits.length === 10 ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : digits;
}

export function waitlistAlert(d: {
  tournament: string; name: string; email: string; phone: string; event?: string | null; position: number;
}) {
  const subject = d.event
    ? `Waitlist #${d.position}: ${d.name} wants a spot in ${d.event} at ${d.tournament}`
    : `Waitlist #${d.position}: ${d.name} wants a spot at ${d.tournament}`;
  const lines = [
    `${d.name} joined the waitlist for ${d.tournament}. Entries are full, so the form offered the waitlist instead.`,
    ...(d.event ? [`Event: ${d.event}`] : []),
    `Mobile: ${prettyPhone(d.phone)}`,
    `Email: ${d.email}`,
    `${d.position} ${d.position === 1 ? "person is" : "people are"} on the waitlist now. Reply to this email to write to ${d.name}.`,
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:24px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111">` +
    lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join("") + `</body></html>`;
  return { subject, html, text: lines.join("\n\n") };
}
