// Bounded, allowlisted copies of the registration form's source fields
// ("How did you hear about us?" and campaign tags), stored in
// pending_registrations.raw_payload so ad results can be checked against
// real entries. Keep HEARD_FROM in sync with src/lib/attribution.ts.

export const HEARD_FROM = [
  "facebook_instagram",
  "google_search",
  "friend",
  "club_coach",
  "poster",
  "whatsapp",
  "played_before",
  "other",
] as const;

export type HeardFrom = (typeof HEARD_FROM)[number];

export type StoredAttribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  click_id?: "google" | "meta";
  referrer_host?: string;
  landing_path?: string;
};

const STRING_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer_host",
  "landing_path",
] as const;
const MAX_LEN = 100;

export function cleanHeardFrom(v: unknown): HeardFrom | null {
  return typeof v === "string" && (HEARD_FROM as readonly string[]).includes(v) ? (v as HeardFrom) : null;
}

// Keeps only known keys with short string values; anything else is dropped.
// Returns null when nothing usable is left.
export function cleanAttribution(v: unknown): StoredAttribution | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: StoredAttribution = {};
  for (const k of STRING_KEYS) {
    const val = src[k];
    if (typeof val !== "string") continue;
    // Control characters stripped so the value is safe to show in a CSV or admin view.
    // eslint-disable-next-line no-control-regex
    const t = val.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_LEN);
    if (t) out[k] = t;
  }
  if (src.click_id === "google" || src.click_id === "meta") out.click_id = src.click_id;
  return Object.keys(out).length ? out : null;
}
