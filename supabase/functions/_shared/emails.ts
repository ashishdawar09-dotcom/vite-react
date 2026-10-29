// Registration emails: "We've got your registration" (on submit, or once a
// card payment completes) and "You're in" (when an admin approves), plus the
// one-off invitation to WhatsApp updates (whatsappInvite). Pure rendering:
// everything comes in through the data argument, nothing is fetched here.
//
// Layout is 600px tables with inline styles so Gmail, Outlook and Apple Mail
// agree. The animated GIFs live on the tournament website; each GIF's first
// frame is its finished state, because Outlook shows only that frame. All
// player details are live text (never baked into images) and escaped.

import { STATEMENT_NAME } from "./pricing.ts";

export type EmailTournament = {
  name: string;
  event_date: string | null;       // YYYY-MM-DD
  event_time: string | null;       // HH:MM[:SS], local to the venue
  venue_name: string | null;
  venue_address: string | null;
  venue_map_url: string | null;
  rules_url: string | null;
  waiver_url: string | null;
  contact_info: string | null;
};

export type EmailRegistration = {
  player_name: string;
  partner_name: string | null;
  payment_method: string | null;    // 'etransfer' | 'card'
  payment_reference: string | null;
  amount_due_cents: number | null;
  payment_paid_full_for_partner: boolean | null;
};

export type EmailData = {
  tournament: EmailTournament;
  category: { name: string; team_size: number };
  reg: EmailRegistration;
  role: "player" | "partner";
  // Partner only: their one-time waiver link, while they still need to accept.
  waiverLink?: string | null;
  // Player in doubles: the partner still has to accept the waiver.
  partnerWaiverPending?: boolean;
  assetBase: string;                // e.g. https://shuttlestorm.adawar.org/email
  privacyUrl?: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const C = {
  ink: "#06080D",
  ink2: "#0C1018",
  card: "#121826",
  bone: "#ECEEF2",
  body: "#C4CAD6",
  mute: "#8F97A8",
  line: "#232A38",
  volt: "#D4FF3A",
  // Volt tints over ink: the WhatsApp compose box's edge, the code chip's dashes.
  olive: "#3E4E18",
  oliveDash: "#5B6E22",
};
const SANS = "'Archivo','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',Menlo,Consolas,monospace";
const TZ = "America/Vancouver";

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

// Only http(s) links reach an href.
const safeUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : null;
  } catch {
    return null;
  }
};

export const firstName = (full: string) => full.trim().split(/\s+/)[0] || full.trim();

