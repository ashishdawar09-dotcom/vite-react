// Registration emails: "We've got your registration" (on submit, or once a
// card payment completes) and "You're in" (when an admin approves). Pure
// rendering: everything comes in through EmailData, nothing is fetched here.
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
  // Partner only, when each partner pays their own share: "due" until they
  // enter themselves (the only way to pay), "entered" once their entry is in.
  partnerShare?: "due" | "entered" | null;
  // The registration form for this event, where the partner pays that share.
  registerUrl?: string | null;
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

const button = (href: string, label: string, primary = true) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:6px 8px 0 0"><tr>` +
  `<td bgcolor="${primary ? C.volt : C.ink}" style="border-radius:999px;${primary ? "" : `border:1px solid ${C.line};`}">` +
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

type Step = { n: number; gif: string; alt: string; title: string; html: string; cta?: [string, string] };

function stepBlock(s: Step, assetBase: string): string {
  return `<tr><td class="px" style="padding:0 32px 36px">` +
    `<img src="${esc(`${assetBase}/${s.gif}`)}" width="536" alt="${esc(s.alt)}" ` +
    `style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:14px;background:${C.ink2}">` +
    `<div style="font-family:${MONO};font-size:12px;letter-spacing:3px;color:${C.volt};margin:20px 0 6px">STEP ${String(s.n).padStart(2, "0")}</div>` +
    `<div style="font-family:${SANS};font-size:24px;line-height:1.2;font-weight:700;color:${C.bone};margin:0 0 10px">${esc(s.title)}</div>` +
    p(s.html, "margin:0") +
    (s.cta ? `<div style="margin-top:14px">${button(s.cta[0], s.cta[1])}</div>` : "") +
    `</td></tr>`;
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
  const when = [longDate(t.event_date), clockTime(t.event_time)].filter(Boolean).join(" · ");
  const map = safeUrl(t.venue_map_url);
  const cal = calendarUrl(t);
  const rules = safeUrl(t.rules_url);
  const waiver = safeUrl(t.waiver_url);
  const privacy = safeUrl(o.data.privacyUrl);
  const contacts = (t.contact_info ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => esc(l)).join("<br>");
  const footLinks = [
    rules && `<a href="${esc(rules)}" style="color:${C.mute};text-decoration:underline">Rules</a>`,
    waiver && `<a href="${esc(waiver)}" style="color:${C.mute};text-decoration:underline">Waiver</a>`,
    privacy && `<a href="${esc(privacy)}" style="color:${C.mute};text-decoration:underline">Privacy</a>`,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

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
  <tr><td class="px" style="padding:4px 32px 36px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line}">
      <tr><td style="padding-top:28px">
        ${kicker("Event day")}
        <div style="font-family:${SANS};font-size:20px;font-weight:700;color:${C.bone};margin:0 0 6px">${esc(t.name)}</div>
        ${when ? p(esc(when), "margin:0 0 4px;color:" + C.bone) : ""}
        ${t.venue_name ? p(esc(t.venue_name), "margin:0") : ""}
        ${t.venue_address ? p(esc(t.venue_address), `margin:0 0 14px;color:${C.mute};font-size:14px`) : ""}
        <div>${map ? button(map, "Directions") : ""}${cal ? button(cal, "Add to calendar", false) : ""}</div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="px" bgcolor="${C.ink}" style="padding:28px 32px;background:${C.ink};border-top:1px solid ${C.line}">
    ${contacts ? p(contacts, `font-size:13px;color:${C.mute}`) : ""}
    ${p("Questions? Just reply to this email and it reaches the tournament directors.", `font-size:13px;color:${C.mute}`)}
    ${footLinks ? p(footLinks, `font-size:13px;color:${C.mute};margin:0`) : ""}
  </td></tr>
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

// The partner's copy when each pays their own share: the entry's payment is
// the other player's, so say whose it is and where their own share stands.
function paymentRows(d: EmailData): [string, string][] {
  if (d.role !== "partner" || !d.partnerShare) return [paymentRow(d.reg)];
  return [
    [`${firstName(d.reg.player_name)}'s share`, paymentRow(d.reg)[1]],
    ["Your share", d.partnerShare === "due" ? "Not paid yet" : "On your own entry"],
  ];
}

function payShareStep(n: number, d: EmailData): Step {
  const url = safeUrl(d.registerUrl);
  return {
    n,
    gif: "step-received.gif",
    alt: "Entry received checkmark",
    title: "Pay your share",
    html: `To pay it, register for <strong style="color:${C.bone}">${esc(d.category.name)}</strong> yourself and name ` +
      `<strong style="color:${C.bone}">${esc(d.reg.player_name)}</strong> as your partner. ` +
      "The same form has the waiver, so there's nothing else to sign. Your place is confirmed once both shares are in.",
    cta: url ? [url, "Pay your share"] : undefined,
  };
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

function arriveStep(n: number, d: EmailData): Step {
  const rules = safeUrl(d.tournament.rules_url);
  return {
    n,
    gif: "step-arrive.gif",
    alt: "Shuttle flying over the net",
    title: "Arrive 30 minutes early",
    html: `Check in at the desk, warm up, and bring non-marking court shoes. ` +
      `A player who isn't on court 10 minutes after their match is called loses it by default.`,
    cta: rules ? [rules, "Read the rules"] : undefined,
  };
}

// HTML fragment → plain text for the text/plain part.
const strip = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function textBlock(lines: (string | null | false | undefined)[]): string {
  return lines.filter((l) => l !== null && l !== false && l !== undefined).join("\n");
}

function textFooter(d: EmailData): string {
  const t = d.tournament;
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
  const shareDue = isPartner && d.partnerShare === "due";
  // Paying their share means filling in the form, which has the waiver.
  const waiverLink = isPartner && !shareDue ? safeUrl(d.waiverLink) : null;

  const subject = isPartner
    ? `${d.reg.player_name.trim()} entered you in ${d.category.name}: ${t.name}`
    : `We've got your registration: ${t.name}`;

  const intro = isPartner
    ? `<strong style="color:${C.bone}">${esc(d.reg.player_name)}</strong> has entered you as their partner in ` +
      `<strong style="color:${C.bone}">${esc(d.category.name)}</strong> at ${esc(t.name)}.` +
      (shareDue ? " They paid their own share; yours is still to pay." : "") +
      (waiverLink ? " There's one thing only you can do before you play: accept the waiver." : "")
    : `Thanks for entering <strong style="color:${C.bone}">${esc(d.category.name)}</strong> at ${esc(t.name)}. ` +
      (paidCard
        ? "Your payment went through. A tournament director checks every entry and you'll get a “You're in” email once it's confirmed."
        : "A tournament director will match your e-Transfer and confirm your place. You'll get a “You're in” email when it's done.");

  const step1: Step = shareDue
    ? payShareStep(1, d)
    : isPartner && waiverLink
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
      html: isPartner && d.partnerShare === "entered"
        ? `Your own entry is in too, so there's nothing else to pay. You'll get a “You're in” email once a director confirms it.`
        : isPartner
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
    ...paymentRows(d),
    ["Status", shareDue ? "Waiting for your share" : isPartner && waiverLink ? "Waiting for your waiver" : paidCard ? "Paid · awaiting confirmation" : "Awaiting confirmation"],
  ];

  const steps = [step1, drawStep(2, d), arriveStep(3, d)];
  const html = layout({
    title: subject,
    preheader: isPartner
      ? `${firstName(d.reg.player_name)} entered you in ${d.category.name}.` +
        (shareDue ? " Your share is still to pay." : waiverLink ? " Accept the waiver to play." : "")
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
    textFooter(d),
  ]);
  return { subject, html, text };
}

export function registrationApproved(d: EmailData): RenderedEmail {
  const t = d.tournament;
  const isPartner = d.role === "partner";
  const shareDue = isPartner && d.partnerShare === "due";
  const name = firstName(isPartner ? d.reg.partner_name ?? "" : d.reg.player_name) || "there";
  const subject = shareDue
    ? `One step left: pay your share for ${d.category.name} at ${t.name}`
    : `You're in! ${d.category.name} at ${t.name}`;
  const when = longDate(t.event_date);
  const intro = shareDue
    ? `${esc(d.reg.player_name)}'s entry in <strong style="color:${C.bone}">${esc(d.category.name)}</strong> is confirmed ` +
      "and your place on the team is held. Your share isn't paid yet."
    : `Your entry in <strong style="color:${C.bone}">${esc(d.category.name)}</strong> is confirmed` +
      `${d.category.team_size === 2 && d.reg.partner_name ? ` with ${esc(isPartner ? d.reg.player_name : d.reg.partner_name)}` : ""}. ` +
      (needsPartner(d)
        ? `We'll pair you with another player if one is available; pairings are posted by ${esc(pairingDate(d) ?? "the draw")}. `
        : "") +
      (isPartner && d.partnerShare === "entered" ? "Your own entry is in too; we'll email you when your share is confirmed. " : "") +
      `See you on court${when ? ` on ${esc(when)}` : ""}.`;
  const details: [string, string][] = [
    ["Event", esc(d.category.name)],
    ...peopleRows(d),
    ...paymentRows(d),
    ["Status", shareDue ? "Place held · waiting for your share" : `<span style="color:${C.volt};font-weight:700">Confirmed</span>`],
  ];
  const steps = shareDue ? [payShareStep(1, d), drawStep(2, d), arriveStep(3, d)] : [drawStep(1, d), arriveStep(2, d)];
  const html = layout({
    title: subject,
    preheader: shareDue
      ? `Your place in ${d.category.name} is held. Pay your share to confirm it.`
      : `Your place in ${d.category.name} is confirmed. Add it to your calendar.`,
    hero: { gif: "approved.gif", alt: `You're in. ${t.name}.` },
    kicker: shareDue ? "Almost there" : "Entry confirmed",
    heading: shareDue ? `One step left, ${esc(name)}.` : `You're in, ${esc(name)}.`,
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
    textFooter(d),
  ]);
  return { subject, html, text };
}

// Approval of the second half of a pair who each paid their own share. Both
// already had "You're in" from the first entry, so this only confirms the
// player's own payment. No calendar invite: they have one.
export function shareConfirmed(d: EmailData): RenderedEmail {
  const t = d.tournament;
  const name = firstName(d.reg.player_name) || "there";
  const subject = `Your share is paid: ${d.category.name} at ${t.name}`;
  const when = longDate(t.event_date);
  const intro = `Your share for <strong style="color:${C.bone}">${esc(d.category.name)}</strong> is confirmed. ` +
    `You${d.reg.partner_name ? ` and ${esc(d.reg.partner_name)}` : ""} are in, and there's nothing else to pay. ` +
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
    preheader: `Your share for ${d.category.name} is confirmed. Nothing else to pay.`,
    hero: { gif: "approved.gif", alt: `You're in. ${t.name}.` },
    kicker: "Share confirmed",
    heading: `You're all set, ${esc(name)}.`,
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
    textFooter(d),
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
