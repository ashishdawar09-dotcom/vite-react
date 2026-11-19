// Winners photos: one photo per event, uploaded by a desk volunteer from the
// volunteer desk's Winners tab (table category_winner_photos, public read).
// Everything here fails soft: if the photo can't be read, the champion card
// simply shows without one.

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a photo held in this project's own photo storage is ever shown. */
export function safePhotoUrl(url: unknown, base: string = SUPABASE_URL): string | null {
  if (typeof url !== "string" || !base) return null;
  return url.startsWith(`${base.replace(/\/+$/, "")}/storage/v1/object/public/player-photos/`) ? url : null;
}

/** "Gurpreet Singh Gill" → "GG": shown when a champion has no profile picture. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return ((words[0][0] ?? "") + (words.length > 1 ? words[words.length - 1][0] ?? "" : "")).toUpperCase();
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** True the first time it is asked about this key in this browser tab, false after. Never throws. */
export function firstTime(key: string, store?: Store | null): boolean {
  try {
    const s = store ?? (typeof window !== "undefined" ? window.sessionStorage : null);
    if (!s) return true;
    if (s.getItem(key)) return false;
    s.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

/** The winners photo of one event, or null when there is none (or it can't be read). */
export async function fetchWinnerPhoto(categoryId: string, signal?: AbortSignal): Promise<string | null> {
  if (!UUID.test(categoryId) || !SUPABASE_URL || !PUBLISHABLE_KEY) return null;
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/category_winner_photos?select=photo_url&category_id=eq.${categoryId}&limit=1`,
    { headers: { apikey: PUBLISHABLE_KEY, Accept: "application/json" }, signal, cache: "no-store" },
  );
  if (!resp.ok) throw new Error(`winners photo read failed: ${resp.status}`);
  const rows = (await resp.json()) as { photo_url?: unknown }[];
  return safePhotoUrl(Array.isArray(rows) ? rows[0]?.photo_url : null);
}
