// supabase/functions/volunteer-desk/desk.ts
//
// The parts of the volunteer desk that need no database: checking a link,
// deciding whether it is live, and shaping the player list a volunteer sees.
// Kept in this folder (not _shared) so no other function's bundle changes.

import type { PhotoKind } from "../_shared/photos.ts";

/** What the volunteer ticks, in person at the desk, before a photo is stored. Saved with the photo. */
export const DESK_CONSENT_TEXT =
  "The player, or their parent or guardian if they're under 19, agreed at the desk that this photo can be shown on their Shuttle Storm player profile, in the live app and on the hall TV on game day.";

// A volunteer link's secret: 32 random bytes as URL-safe base64 (43 characters).
const KEY = /^[A-Za-z0-9_-]{43}$/;
export const isDeskKey = (v: unknown): v is string => typeof v === "string" && KEY.test(v);

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type DeskLink = {
  id: string;
  tournament_id: string;
  label: string;
  valid_from: string;
  valid_until: string;
  revoked_at: string | null;
};

export type LinkState = "active" | "revoked" | "not_yet" | "expired";

/** Whether a link works right now. Switched off wins over everything else. */
export function linkState(link: Pick<DeskLink, "valid_from" | "valid_until" | "revoked_at">, now: Date): LinkState {
  if (link.revoked_at) return "revoked";
  const t = now.getTime();
  if (t < new Date(link.valid_from).getTime()) return "not_yet";
  if (t >= new Date(link.valid_until).getTime()) return "expired";
  return "active";
}

// Browser origins allowed to call the desk function: the desk page itself and
// local dev. CORS only constrains browsers; the link check is the real lock.
export const DEFAULT_DESK_ORIGIN = "https://desk.adawar.org";
const LOCAL_ORIGIN = /^http:\/\/localhost:\d+$/;
export function allowedOrigin(origin: string, deskOrigin: string = DEFAULT_DESK_ORIGIN): string {
  return origin === deskOrigin || LOCAL_ORIGIN.test(origin) ? origin : deskOrigin;
}

const EXT: Record<PhotoKind, string> = { jpeg: "jpg", png: "png", webp: "webp" };

/** Where a photo taken at the desk lives in the player-photos bucket. */
export function deskPhotoPath(playerId: string, kind: PhotoKind, now: number): string {
  return `desk/${playerId}/${now}.${EXT[kind]}`;
}

/**
 * The bucket path of a photo taken at the desk, from its public URL, so an
 * undone photo can be deleted. Null for any other photo (a player's own
 * upload or an admin's stays where it is).
 */
export function deskPathFromUrl(url: string | null | undefined, playerId: string): string | null {
  if (!url) return null;
  const m = /\/storage\/v1\/object\/public\/player-photos\/(desk\/([0-9a-f-]{36})\/\d+\.(?:jpg|png|webp))(?:\?.*)?$/.exec(url);
  return m && m[2] === playerId ? m[1] : null;
}

export type PlayerRow = { id: string; name: string; photo_url: string | null; checked_in_at: string | null };
export type CategoryRow = { id: string; name: string; sort_order: number | null };
export type MembershipRow = { player_id: string; category_id: string };
export type TeamRow = { category_id: string; p1_id: string | null; p2_id: string | null };

export type DeskPlayer = {
  id: string;
  name: string;
  photo_url: string | null;
  checked_in_at: string | null;
  events: { name: string; partner: string | null }[];
};

/**
 * The list a volunteer sees: name, photo, check-in time and events (with the
 * doubles partner, which helps find the right person). Nothing else about a
 * player ever leaves the function: no email, age or notes.
 */
export function shapePlayers(
  players: PlayerRow[],
  categories: CategoryRow[],
  memberships: MembershipRow[],
  teams: TeamRow[],
): DeskPlayer[] {
  const nameOf = new Map(players.map((p) => [p.id, p.name.trim()]));
  const catOf = new Map(categories.map((c) => [c.id, c]));
  // player → category → partner name (null when alone or not yet paired)
  const events = new Map<string, Map<string, string | null>>();
  const add = (playerId: string | null, categoryId: string, partnerId: string | null) => {
    if (!playerId || !nameOf.has(playerId) || !catOf.has(categoryId)) return;
    const mine = events.get(playerId) ?? new Map<string, string | null>();
    const partner = partnerId ? nameOf.get(partnerId) ?? null : null;
    if (!mine.has(categoryId) || partner) mine.set(categoryId, partner ?? mine.get(categoryId) ?? null);
    events.set(playerId, mine);
  };
  for (const m of memberships) add(m.player_id, m.category_id, null);
  for (const t of teams) {
    add(t.p1_id, t.category_id, t.p2_id);
    add(t.p2_id, t.category_id, t.p1_id);
  }
  return players
    .map((p) => ({
      id: p.id,
      name: p.name.trim(),
      photo_url: p.photo_url ?? null,
      checked_in_at: p.checked_in_at ?? null,
      events: [...(events.get(p.id) ?? new Map<string, string | null>()).entries()]
        .map(([categoryId, partner]) => ({ cat: catOf.get(categoryId)!, partner }))
        .sort((a, b) => (a.cat.sort_order ?? 0) - (b.cat.sort_order ?? 0) || a.cat.name.localeCompare(b.cat.name))
        .map(({ cat, partner }) => ({ name: cat.name, partner })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
