// Race-day email helpers: the court-call idempotency key, Resend delivery
// webhooks (signature check and event mapping), and who gets the player
// briefings. Pure functions, so they're tested without a network.

// ---------- court calls ----------

// The same player, match, court and allocation always gives the same key, so
// a double-tapped "allocate" (or a retried call) emails once. Re-allocating
// the match later gives a new court_allocated_at and a new email.
export function courtCallKey(matchId: string, court: number | string, allocatedAt: string | null, playerId: string): string {
  return `court-call/${matchId}/${court}/${allocatedAt ?? "-"}/${playerId}`;
}

// ---------- delivery webhooks ----------

// What the admin screens show. "sent" and engagement events don't change it.
export type DeliveryStatus = "delivered" | "delivery_delayed" | "bounced" | "complained" | "failed" | "suppressed";

const EVENT_STATUS: Record<string, DeliveryStatus> = {
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
};

// The events the webhook subscribes to (create-webhook takes this list).
export const WEBHOOK_EVENTS = Object.keys(EVENT_STATUS);

// Problems the desk has to act on: the player never got the email.
export const PROBLEM_STATUSES: DeliveryStatus[] = ["bounced", "complained", "failed", "suppressed"];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Obj : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export type DeliveryUpdate = { emailId: string; status: DeliveryStatus; detail: string | null; at: string };

// A Resend webhook payload → the update to record, or null to ignore it.
export function deliveryFromEvent(payload: unknown): DeliveryUpdate | null {
  const p = obj(payload);
  const status = p && EVENT_STATUS[String(p.type)];
  const data = obj(p?.data);
  const emailId = str(data?.email_id);
  if (!status || !emailId) return null;
  const bounce = obj(data?.bounce);
  const failed = obj(data?.failed);
  const suppressed = obj(data?.suppressed);
  const detail = str(bounce?.message) ?? str(failed?.reason) ?? str(suppressed?.message) ??
    (bounce ? [str(bounce.type), str(bounce.subType)].filter(Boolean).join(" / ") || null : null);
  const at = str(p?.created_at) ?? str(data?.created_at) ?? new Date().toISOString();
  return { emailId, status, detail: detail ? detail.slice(0, 300) : null, at };
}

// ---------- webhook signatures (Svix, which Resend uses) ----------

const enc = new TextEncoder();

function b64decode(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function b64encode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSvix(secret: string, id: string, timestamp: string, body: string): Promise<string | null> {
  const key = b64decode(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  if (!key?.length) return null;
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64encode(await crypto.subtle.sign("HMAC", k, enc.encode(`${id}.${timestamp}.${body}`)));
}

// True when one of the header's "v1,<signature>" entries matches and the
// timestamp is within five minutes of now (no replays of old deliveries).
export async function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > 300) return false;
  const expected = await signSvix(secret, id, timestamp, body);
  if (!expected) return false;
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",", 2);
    return version === "v1" && !!sig && sameString(sig, expected);
  });
}

// ---------- player briefings ----------

export type BriefingKind = "day_before" | "morning_of";
export const BRIEFING_KINDS: BriefingKind[] = ["day_before", "morning_of"];

export type RosterPlayer = { id: string; name: string; email: string | null; active: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Active players with a usable address, in name order. Test rows (scratch
// addresses) never get a briefing.
export function briefingRecipients(players: RosterPlayer[]): { id: string; name: string; email: string }[] {
  return players
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: p.name.trim(), email: (p.email ?? "").trim() }))
    .filter((p) => EMAIL_RE.test(p.email) && !/@(scratch|example)\.(test|com)$/i.test(p.email))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// The morning-of email goes out at 7:00 am on the event day (BC is UTC-7 all
// year from Nov 1, 2026), unless the directors pick another time.
export function defaultMorningSendAt(eventDate: string | null): string | null {
  if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  return `${eventDate}T14:00:00.000Z`;
}

// Resend schedules up to 30 days ahead. A time that has passed (or is under a
// minute away) is refused, so a stale form never sends at the wrong moment.
export function scheduleWindow(iso: string | null | undefined, nowMs = Date.now()): { at: string | null; error: string | null } {
  if (!iso) return { at: null, error: null };
  const t = Date.parse(iso);
  if (isNaN(t)) return { at: null, error: "That send time isn't a valid date." };
  if (t - nowMs < 60_000) return { at: null, error: "That send time has passed. Pick a later time, or send now." };
  if (t - nowMs > 30 * 86_400_000) return { at: null, error: "Resend can only schedule up to 30 days ahead." };
  return { at: new Date(t).toISOString(), error: null };
}

// One player's events, partners and first timed match, from the roster rows.
export type PlanTeam = { id: string; category_id: string; p1_id: string; p2_id: string | null };
export type PlanMatch = {
  id: string;
  category_id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
  scheduled_at: string | null;
  court_number: number | null;
};
export type PlayerPlan = {
  entries: { category: string; partner: string | null }[];
  firstMatch: { at: string; category: string; court: number | null; opponent: string | null } | null;
};

export function playerPlan(
  playerId: string,
  d: {
    categories: { id: string; name: string; sort?: number | null }[];
    playerCategoryIds: string[];          // this player's categories
    teams: PlanTeam[];
    matches: PlanMatch[];
    nameById: Map<string, string>;
  },
): PlayerPlan {
  const catName = new Map(d.categories.map((c) => [c.id, c.name]));
  const order = new Map(d.categories.map((c, i) => [c.id, i]));
  const mine = d.teams.filter((t) => t.p1_id === playerId || t.p2_id === playerId);
  const teamLabel = (t: PlanTeam | undefined) => {
    if (!t) return null;
    const names = [t.p1_id, t.p2_id].filter((x): x is string => !!x).map((x) => d.nameById.get(x)).filter(Boolean);
    return names.length ? names.join(" & ") : null;
  };

  const catIds = [...new Set([...d.playerCategoryIds, ...mine.map((t) => t.category_id)])]
    .filter((c) => catName.has(c))
    .sort((a, b) => (order.get(a)! - order.get(b)!));
  const entries = catIds.map((c) => {
    const team = mine.find((t) => t.category_id === c);
    const partnerId = team ? (team.p1_id === playerId ? team.p2_id : team.p1_id) : null;
    return { category: catName.get(c)!, partner: partnerId ? d.nameById.get(partnerId) ?? null : null };
  });

  const teamIds = new Set(mine.map((t) => t.id));
  const teamById = new Map(d.teams.map((t) => [t.id, t]));
  const timed = d.matches
    .filter((m) => m.status === "pending" && m.scheduled_at && !isNaN(Date.parse(m.scheduled_at)))
    .filter((m) => (m.team_a_id && teamIds.has(m.team_a_id)) || (m.team_b_id && teamIds.has(m.team_b_id)))
    .sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!));
  const m = timed[0];
  const firstMatch = m
    ? {
      at: new Date(m.scheduled_at!).toISOString(),
      category: catName.get(m.category_id) ?? "",
      court: m.court_number ?? null,
      opponent: teamLabel(teamById.get((m.team_a_id && teamIds.has(m.team_a_id) ? m.team_b_id : m.team_a_id) ?? "")),
    }
    : null;
  return { entries, firstMatch };
}
