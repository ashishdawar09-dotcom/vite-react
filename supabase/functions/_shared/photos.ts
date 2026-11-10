// supabase/functions/_shared/photos.ts
//
// Player photos added through a player's own link (/photo/<token>, the
// player-photo function). The page shrinks the picture to a JPEG on the
// phone first; this side checks what actually arrived before anything is
// stored.

/** The largest photo the function accepts. The page sends about 150–500 KB. */
export const MAX_PHOTO_BYTES = 3_000_000;

/** What the person ticks before a photo is stored. Saved with the upload. */
export const PHOTO_CONSENT_TEXT =
  "I'm this player, or their parent or guardian if they're under 19, and I agree this photo can be shown on their Shuttle Storm player profile, in the live app and on the hall TV on game day.";

export type PhotoKind = "jpeg" | "png" | "webp";

/** The real file type from its first bytes, whatever the name or header says. */
export function imageKind(b: Uint8Array): PhotoKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

export const CONTENT_TYPE: Record<PhotoKind, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const EXT: Record<PhotoKind, string> = { jpeg: "jpg", png: "png", webp: "webp" };

/**
 * Bytes from a `data:image/...;base64,...` string. Null when it isn't one,
 * isn't valid base64, or is bigger than MAX_PHOTO_BYTES.
 */
export function decodePhotoDataUrl(s: unknown): Uint8Array | null {
  if (typeof s !== "string") return null;
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m) return null;
  const b64 = m[1];
  if (b64.length % 4 !== 0 || (b64.length / 4) * 3 > MAX_PHOTO_BYTES + 3) return null;
  try {
    const bin = atob(b64);
    if (bin.length > MAX_PHOTO_BYTES || bin.length < 100) return null;
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Where a player's own photo lives in the player-photos bucket. */
export function selfPhotoPath(playerId: string, kind: PhotoKind, now: number): string {
  return `self/${playerId}/${now}.${EXT[kind]}`;
}

/**
 * The bucket path of a photo the player added themselves, from its public
 * URL, so the old one can be deleted when they replace or remove it. Null for
 * any other photo (an admin upload stays where it is).
 */
export function selfPathFromUrl(url: string | null | undefined, playerId: string): string | null {
  if (!url) return null;
  const m = /\/storage\/v1\/object\/public\/player-photos\/(self\/([0-9a-f-]{36})\/\d+\.(?:jpg|png|webp))(?:\?.*)?$/.exec(url);
  return m && m[2] === playerId ? m[1] : null;
}

/** "Gurmeet Singh Ghera" → "Gurmeet": how the page and the email greet the player. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}
