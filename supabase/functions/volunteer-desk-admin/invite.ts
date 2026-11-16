// supabase/functions/volunteer-desk-admin/invite.ts
//
// The parts of the organizer screen's service that need no database:
// checking what an organizer typed, making a link, and writing the email a
// volunteer receives.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The whole app runs on British Columbia time, which is UTC-7 all year.
export const EVENT_TZ = "Etc/GMT+7";
export const MAX_LINKS = 40;
const MAX_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export type InviteInput = { name: string; email: string; valid_from: string; valid_until: string };

/** A volunteer's name as typed: trimmed, single spaces, 1 to 60 characters, no control characters. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= 60 ? s : null;
}

export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s.length <= 254 && EMAIL.test(s) ? s : null;
}

/** An ISO time with an offset (…Z or …-07:00), as a Date. Null for anything else. */
export function parseTime(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The hours a link works, checked. Returns ISO strings or a sentence to show the organizer. */
export function checkWindow(from: unknown, until: unknown, now: Date): { from: string; until: string } | { error: string } {
  const a = parseTime(from), b = parseTime(until);
  if (!a || !b) return { error: "Please choose a start and an end time." };
  if (b.getTime() <= a.getTime()) return { error: "The end time must be after the start time." };
  if (b.getTime() <= now.getTime()) return { error: "The end time has already passed." };
  if (b.getTime() - a.getTime() > MAX_WINDOW_MS) return { error: "A link can work for 3 days at most." };
  return { from: a.toISOString(), until: b.toISOString() };
}

export function checkInvite(body: Record<string, unknown>, now: Date): InviteInput | { error: string } {
  const name = cleanName(body.name);
  if (!name) return { error: "Please enter the volunteer's name (up to 60 characters)." };
  const email = cleanEmail(body.email);
  if (!email) return { error: "Please enter a valid email address." };
  const w = checkWindow(body.valid_from, body.valid_until, now);
  if ("error" in w) return w;
  return { name, email, valid_from: w.from, valid_until: w.until };
}

/** A new link secret: 32 random bytes as URL-safe base64 (43 characters). */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The link as emailed. The key rides in the query (?k=) so it survives the
 * mail service's click redirect; the page takes it out of the address bar at
 * once. The copy shown to the organizer uses #k=, which never reaches a server.
 */
export const emailLink = (deskOrigin: string, key: string) => `${deskOrigin.replace(/\/+$/, "")}/?k=${key}`;
export const copyLink = (deskOrigin: string, key: string) => `${deskOrigin.replace(/\/+$/, "")}/#k=${key}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TZ, weekday: "long", month: "long", day: "numeric" }).format(d);
const fmtTime = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\./g, "").replace(/\s+/g, " ");

/** "Saturday, November 21, 7:00 am to 10:00 pm" (or both days when it spans two). */
export function windowText(fromIso: string, untilIso: string): string {
  const a = new Date(fromIso), b = new Date(untilIso);
  return fmtDay(a) === fmtDay(b)
    ? `${fmtDay(a)}, ${fmtTime(a)} to ${fmtTime(b)}`
    : `${fmtDay(a)}, ${fmtTime(a)} to ${fmtDay(b)}, ${fmtTime(b)}`;
}

export type InviteEmail = { subject: string; html: string; text: string };

export function inviteEmail(d: { name: string; tournament: string; link: string; valid_from: string; valid_until: string; again: boolean }): InviteEmail {
  const name = firstName(d.name);
  const hours = windowText(d.valid_from, d.valid_until);
  const subject = d.again
    ? `Your new check-in desk link for ${d.tournament}`
    : `Your check-in desk link for ${d.tournament}`;
  const intro = `Thank you for helping at ${d.tournament}. This is your personal link to the check-in desk. It opens in your phone's browser: no app and no password.`;
  const replaced = "This link replaces the one we sent you before. The old one no longer works.";
  const steps = [
    ["Find the player", "Search their name, or scroll the list."],
    ["Tap Check in", "If you tap the wrong person, tap Undo."],
    ["Tap Take photo", "Ask the player first (a parent or guardian if they're under 19), take the photo, tick the box and save."],
  ];
  const ink = "#06080D", panel = "#10141C", line = "#262D3A", text = "#ECEEF2", muted = "#9AA3B2", volt = "#D4FF3A";
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ink};"><tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:${font};color:${text};">
<tr><td style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:${volt};font-weight:700;padding-bottom:10px;">${esc(d.tournament)} · Check-in desk</td></tr>
<tr><td style="font-size:26px;line-height:1.2;font-weight:700;padding-bottom:14px;">Hi ${esc(name)}, here is your desk link</td></tr>
<tr><td style="font-size:16px;line-height:1.5;color:${text};padding-bottom:${d.again ? "10" : "22"}px;">${esc(intro)}</td></tr>
${d.again ? `<tr><td style="font-size:16px;line-height:1.5;color:${text};padding-bottom:22px;">${esc(replaced)}</td></tr>` : ""}
<tr><td style="padding-bottom:22px;"><a href="${esc(d.link)}" style="display:inline-block;background:${volt};color:#10140A;font-weight:700;font-size:17px;text-decoration:none;padding:15px 26px;border-radius:12px;">Open the check-in desk</a></td></tr>
<tr><td style="background:${panel};border:1px solid ${line};border-radius:14px;padding:16px 18px;font-size:15px;line-height:1.5;">
<div style="color:${muted};font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;">When it works</div>
<div style="padding-top:4px;">${esc(hours)}</div>
</td></tr>
<tr><td style="padding:22px 0 6px;color:${muted};font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;">What you do</td></tr>
${steps.map(([t, s], i) => `<tr><td style="padding:8px 0;font-size:15px;line-height:1.5;"><span style="color:${volt};font-weight:700;">${i + 1}.</span> <b>${esc(t)}.</b> <span style="color:${text};">${esc(s)}</span></td></tr>`).join("\n")}
<tr><td style="padding-top:20px;font-size:14px;line-height:1.5;color:${muted};border-top:1px solid ${line};">This link is only for you. Please don't forward it. If it stops working or you have a question, reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
  const textBody = [
    `Hi ${name},`,
    "",
    intro,
    ...(d.again ? ["", replaced] : []),
    "",
    `Open the check-in desk: ${d.link}`,
    "",
    `When it works: ${hours}`,
    "",
    "WHAT YOU DO",
    ...steps.map(([t, s], i) => `${i + 1}. ${t}. ${s}`),
    "",
    "This link is only for you. Please don't forward it. If it stops working or you have a question, reply to this email.",
  ].join("\n");
  return { subject, html, text: textBody };
}