// "Saturday, November 21, 2026" — the date is a calendar date, so format in UTC.
export function longDate(ymd: string | null, opts: { weekday?: boolean; year?: boolean } = {}): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: opts.weekday === false ? undefined : "long",
    month: "long",
    day: "numeric",
    year: opts.year === false ? undefined : "numeric",
  });
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "9:30 am"
export function clockTime(hms: string | null): string | null {
  const m = hms?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

export const money = (cents: number | null) =>
  cents === null ? null : `$${(cents / 100).toFixed(2)} CAD`;

const EVENT_END = "17:00";

function compact(ymd: string, hms: string) {
  return `${ymd.replaceAll("-", "")}T${hms.slice(0, 5).replace(":", "")}00`;
}

export function calendarUrl(t: EmailTournament): string | null {
  if (!t.event_date) return null;
  const start = t.event_time ?? "09:00";
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: t.name,
    dates: `${compact(t.event_date, start)}/${compact(t.event_date, EVENT_END)}`,
    ctz: TZ,
    location: [t.venue_name, t.venue_address].filter(Boolean).join(", "),
    details: "Arrive 30 minutes before your first match. Draws and start times are posted before the event.",
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

// iCalendar invite (floating local time pinned with TZID; Vancouver rules).
export function buildIcs(t: EmailTournament, uid: string): string | null {
  if (!t.event_date) return null;
  const icsEsc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//adawar.org//Badminton Tournament//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${TZ}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0800",
    "TZOFFSETTO:-0700",
    "TZNAME:PDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0800",
    "TZNAME:PST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}@badminton.adawar.org`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${TZ}:${compact(t.event_date, t.event_time ?? "09:00")}`,
    `DTEND;TZID=${TZ}:${compact(t.event_date, EVENT_END)}`,
    `SUMMARY:${icsEsc(t.name)}`,
    `LOCATION:${icsEsc([t.venue_name, t.venue_address].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${icsEsc("Arrive 30 minutes before your first match. Draws and start times are posted before the event.")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

// ---------- building blocks ----------

const p = (html: string, extra = "") =>
  `<p style="margin:0 0 14px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.body};${extra}">${html}</p>`;

const kicker = (s: string) =>
  `<div style="font-family:${MONO};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${C.volt};margin:0 0 12px">${esc(s)}</div>`;

// cls "cta" makes the button fill the column on phones (with the invitation's
// CSS). Outlook ignores padding on links, so the cell carries it there.
const button = (href: string, label: string, primary = true, cls = "") =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${cls ? ` class="${cls}"` : ""} style="display:inline-table;margin:6px 8px 0 0"><tr>` +
  `<td bgcolor="${primary ? C.volt : C.ink}" style="border-radius:999px;${primary ? "" : `border:1px solid ${C.line};`}mso-padding-alt:14px 24px">` +
  `<a href="${esc(href)}" style="display:inline-block;padding:14px 24px;font-family:${SANS};font-size:14px;font-weight:700;letter-spacing:1px;` +
  `text-transform:uppercase;text-decoration:none;color:${primary ? C.ink : C.bone};border-radius:999px">${esc(label)}</a></td></tr></table>`;

function detailsCard(rows: [string, string][]): string {
  const body = rows.map(([k, v], i) =>
    `<tr><td class="k" style="padding:12px 20px;${i ? `border-top:1px solid ${C.line};` : ""}font-family:${MONO};font-size:11px;letter-spacing:2px;` +
    `text-transform:uppercase;color:${C.mute};width:110px;vertical-align:top">${esc(k)}</td>` +
    `<td class="v" style="padding:12px 20px;${i ? `border-top:1px solid ${C.line};` : ""}font-family:${SANS};font-size:15px;color:${C.bone};vertical-align:top">${v}</td></tr>`
  ).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" ` +
    `style="background:${C.card};border:1px solid ${C.line};border-radius:14px;border-collapse:separate">${body}</table>`;
}

// Each step leads with a GIF from the asset base, or with live HTML instead
// (`visual`). `wideCta`: the button fills the column on phones.
type Step = {
  n: number;
  gif?: string;
  alt?: string;
  visual?: string;
  title: string;
  html: string;
  cta?: [string, string];
  wideCta?: boolean;
};

function stepBlock(s: Step, assetBase: string): string {
  const visual = s.visual ??
    `<img src="${esc(`${assetBase}/${s.gif}`)}" width="536" alt="${esc(s.alt ?? "")}" ` +
      `style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:14px;background:${C.ink2}">`;
  return `<tr><td class="px" style="padding:0 32px 36px">` +
    visual +
    `<div style="font-family:${MONO};font-size:12px;letter-spacing:3px;color:${C.volt};margin:20px 0 6px">STEP ${String(s.n).padStart(2, "0")}</div>` +
    `<div style="font-family:${SANS};font-size:24px;line-height:1.2;font-weight:700;color:${C.bone};margin:0 0 10px">${esc(s.title)}</div>` +
    p(s.html, "margin:0") +
    (s.cta ? `<div style="margin-top:14px">${button(s.cta[0], s.cta[1], true, s.wideCta ? "cta" : "")}</div>` : "") +
    `</td></tr>`;
}

// The end of every card: the event-day block, then the directors' footer.
// The invitation keeps volt for its WhatsApp button, so there Directions is
// outlined too.
function cardEnd(t: EmailTournament, privacyUrl: string | null | undefined, directionsPrimary = true): string {
  const when = [longDate(t.event_date), clockTime(t.event_time)].filter(Boolean).join(" · ");
  const map = safeUrl(t.venue_map_url);
  const cal = calendarUrl(t);
  const rules = safeUrl(t.rules_url);
  const waiver = safeUrl(t.waiver_url);
  const privacy = safeUrl(privacyUrl);
  const contacts = (t.contact_info ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => esc(l)).join("<br>");
  const footLinks = [
    rules && `<a href="${esc(rules)}" style="color:${C.mute};text-decoration:underline">Rules</a>`,
    waiver && `<a href="${esc(waiver)}" style="color:${C.mute};text-decoration:underline">Waiver</a>`,
    privacy && `<a href="${esc(privacy)}" style="color:${C.mute};text-decoration:underline">Privacy</a>`,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  return `<tr><td class="px" style="padding:4px 32px 36px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line}">
      <tr><td style="padding-top:28px">
        ${kicker("Event day")}
        <div style="font-family:${SANS};font-size:20px;font-weight:700;color:${C.bone};margin:0 0 6px">${esc(t.name)}</div>
        ${when ? p(esc(when), "margin:0 0 4px;color:" + C.bone) : ""}
        ${t.venue_name ? p(esc(t.venue_name), "margin:0") : ""}
        ${t.venue_address ? p(esc(t.venue_address), `margin:0 0 14px;color:${C.mute};font-size:14px`) : ""}
        <div>${map ? button(map, "Directions", directionsPrimary) : ""}${cal ? button(cal, "Add to calendar", false) : ""}</div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="px" bgcolor="${C.ink}" style="padding:28px 32px;background:${C.ink};border-top:1px solid ${C.line}">
    ${contacts ? p(contacts, `font-size:13px;color:${C.mute}`) : ""}
    ${p("Questions? Just reply to this email and it reaches the tournament directors.", `font-size:13px;color:${C.mute}`)}
    ${footLinks ? p(footLinks, `font-size:13px;color:${C.mute};margin:0`) : ""}
  </td></tr>`;
}

function layout(o: {
  title: string;
  preheader: string;
  hero: { gif: string; alt: string };
  kicker: string;
  heading: string;
  intro: string;
  details: [string, string][];
  stepsHeading: string;
  steps: Step[];
  data: EmailData;
}): string {
  const t = o.data.tournament;
  const base = o.data.assetBase;

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(o.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:0;background:${C.ink}}
  a{color:${C.bone}}
  @media (max-width:620px){ .px{padding-left:20px!important;padding-right:20px!important} h1{font-size:34px!important}
    .k{width:76px!important;padding:12px 8px 12px 14px!important;letter-spacing:1px!important} .v{padding:12px 14px 12px 8px!important} }
</style>
</head>
<body style="margin:0;padding:0;background:${C.ink}" bgcolor="${C.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.ink}">${esc(o.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink}" style="background:${C.ink}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink2}" style="width:100%;max-width:600px;background:${C.ink2};border-radius:18px;overflow:hidden">
  <tr><td style="padding:0"><img src="${esc(`${base}/${o.hero.gif}`)}" width="600" alt="${esc(o.hero.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
  <tr><td class="px" style="padding:36px 32px 8px">
    ${kicker(o.kicker)}
    <h1 style="margin:0 0 16px;font-family:${SANS};font-size:40px;line-height:1.05;font-weight:800;letter-spacing:-0.5px;color:${C.bone}">${o.heading}</h1>
    ${p(o.intro)}
  </td></tr>
  <tr><td class="px" style="padding:12px 32px 40px">${detailsCard(o.details)}</td></tr>
  <tr><td class="px" style="padding:0 32px 24px">
    <div style="font-family:${SANS};font-size:28px;line-height:1.15;font-weight:800;color:${C.bone}">${esc(o.stepsHeading)}</div>
  </td></tr>
  ${o.steps.map((s) => stepBlock(s, base)).join("")}
  ${cardEnd(t, o.data.privacyUrl)}
</table>
<div style="font-family:${SANS};font-size:11px;color:${C.mute};padding:16px 12px">You're receiving this because you were entered in ${esc(t.name)}.</div>
</td></tr>
</table>
</body>
</html>`;
}

// ---------- shared copy ----------

// Doubles entry without a partner: the directors pair them if they can.
const needsPartner = (d: EmailData) => d.category.team_size === 2 && !d.reg.partner_name?.trim();

function pairingDate(d: EmailData): string | null {
  return d.tournament.event_date ? longDate(addDays(d.tournament.event_date, -2), { year: false }) : null;
}

function peopleRows(d: EmailData): [string, string][] {
  if (!needsPartner(d)) return [[d.category.team_size === 2 ? "Players" : "Player", players(d)]];
  return [["Player", players(d)], ["Partner", "To be paired. We'll match you with another player if one is available."]];
}

function players(d: EmailData): string {
  const names = [d.reg.player_name, d.reg.partner_name].filter((n): n is string => !!n?.trim()).map(esc);
  return names.join(" &amp; ");
}

function paymentRow(reg: EmailRegistration): [string, string] {
  const amt = money(reg.amount_due_cents);
  if (reg.payment_method === "card") return ["Payment", `${amt ? `${amt} · ` : ""}Paid by card (shows on your statement as ${STATEMENT_NAME})`];
  const ref = reg.payment_reference?.trim();
  return ["Payment", `${amt ? `${amt} · ` : ""}e-Transfer${ref ? ` (ref ${esc(ref)})` : ""}`];
}

function drawStep(n: number, d: EmailData): Step {
  const t = d.tournament;
  const by = t.event_date ? longDate(addDays(t.event_date, -1), { year: false }) : null;
  return {
    n,
    gif: "step-draw.gif",
    alt: "Draw bracket filling in",
    title: "Watch for the draw",
    html: (needsPartner(d) && pairingDate(d)
      ? `Partner pairings are posted by <strong style="color:${C.bone}">${esc(pairingDate(d)!)}</strong>, and draws and start times` +
        `${by ? ` by <strong style="color:${C.bone}">${esc(by)}</strong>` : " before the event"}. `
      : `Draws and start times are published${by ? ` by <strong style="color:${C.bone}">${esc(by)}</strong>` : " before the event"}. `) +
      `You'll know your first match and court before you leave home.`,
  };
}

const NO_SHOW_RULE = "A player who isn't on court 10 minutes after their match is called loses it by default.";

function arriveStep(n: number, d: EmailData): Step {
  const rules = safeUrl(d.tournament.rules_url);
  return {
    n,
    gif: "step-arrive.gif",
    alt: "Shuttle flying over the net",
    title: "Arrive 30 minutes early",
    html: `Check in at the desk, warm up, and bring non-marking court shoes. ${NO_SHOW_RULE}`,
    cta: rules ? [rules, "Read the rules"] : undefined,
  };
}

// HTML fragment → plain text for the text/plain part.
const strip = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function textBlock(lines: (string | null | false | undefined)[]): string {
  return lines.filter((l) => l !== null && l !== false && l !== undefined).join("\n");
}

function textFooter(t: EmailTournament): string {
  return textBlock([
    "",
    "EVENT DAY",
    t.name,
    [longDate(t.event_date), clockTime(t.event_time)].filter(Boolean).join(" · ") || null,
    t.venue_name,
    t.venue_address,
    safeUrl(t.venue_map_url) && `Directions: ${safeUrl(t.venue_map_url)}`,
    safeUrl(t.rules_url) && `Rules: ${safeUrl(t.rules_url)}`,
    safeUrl(t.waiver_url) && `Waiver: ${safeUrl(t.waiver_url)}`,
    "",
    t.contact_info?.trim() || null,
    "",
    "Questions? Reply to this email and it reaches the tournament directors.",
  ]);
}

// ---------- the two emails ----------

export function registrationReceived(d: EmailData): RenderedEmail {
  const t = d.tournament;
  const isPartner = d.role === "partner";
  const name = firstName(isPartner ? d.reg.partner_name ?? "" : d.reg.player_name) || "there";
  const paidCard = d.reg.payment_method === "card";
  const waiverLink = isPartner ? safeUrl(d.waiverLink) : null;

  const subject = isPartner
    ? `${d.reg.player_name.trim()} entered you in ${d.category.name}: ${t.name}`
    : `We've got your registration: ${t.name}`;

  const intro = isPartner
    ? `<strong style="color:${C.bone}">${esc(d.reg.player_name)}</strong> has entered you as their partner in ` +
      `<strong style="color:${C.bone}">${esc(d.category.name)}</strong> at ${esc(t.name)}.` +
      (waiverLink ? " There's one thing only you can do before you play: accept the waiver." : "")
    : `Thanks for entering <strong style="color:${C.bone}">${esc(d.category.name)}</strong> at ${esc(t.name)}. ` +
      (paidCard
        ? "Your payment went through. A tournament director checks every entry and you'll get a “You're in” email once it's confirmed."
        : "A tournament director will match your e-Transfer and confirm your place. You'll get a “You're in” email when it's done.");

  const step1: Step = isPartner && waiverLink
    ? {
      n: 1,
      gif: "step-received.gif",
      alt: "Entry received checkmark",
      title: "Accept the waiver",
      html: "Read the competition regulations and accept the waiver. It takes about two minutes. " +
        "If you're under 19, a parent or guardian accepts for you.",
      cta: [waiverLink, "Accept the waiver"],
    }
    : {
      n: 1,
      gif: "step-received.gif",
      alt: "Entry received checkmark",
      title: isPartner ? "Your entry is in" : "We've got your entry",
      html: isPartner
        ? `${esc(firstName(d.reg.player_name))} has submitted the entry for you both. You'll get a “You're in” email once a director confirms it.`
        : paidCard
        ? "Your payment is received. There's nothing else you need to do: we'll email you as soon as your place is confirmed."
        : "Your e-Transfer reference is on file. There's nothing else you need to do: we'll email you as soon as your place is confirmed.",
    };
  if (!isPartner && d.partnerWaiverPending) {
    step1.html += " We've also emailed your partner a link to accept the waiver; your entry is confirmed once they do.";
  }

  const details: [string, string][] = [
    ["Event", esc(d.category.name)],
    ...peopleRows(d),
    paymentRow(d.reg),
    ["Status", isPartner && waiverLink ? "Waiting for your waiver" : paidCard ? "Paid · awaiting confirmation" : "Awaiting confirmation"],
  ];

  const steps = [step1, drawStep(2, d), arriveStep(3, d)];
  const html = layout({
    title: subject,
    preheader: isPartner
      ? `${firstName(d.reg.player_name)} entered you in ${d.category.name}.${waiverLink ? " Accept the waiver to play." : ""}`
      : `Entry received for ${d.category.name}. Here's what happens next.`,
    hero: { gif: "hero.gif", alt: `${t.name}. Registration received.` },
    kicker: isPartner ? "You've been entered" : paidCard ? "Payment received" : "Registration received",
    heading: isPartner ? `You're on the team, ${esc(name)}.` : `You're on the list, ${esc(name)}.`,
    intro,
    details,
    stepsHeading: "Your next three steps",
    steps,
    data: d,
  });

  const text = textBlock([
    `Hi ${name},`,
    "",
    strip(intro),
    "",
    ...details.map(([k, v]) => `${k}: ${strip(v)}`),
    "",
    "YOUR NEXT THREE STEPS",
    ...steps.flatMap((s) => [
      "",
      `${s.n}. ${s.title}`,
      strip(s.html),
      s.cta ? `${s.cta[1]}: ${s.cta[0]}` : null,
    ]),
    textFooter(d.tournament),
  ]);
  return { subject, html, text };
}

export function registrationApproved(d: EmailData): RenderedEmail {
  const t = d.tournament;
  const isPartner = d.role === "partner";
  const name = firstName(isPartner ? d.reg.partner_name ?? "" : d.reg.player_name) || "there";
  const subject = `You're in! ${d.category.name} at ${t.name}`;
  const when = longDate(t.event_date);
  const intro = `Your entry in <strong style="color:${C.bone}">${esc(d.category.name)}</strong> is confirmed` +
    `${d.category.team_size === 2 && d.reg.partner_name ? ` with ${esc(isPartner ? d.reg.player_name : d.reg.partner_name)}` : ""}. ` +
    (needsPartner(d)
      ? `We'll pair you with another player if one is available; pairings are posted by ${esc(pairingDate(d) ?? "the draw")}. `
      : "") +
    `See you on court${when ? ` on ${esc(when)}` : ""}.`;
  const details: [string, string][] = [
    ["Event", esc(d.category.name)],
    ...peopleRows(d),
    paymentRow(d.reg),
    ["Status", `<span style="color:${C.volt};font-weight:700">Confirmed</span>`],
  ];
  const steps = [drawStep(1, d), arriveStep(2, d)];
  const html = layout({
    title: subject,
    preheader: `Your place in ${d.category.name} is confirmed. Add it to your calendar.`,
    hero: { gif: "approved.gif", alt: `You're in. ${t.name}.` },
    kicker: "Entry confirmed",
    heading: `You're in, ${esc(name)}.`,
    intro,
    details,
    stepsHeading: "Before the big day",
    steps,
    data: d,
  });
  const text = textBlock([
    `Hi ${name},`,
    "",
    strip(intro),
    "",
    ...details.map(([k, v]) => `${k}: ${strip(v)}`),
    "",
    "BEFORE THE BIG DAY",
    ...steps.flatMap((s) => ["", `${s.n}. ${s.title}`, strip(s.html), s.cta ? `${s.cta[1]}: ${s.cta[0]}` : null]),
    calendarUrl(t) && `\nAdd to calendar: ${calendarUrl(t)}`,
    textFooter(d.tournament),
  ]);
  return { subject, html, text };
}

// ---------- invitation to WhatsApp updates ----------
//
// For people who entered before the opt-in button existed (whatsapp-invite).
// One email per person, with their own code: the button opens WhatsApp with
// `message` typed in, and sending it opts them in (whatsapp-inbound).

export type WhatsAppInviteData = {
  tournament: EmailTournament;
  invitee: {
    name: string;
    role: "player" | "partner";
    categories: string[];          // the entry the code belongs to comes first
    other: string | null;          // player: their partner; partner: who entered them
    otherInvited: boolean;         // player: their partner gets an invitation too
    code: string;
  };
  message: string;                 // typed in for them (optinMessage)
  link: string;                    // wa.me link carrying `message` (optinLink)
  clubName: string;                // the name on the club's WhatsApp profile
  clubNumber: string;              // "+91 98183 38393"
  signoff?: string | null;         // "Ashish & Rakesh"
  sender?: string | null;          // "Club · street, city": printed under the card
  assetBase: string;
  privacyUrl?: string | null;
};

const strong = (html: string) => `<strong style="color:${C.bone}">${html}</strong>`;
const nowrap = (html: string) => `<span style="white-space:nowrap">${html}</span>`;
const monoCode = (code: string) => `<span style="font-family:${MONO};font-weight:500;white-space:nowrap">${esc(code)}</span>`;

// "Fri Nov 20"
const shortDay = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  return `${f({ weekday: "short" })} ${f({ month: "short" })} ${f({ day: "numeric" })}`;
};

// On phones the heading is two lines, "Want WhatsApp" / "updates, Priya?".
// So the name doesn't drop to a line of its own, the size is picked per name:
// 34px like the other emails when it fits, else 32 or 30 (h-classes, 375px
// wide) or down to 28 (n-classes, 360px). Names too long for that lead
// instead: "Sukhwinder, want" / "WhatsApp updates?". Widths are Archivo 800
// advances at 100px; anything unlisted counts as wide, and an unlucky name
// still wraps at a space rather than overflowing.
const ARCHIVO_800: Record<string, number> = {
  a: 61.6, b: 63.3, c: 61.2, d: 63.3, e: 61.9, f: 35.2, g: 63.2, h: 62.9, i: 28.8, j: 28.6, k: 61, l: 28.8, m: 93.7,
  n: 62.9, o: 63.5, p: 63.3, q: 63.3, r: 40.7, s: 57.9, t: 38.5, u: 62.9, v: 57.4, w: 85.9, x: 61.2, y: 57.4, z: 53.5,
  A: 74.6, B: 74.5, C: 75.2, D: 75.5, E: 69.9, F: 64.1, G: 81.5, H: 78.7, I: 32.9, J: 63, K: 77, L: 62.3, M: 91.4,
  N: 78.7, O: 81, P: 69.8, Q: 81, R: 75, S: 69.7, T: 67.5, U: 78.3, V: 72.9, W: 97.9, X: 73.6, Y: 73.2, Z: 68.2,
  " ": 18.9, ",": 31.8, "?": 61.2, "'": 26.3, "’": 27.9, "-": 33.3, ".": 31.8,
};
const headingWidth = (s: string, px: number) => [...s].reduce((w, ch) => w + (ARCHIVO_800[ch] ?? 66) * px / 100 - 0.5, 0);

function inviteHeading(first: string): { cls: string; html: string } {
  const lines = { want: ["Want WhatsApp", `updates, ${first}?`], lead: [`${first}, want`, "WhatsApp updates?"] };
  const fits = (k: keyof typeof lines, px: number, col: number) => lines[k].every((l) => headingWidth(l, px) <= col);
  const kind = [34, 32, 30].some((px) => fits("want", px, 304)) || ![34, 32, 30].some((px) => fits("lead", px, 304))
    ? "want"
    : "lead";
  const at375 = [34, 32, 30].find((px) => fits(kind, px, 304)) ?? 34;
  const at360 = [34, 32, 30, 28].find((px) => fits(kind, px, 290)) ?? 28;
  const cls = [at375 !== 34 && `h${at375}`, at360 !== at375 && `n${at360}`].filter(Boolean).join(" ");
  const n = esc(first);
  return { cls, html: kind === "want" ? `Want WhatsApp<br>updates, ${n}?` : `${n}, want<br>WhatsApp updates?` };
}

// `when` is the card's key ("Fri Nov 20"); `whenText` the plain-text one.
type ScheduleRow = { when: string; whenText?: string; what: string; detail?: string; extra?: string; accent?: boolean };

// When each message arrives: a mono key and a bold line with detail under it.
// The key and the text are inline-blocks, side by side on desktop and stacked
// on phones by themselves (no media query needed); Outlook gets two columns
// from the conditional table.
function scheduleCard(rows: ScheduleRow[]): string {
  const body = rows.map((r, i) =>
    `<tr><td class="wrow" style="padding:12px 20px 14px;${i ? `border-top:1px solid ${C.line};` : ""}">` +
    `<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="110" valign="top"><![endif]-->` +
    `<div style="display:inline-block;width:110px;vertical-align:top;padding-top:3px;font-family:${MONO};font-size:11px;line-height:1.5;` +
    `letter-spacing:2px;text-transform:uppercase;color:${C.mute};white-space:nowrap">${esc(r.when)}</div>` +
    `<!--[if mso]></td><td valign="top"><![endif]-->` +
    `<div style="display:inline-block;width:100%;max-width:360px;vertical-align:top;font-family:${SANS};font-size:15px;color:${C.bone}">` +
    `<div style="font-weight:700;line-height:1.4;color:${r.accent ? C.volt : C.bone}">${r.what}</div>` +
    (r.detail ? `<div style="margin-top:3px;font-size:14px;line-height:1.55;color:${C.body}">${r.detail}</div>` : "") +
    (r.extra ?? "") +
    `</div><!--[if mso]></td></tr></table><![endif]--></td></tr>`
  ).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" ` +
    `style="background:${C.card};border:1px solid ${C.line};border-radius:14px;border-collapse:separate">${body}</table>`;
}

const tenMinutes =
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px"><tr>` +
  `<td style="padding:1px 12px 0 0;vertical-align:top;font-family:${MONO};font-size:12px;font-weight:500;line-height:1.6;` +
  `letter-spacing:1px;color:${C.volt};white-space:nowrap">10&nbsp;MIN</td>` +
  `<td style="vertical-align:top;font-family:${SANS};font-size:14px;line-height:1.55;color:${C.body}">${esc(NO_SHOW_RULE)}</td></tr></table>`;

// What WhatsApp shows after the tap: the club's chat with the message waiting
// in the compose box. Live text; the message and the send arrow are links
// too, so nothing here is a dead control.
function composePreview(d: WhatsAppInviteData): string {
  const { message, link, invitee } = d;
  const at = message.lastIndexOf(invitee.code);
  const msg = at < 0 ? esc(message) : esc(message.slice(0, at)) +
    `<span style="font-family:${MONO};font-weight:500;color:${C.volt};white-space:nowrap">${esc(invitee.code)}</span>` +
    esc(message.slice(at + invitee.code.length));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" ` +
    `style="background:${C.card};border:1px solid ${C.line};border-radius:14px;border-collapse:separate">` +
    `<tr><td style="padding:14px 18px;border-bottom:1px solid ${C.line}">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td width="40" style="width:40px;vertical-align:middle">` +
    `<img src="${esc(`${d.assetBase}/whatsapp-avatar.png`)}" width="40" height="40" alt="" ` +
    `style="display:block;width:40px;height:40px;border:0;border-radius:999px"></td>` +
    `<td style="padding-left:12px;vertical-align:middle">` +
    `<div style="font-family:${SANS};font-size:15px;line-height:1.3;font-weight:700;color:${C.bone}">${esc(d.clubName)}</div>` +
    `<div style="font-family:${MONO};font-size:12px;line-height:1.5;letter-spacing:0.5px;color:${C.mute};white-space:nowrap">${esc(d.clubNumber)}</div>` +
    `</td></tr></table></td></tr>` +
    `<tr><td class="cmp" style="padding:15px 18px 18px">` +
    `<div style="font-family:${MONO};font-size:11px;line-height:1.4;letter-spacing:2px;text-transform:uppercase;color:${C.mute};margin:0 0 9px">Typed in for you</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="vertical-align:bottom">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink}" ` +
    `style="background:${C.ink};border:1px solid ${C.olive};border-radius:20px;border-collapse:separate"><tr>` +
    `<td style="padding:10px 14px;font-family:${SANS};font-size:15px;line-height:1.55;color:${C.bone}">` +
    `<a href="${esc(link)}" style="color:${C.bone};text-decoration:none">${msg}</a></td></tr></table></td>` +
    `<td width="50" style="width:50px;padding-left:10px;vertical-align:bottom">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td width="40" height="40" align="center" valign="middle" bgcolor="${C.volt}" style="width:40px;height:40px;border-radius:999px;text-align:center;vertical-align:middle">` +
    `<a href="${esc(link)}" title="Send it in WhatsApp" aria-label="Send it in WhatsApp" style="display:block;width:40px;height:40px;font-family:${SANS};font-size:20px;` +
    `line-height:40px;font-weight:800;color:${C.ink};text-align:center;text-decoration:none">&rarr;</a></td>` +
    `</tr></table></td></tr></table></td></tr></table>`;
}

const codeChip = (code: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0"><tr>` +
  `<td class="chip" bgcolor="${C.card}" style="background:${C.card};border:1px dashed ${C.oliveDash};border-radius:10px;padding:12px 18px;` +
  `font-family:${MONO};font-size:16px;line-height:1.4;letter-spacing:1px;color:${C.bone}">` +
  `My code: <span style="color:${C.volt};font-weight:500;white-space:nowrap">${esc(code)}</span></td></tr></table>`;

export function whatsappInvite(d: WhatsAppInviteData): RenderedEmail {
  const t = d.tournament;
  const i = d.invitee;
  const isPartner = i.role === "partner";
  const first = firstName(i.name) || "there";
  const other = i.other?.trim() || null;
  const otherFirst = other ? firstName(other) : null;
  const event = i.categories.find(Boolean) ?? null;
  const number = esc(d.clubNumber);
  const privacy = safeUrl(d.privacyUrl);

  const subject = isPartner
    ? `${first}, get your own court calls on WhatsApp: ${t.name}`
    : `${first}, get your court calls on WhatsApp: ${t.name}`;
  const preheader = isPartner && otherFirst
    ? `You have your own code, separate from ${otherFirst}'s. Tap once, then press Send.`
    : "A reminder the evening before and a message the moment your court is ready. Tap once, then press Send.";

  const intro = isPartner && other
    ? `${strong(esc(other))} entered you as their partner${event ? ` in ${strong(esc(event))}` : ""}. ` +
      `You have your own code for WhatsApp updates, so you can sign up whether or not ${nowrap(`${esc(otherFirst!)} does.`)}`
    : "We added WhatsApp updates after you registered. If you'd like them, we'll message you the evening before, " +
      "and again the moment your court is ready.";
  // Players are in BC, so a number from elsewhere gets one plain line.
  const abroad = d.clubNumber.startsWith("+1 ") ? ""
    : ` It's ${d.clubNumber.startsWith("+91 ") ? "an Indian" : "an international"} number; WhatsApp messages to it cost nothing extra.`;
  const underButton = `WhatsApp opens a chat with ${esc(d.clubName)} on ${strong(nowrap(number))} with your message typed in.` +
    `${abroad} We only message you after you ${nowrap("press Send.")}`;

  // As the confirmation reply, whatsapp-reminders and notify-court-allocated
  // word them; the reminder goes out 6 to 9 pm (queue_whatsapp_reminders).
  const eve = t.event_date ? addDays(t.event_date, -1) : null;
  const schedule: ScheduleRow[] = [
    { when: "Right away", what: "A reply to confirm you're signed up" },
    {
      when: eve ? shortDay(eve) : "Evening before",
      whenText: longDate(eve, { year: false }) ?? "The evening before",
      what: "A reminder the evening before",
      detail: "Between 6 and 9&nbsp;pm Pacific, with the start time, the venue and a map link.",
    },
    {
      when: t.event_date ? shortDay(t.event_date) : "Event day",
      whenText: longDate(t.event_date, { year: false }) ?? "On the day",
      what: "A message when your court is ready",
      detail: "Sent the moment a director puts your match on a court, with the court number and who you're playing. " +
        "One for each match.",
      extra: tenMinutes,
      accent: true,
    },
    { when: "Any time", what: "Reply STOP to turn them off", detail: "Send START to turn them back on." },
  ];
  const allWeSend = "That's all we send. No promotions.";

  const steps: Step[] = [
    {
      n: 1,
      visual: composePreview(d),
      title: "Tap, then press Send",
      html: `Your code, ${strong(monoCode(i.code))}, is in the message so we know it's you. ` +
        "Updates go to the phone you send it from.",
      cta: [d.link, "Get updates on WhatsApp"],
      wideCta: true,
    },
    {
      n: 2,
      gif: "step-received.gif",
      alt: "",
      title: "Look for our reply",
      html: `It comes from ${esc(d.clubName)}, usually within a minute. If nothing arrives, reply to this email and we'll look into it.`,
    },
  ];
  const fallback = "On a computer? Open this email on your phone and tap the button. " +
    `Or, in WhatsApp on your phone, send this to ${strong(nowrap(number))}:`;

  const goodToKnow = [
    `Court calls still come by email either way, and by push if you've turned it on. ${nowrap("WhatsApp is extra.")}`,
    // Up to 3 chats per code: MAX_CHATS_PER_ENTRY in whatsapp-inbound.
    `Up to 3 phones can use your code, so a player and a parent can both sign up. It's fine to forward ${nowrap("this email.")}`,
    !isPartner && other && i.otherInvited ? `${esc(other)} gets their own invitation and code.` : null,
    "We use your number only to send these tournament updates." +
      (privacy ? ` See our <a href="${esc(privacy)}" style="color:${C.bone};text-decoration:underline">privacy policy</a>.` : ""),
  ].filter((h): h is string => !!h);

  const heading = inviteHeading(first);
  const note = `You're receiving this one-time email because you were entered in ${esc(t.name)}.` +
    (d.sender?.trim() ? `<br>${d.sender.split(" · ").map((s) => nowrap(esc(s.trim()))).join(" · ")}` : "");

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:0;background:${C.ink}}
  a{color:${C.bone}}
  a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}
  @media (max-width:620px){ .px{padding-left:20px!important;padding-right:20px!important} h1{font-size:34px!important}
    h1.h32{font-size:32px!important} h1.h30{font-size:30px!important}
    .wrow{padding:12px 18px 13px!important} .cmp{padding:14px 14px 16px!important} .box{padding:20px 18px 22px!important}
    .cta{display:table!important;width:100%!important;margin-right:0!important} .cta a{display:block!important;text-align:center!important} }
  @media (max-width:374px){ h1.n32{font-size:32px!important} h1.n30{font-size:30px!important} h1.n28{font-size:28px!important} }
  @media (max-width:340px){ h1,h1.h32,h1.h30,h1.n32,h1.n30,h1.n28{font-size:28px!important}
    .cta a{padding-left:12px!important;padding-right:12px!important;letter-spacing:0.5px!important} .chip{padding:10px 12px!important;letter-spacing:0!important} }
</style>
</head>
<body style="margin:0;padding:0;background:${C.ink}" bgcolor="${C.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.ink};mso-hide:all">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink}" style="background:${C.ink}">
<tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink2}" style="width:100%;max-width:600px;background:${C.ink2};border-radius:18px;overflow:hidden">
  <tr><td style="padding:0"><img src="${esc(`${d.assetBase}/whatsapp-hero.gif`)}" width="600" alt="${esc(`Your court call, on your phone. ${t.name}.`)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;background:${C.ink2};font-family:${SANS};font-size:16px;line-height:1.4;color:${C.bone}"></td></tr>
  <tr><td class="px" style="padding:36px 32px 8px">
    ${kicker("WhatsApp updates · optional")}
    <h1${heading.cls ? ` class="${heading.cls}"` : ""} style="margin:0 0 16px;font-family:${SANS};font-size:40px;line-height:1.05;font-weight:800;letter-spacing:-0.5px;color:${C.bone};overflow-wrap:break-word;word-wrap:break-word;word-break:break-word">${heading.html}</h1>
    ${p(intro)}
  </td></tr>
  <tr><td class="px" style="padding:0 32px 40px">
    ${button(d.link, "Get updates on WhatsApp", true, "cta")}
    ${p(underButton, "margin:16px 0 0")}
  </td></tr>
  <tr><td class="px" style="padding:0 32px 20px">
    <h2 style="margin:0;font-family:${SANS};font-size:28px;line-height:1.15;font-weight:800;color:${C.bone}">What you'll get</h2>
  </td></tr>
  <tr><td class="px" style="padding:0 32px 14px">${scheduleCard(schedule)}</td></tr>
  <tr><td class="px" style="padding:0 32px 40px">${p(esc(allWeSend), `margin:0;font-size:14px;color:${C.mute}`)}</td></tr>
  <tr><td class="px" style="padding:0 32px 20px">
    <h2 style="margin:0;font-family:${SANS};font-size:28px;line-height:1.15;font-weight:800;color:${C.bone}">How to sign up</h2>
  </td></tr>
  ${steps.map((s) => stepBlock(s, d.assetBase)).join("")}
  <tr><td class="px" style="padding:0 32px 34px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink}" style="background:${C.ink};border:1px solid ${C.line};border-radius:14px;border-collapse:separate">
      <tr><td class="box" style="padding:22px 22px 24px">
        ${kicker("If WhatsApp doesn't open")}
        ${p(fallback, "margin:0")}
        ${codeChip(i.code)}
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="px" style="padding:4px 32px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line}">
      <tr><td style="padding-top:28px">
        ${kicker("Good to know")}
        ${goodToKnow.map((h) => p(h, "margin:0 0 8px;font-size:14px;line-height:1.6")).join("")}
      </td></tr>
    </table>
  </td></tr>
  ${d.signoff?.trim() ? `<tr><td class="px" style="padding:4px 32px 30px">
    ${p("See you on court,", "margin:0 0 2px")}
    <div style="font-family:${SANS};font-size:20px;line-height:1.3;font-weight:700;color:${C.bone}">${esc(d.signoff.trim())}</div>
  </td></tr>` : ""}
  ${cardEnd(t, d.privacyUrl, false)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
<div style="font-family:${SANS};font-size:11px;line-height:1.6;color:${C.mute};padding:16px 12px">${note}</div>
</td></tr>
</table>
</body>
</html>`;

  const text = textBlock([
    `Hi ${first},`,
    "",
    strip(intro),
    "",
    "To sign up, open this link on your phone, then press Send in WhatsApp:",
    d.link,
    "",
    strip(underButton),
    "",
    "WHAT YOU'LL GET",
    ...schedule.flatMap((r) => [
      "",
      `${r.whenText ?? r.when}: ${r.what.charAt(0).toLowerCase()}${r.what.slice(1)}.`,
      r.detail ? strip(r.detail) : null,
      r.extra ? NO_SHOW_RULE : null,
    ]),
    "",
    allWeSend,
    "",
    "HOW TO SIGN UP",
    "",
    "1. Open the link, then press Send",
    `WhatsApp opens a chat with ${d.clubName} with this message typed in:`,
    d.message,
    strip(steps[0].html),
    "",
    "2. Look for our reply",
    strip(steps[1].html),
    "",
    "IF WHATSAPP DOESN'T OPEN",
    "On a computer? Open this email on your phone and use the link above. " +
    `Or, in WhatsApp on your phone, send this to ${d.clubNumber}:`,
    `My code: ${i.code}`,
    "",
    "GOOD TO KNOW",
    ...goodToKnow.map((h) => strip(h).replace(" See our privacy policy.", privacy ? ` Privacy policy: ${privacy}` : "")),
    ...(d.signoff?.trim() ? ["", "See you on court,", d.signoff.trim()] : []),
    calendarUrl(t) && `\nAdd to calendar: ${calendarUrl(t)}`,
    textFooter(t),
    "",
    `You're receiving this one-time email because you were entered in ${t.name}.`,
    d.sender?.trim() || null,
  ]);
  return { subject, html, text };
}

