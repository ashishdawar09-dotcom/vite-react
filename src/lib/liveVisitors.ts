// Live "who's here right now" for the admin Players tab, without knowing who
// anyone is.
//
// Every open registration form, and every open page of the tournament's
// website, sends a small "visitor" message through Supabase Realtime's
// broadcast API: when it opens, every 30 s while it's in front, when the form
// step changes, when the page goes to the background, and "bye" when it
// closes. A message holds a random id made fresh for each page load (never
// stored), a counter, where the page is, whether it's in front and when it
// opened. No name, email, phone or cookie.
//
// Visitors only send (plain HTTPS requests); they never hold a Realtime
// connection, so a busy website can't use up the project's connections, which
// the admin app needs on race day. Only admins listen.
//
// The website's sender is a copy of this contract: shuttlestorm-site/public/live.js.

import type { StepKey } from "../features/publicRegistration/multiEntry";

export const VISITOR_EVENT = "visitor";
/** How often an open page in front says it's still there. */
export const HEARTBEAT_MS = 30_000;
/** A page in front that has been silent this long is gone (closed without a "bye"). */
export const STALE_IN_FRONT_MS = 75_000;
/** A page in the background sends nothing; it counts as "away" this long. */
export const STALE_AWAY_MS = 5 * 60_000;

export const formTopic = (tournamentId: string) => `reg-form:${tournamentId}`;

/** The tournament's public website, where it has one. */
export const TOURNAMENT_SITE: Record<string, { topic: string }> = {
  // Shuttle Storm '26: shuttlestorm.adawar.org (public/live.js).
  "e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb": { topic: "site:shuttlestorm" },
  // Its rehearsal copy on the scratch project, used by the tests.
  "150c4fb7-5c02-4da5-8489-420938c0d394": { topic: "site:shuttlestorm-rehearsal" },
};

export type VisitorPing =
  | { id: string; n: number; at: string; visible: boolean; since: number }
  | { id: string; n: number; bye: true };

export type Visitor = { id: string; at: string; visible: boolean; since: number; seen: number };

export type VisitorList = { total: number; away: number; visitors: Visitor[] };

/** What one listener knows: who's here, and the last message number per id. */
export type VisitorBook = { here: Map<string, Visitor>; last: Map<string, { n: number; at: number }> };

export const newBook = (): VisitorBook => ({ here: new Map(), last: new Map() });

const ID = /^[A-Za-z0-9-]{8,64}$/;

// A "bye" goes out as a form-encoded beacon (the one request a browser
// reliably sends while leaving a page), so its values arrive as text.
function whole(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  return typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : null;
}

/**
 * Takes in one message. Returns true when it changed who's here. Anyone can
 * send to a public channel, so anything malformed is ignored, and so is a
 * message older than one already seen from the same page (requests can
 * arrive out of order: a late "here" must not bring back a page that said
 * "bye").
 */
export function applyPing(book: VisitorBook, raw: unknown, isPlace: (at: string) => boolean, now: number): boolean {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || !ID.test(p.id)) return false;
  const n = whole(p.n);
  if (n === null || n < 1) return false;
  const last = book.last.get(p.id);
  if (last && n <= last.n) return false;
  if (p.bye === true || p.bye === "true") {
    book.last.set(p.id, { n, at: now });
    return book.here.delete(p.id);
  }
  if (typeof p.at !== "string" || !isPlace(p.at)) return false;
  book.last.set(p.id, { n, at: now });
  const opened = whole(p.since);
  const since = opened === null ? now : Math.min(opened, now);
  const visible = !(p.visible === false || p.visible === "false");
  book.here.set(p.id, { id: p.id, at: p.at, visible, since, seen: now });
  return true;
}

/** Drops pages that went quiet. Returns true when someone was dropped. */
export function pruneBook(book: VisitorBook, now: number): boolean {
  let changed = false;
  for (const [id, v] of book.here) {
    if (now - v.seen > (v.visible ? STALE_IN_FRONT_MS : STALE_AWAY_MS)) {
      book.here.delete(id);
      changed = true;
    }
  }
  for (const [id, l] of book.last) {
    if (!book.here.has(id) && now - l.at > 30 * 60_000) book.last.delete(id);
  }
  return changed;
}

export function listVisitors(book: VisitorBook, rank: (at: string) => number): VisitorList {
  const visitors = [...book.here.values()].sort((a, b) => rank(a.at) - rank(b.at) || a.since - b.since);
  return { total: visitors.length, away: visitors.filter((v) => !v.visible).length, visitors };
}

// ---- The registration form ----

/** Where an open form is: a form step, or the page shown instead of the form. */
export type FormSpot = StepKey | "done" | "full" | "closed";

export const FORM_SPOT_LABEL: Record<FormSpot, string> = {
  you: "Your details",
  events: "Events",
  partners: "Partners",
  waiver: "Waiver",
  pay: "Payment",
  done: "Just registered",
  full: "Entries-full page",
  closed: "Closed page",
};

// Furthest into the form first.
const FORM_RANK: Record<FormSpot, number> = { pay: 0, waiver: 1, partners: 2, events: 3, you: 4, done: 5, full: 6, closed: 7 };

export const isFormSpot = (at: string): at is FormSpot => Object.prototype.hasOwnProperty.call(FORM_RANK, at);
export const formRank = (at: string): number => (isFormSpot(at) ? FORM_RANK[at] : 99);

/**
 * Where the registration page is: null while it's loading or when the
 * tournament isn't found (nothing is sent then).
 */
export function formSpot(page: {
  loaded: boolean;
  found: boolean;
  success: boolean;
  full: boolean;
  closed: boolean;
  step: StepKey;
}): FormSpot | null {
  if (!page.loaded || !page.found) return null;
  if (page.success) return "done";
  if (page.full) return "full";
  if (page.closed) return "closed";
  return page.step;
}

// ---- The website ----

const SITE_PATH = /^\/[a-z0-9/-]{0,80}$/;
export const isSitePath = (at: string): boolean => SITE_PATH.test(at);

const SITE_PAGE: Record<string, string> = {
  "/": "Home",
  "/register": "Register",
  "/categories": "Events",
  "/about": "About",
  "/venue": "Venue",
  "/faq": "FAQ",
  "/rules": "Rules",
  "/waiver": "Waiver",
  "/privacy": "Privacy",
  "/founders": "Founders",
  "/sponsors": "Sponsors",
  "/guides": "Guides",
};

export function sitePageLabel(path: string): string {
  if (SITE_PAGE[path]) return SITE_PAGE[path];
  if (path.startsWith("/guides/")) return "Guide";
  return path;
}

// The register page first (closest to entering), then events, home, the rest.
export const siteRank = (path: string): number => (path === "/register" ? 0 : path === "/categories" ? 1 : path === "/" ? 2 : 3);

// ---- Both ----

/** "just opened", "4 min", "1 h 5 min". */
export function timeOnPage(since: number, now: number): string {
  const min = Math.floor(Math.max(0, now - since) / 60_000);
  if (min < 1) return "just opened";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
