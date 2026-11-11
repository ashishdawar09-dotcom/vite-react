// Helpers for the page shown once a tournament is full (FullHouse.tsx): the
// organizers' contacts, the waitlist form's checks and the tagline.

import type { Tournament } from "../../types";

export type Contact = { name: string; phone: string | null; email: string | null };

const EMAIL_RE = /^[^\s@%*]+@[^\s@%*]+\.[^\s@%*]+$/;

// tournaments.contact_info, as the directors type it, e.g.
//   Tournament directors
//   Ashish Dawar · 778 964 6999 · ashishdawar09@gmail.com
// Lines with a phone number or email become people; a first line without
// either is the heading. Parts can be split by "·", "|", "," or " - ".
export function parseContacts(info: string | null | undefined): { heading: string | null; people: Contact[] } {
  const lines = (info ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let heading: string | null = null;
  const people: Contact[] = [];
  lines.forEach((line, i) => {
    const parts = line.split(/\s*(?:·|\||,|\s-\s)\s*/)
      .map((p) => p.trim().replace(/^(?:e-?mail|phone|tel|mobile|cell|call|text)\s*:\s*/i, ""))
      .filter(Boolean);
    const email = parts.find((p) => EMAIL_RE.test(p)) ?? null;
    const phone = parts.find((p) => !EMAIL_RE.test(p) && p.replace(/\D/g, "").length >= 10) ?? null;
    if (!email && !phone) {
      if (i === 0) heading = line;
      return;
    }
    const name = parts.filter((p) => p !== email && p !== phone).join(" ").trim();
    people.push({ name: name || (email ?? phone ?? ""), phone, email });
  });
  return { heading, people };
}

// tel: and sms: links keep the digits (and a leading +).
export function phoneHref(kind: "tel" | "sms", phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `${kind}:${digits}`;
}

export type WaitlistForm = { name: string; phone: string; email: string; category_id: string };
export type WaitlistErrors = Partial<Record<keyof WaitlistForm, string>>;

export function waitlistErrors(f: WaitlistForm): WaitlistErrors {
  const e: WaitlistErrors = {};
  if (f.name.trim().length < 2) e.name = "Enter your full name.";
  const digits = f.phone.replace(/\D/g, "");
  if (!digits) e.phone = "Enter your mobile number.";
  else if (digits.length < 10 || digits.length > 15) e.phone = "Enter a mobile number with 10 to 15 digits.";
  if (!f.email.trim()) e.email = "Enter your email address.";
  else if (!EMAIL_RE.test(f.email.trim())) e.email = "Enter an email address like name@example.com.";
  if (!f.category_id) e.category_id = "Choose the event you'd like to play.";
  return e;
}

// "150 entries. 10 events. One Saturday at UFV Athletic Centre." from the
// tournament's own data, so it never states anything the database doesn't.
export function taglineText(t: Pick<Tournament, "event_date" | "venue_name">, cap: number, events: number): string {
  const parts = [`${cap} entries.`];
  if (events > 0) parts.push(`${events} ${events === 1 ? "event" : "events"}.`);
  const weekday = t.event_date
    ? new Date(`${t.event_date}T12:00:00`).toLocaleDateString("en-CA", { weekday: "long" })
    : null;
  const venue = t.venue_name?.split("–")[0].trim() || null;
  if (weekday && venue) parts.push(`One ${weekday} at ${venue}.`);
  else if (weekday) parts.push(`One ${weekday}.`);
  parts.push("Thank you for filling every spot.");
  return parts.join(" ");
}

// "Saturday, November 21 from 9:30 am"
export function eventWhen(t: Pick<Tournament, "event_date" | "event_time">): string | null {
  if (!t.event_date) return null;
  const day = new Date(`${t.event_date}T12:00:00`).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
  if (!t.event_time) return day;
  const [hh, mm] = t.event_time.split(":").map(Number);
  if (Number.isNaN(hh)) return day;
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${day} from ${h12}:${String(mm || 0).padStart(2, "0")} ${hh >= 12 ? "pm" : "am"}`;
}