// ---------- directors' alert for a new entry ----------

export type AdminEntryData = {
  tournament: { name: string };
  category: { name: string; team_size: number };
  reg: EmailRegistration & {
    player_email: string;
    player_phone: string | null;
    player_age: number | null;
    player_fee_type: string | null;
    partner_email: string | null;
    partner_phone: string | null;
    partner_age: number | null;
    partner_fee_type: string | null;
    comments: string | null;
    submitted_at: string;
  };
  waiverRequired: boolean;
  playerWaiver: boolean;
  partnerWaiver: boolean;
  adminUrl: string;
};

const FEE: Record<string, string> = { youth: "youth rate", student: "student rate (check ID)" };

function person(name: string | null, email: string | null, phone: string | null, age: number | null, fee: string | null) {
  const bits = [
    name ? `<strong style="color:${C.bone}">${esc(name)}</strong>` : null,
    email ? `<a href="mailto:${esc(email)}" style="color:${C.bone}">${esc(email)}</a>` : null,
    phone ? esc(phone) : null,
    [age !== null ? `age ${age}` : null, fee && FEE[fee] ? FEE[fee] : null].filter(Boolean).join(" · ") || null,
  ].filter(Boolean);
  return bits.join("<br>");
}

export function adminNewEntry(d: AdminEntryData): RenderedEmail {
  const r = d.reg;
  const card = r.payment_method === "card";
  const amt = money(r.amount_due_cents);
  const ref = r.payment_reference?.trim();
  const subject = `New entry: ${r.player_name.trim()}${r.partner_name ? ` & ${r.partner_name.trim()}` : ""} · ${d.category.name}` +
    (card ? " · paid" : " · e-Transfer to match");
  const when = new Date(r.submitted_at).toLocaleString("en-CA", {
    timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const todo = card
    ? `Paid by card${amt ? ` (${amt})` : ""}. Review it and approve.`
    : `Look for an e-Transfer of <strong style="color:${C.bone}">${esc(amt ?? "the entry fee")}</strong>` +
      `${ref ? ` with reference <strong style="color:${C.bone}">${esc(ref)}</strong>` : ""}, then approve.`;
  const waiver = (ok: boolean) => ok ? `<span style="color:${C.volt}">Accepted</span>` : "Pending";
  const rows: [string, string][] = [
    ["Event", esc(d.category.name)],
    ["Player", person(r.player_name, r.player_email, r.player_phone, r.player_age, r.player_fee_type)],
    ...(r.partner_name || r.partner_email
      ? [["Partner", person(r.partner_name, r.partner_email, r.partner_phone, r.partner_age, r.partner_fee_type)] as [string, string]]
      : d.category.team_size === 2 ? [["Partner", "None named (looking for a partner)"] as [string, string]] : []),
    paymentRow(r),
    ...(d.waiverRequired
      ? [["Waiver", `Player: ${waiver(d.playerWaiver)}${r.partner_name || r.partner_email ? ` · Partner: ${waiver(d.partnerWaiver)}` : ""}`] as [string, string]]
      : []),
    ...(r.comments?.trim() ? [["Comments", esc(r.comments.trim()).replace(/\r?\n/g, "<br>")] as [string, string]] : []),
    ["Submitted", esc(when)],
  ];
  const admin = safeUrl(d.adminUrl);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>${esc(subject)}</title>
<style>body{margin:0;padding:0;background:${C.ink}} @media (max-width:620px){ .px{padding-left:20px!important;padding-right:20px!important}
  .k{width:76px!important;padding:12px 8px 12px 14px!important;letter-spacing:1px!important} .v{padding:12px 14px 12px 8px!important} }</style>
</head>
<body style="margin:0;padding:0;background:${C.ink}" bgcolor="${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ink2}" style="width:100%;max-width:600px;background:${C.ink2};border-radius:18px">
  <tr><td class="px" style="padding:32px 32px 8px">
    ${kicker(`${d.tournament.name} · directors`)}
    <h1 style="margin:0 0 14px;font-family:${SANS};font-size:30px;line-height:1.1;font-weight:800;color:${C.bone}">New entry: ${esc(firstName(r.player_name))}${r.partner_name ? ` &amp; ${esc(firstName(r.partner_name))}` : ""}</h1>
    ${p(todo)}
  </td></tr>
  <tr><td class="px" style="padding:8px 32px 28px">${detailsCard(rows)}</td></tr>
  ${admin ? `<tr><td class="px" style="padding:0 32px 32px">${button(admin, "Open the admin app")}</td></tr>` : ""}
  <tr><td class="px" style="padding:20px 32px;border-top:1px solid ${C.line}">
    ${p("Reply to this email to write to the player directly. The player has been sent their own confirmation.", `font-size:13px;color:${C.mute};margin:0`)}
  </td></tr>
</table></td></tr></table>
</body></html>`;
  const text = textBlock([
    `New entry for ${d.tournament.name}`,
    "",
    strip(todo),
    "",
    ...rows.map(([k, v]) => `${k}: ${strip(v.replace(/<br>/g, ", "))}`),
    "",
    admin && `Admin app: ${admin}`,
    "Reply to this email to write to the player directly.",
  ]);
  return { subject, html, text };
}
