// Where a registration came from, recorded in our own database so ad
// platform numbers can be checked against real entries.
//
// First touch per device, kept for 7 days: the campaign tags (utm_*) on the URL that
// brought the visitor in, whether the click came from a Google or Meta ad
// (we keep only which one, never the click ID itself), and the referring
// site's host. The Shuttle Storm site passes its own landing tags along on
// the Register links (see public/consent.js), so a Google ad that lands on
// the site still counts as Google here.

export type Attribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  click_id?: "google" | "meta";
  referrer_host?: string;
  landing_path?: string;
};

// Answers for "How did you hear about Shuttle Storm?". Keep in sync with
// supabase/functions/_shared/attribution.ts.
export const HEARD_FROM_OPTIONS = [
  { value: "facebook_instagram", label: "Facebook or Instagram" },
  { value: "google_search", label: "Google search" },
  { value: "friend", label: "Friend or teammate" },
  { value: "club_coach", label: "My club or coach" },
  { value: "poster", label: "Poster or flyer" },
  { value: "whatsapp", label: "WhatsApp group" },
  { value: "played_before", label: "Played before" },
  { value: "other", label: "Other" },
] as const;

export type HeardFrom = (typeof HEARD_FROM_OPTIONS)[number]["value"];

const STORAGE_KEY = "registration-attribution";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const MAX_LEN = 100;

function clip(v: string | null): string | undefined {
  const t = v?.trim();
  return t ? t.slice(0, MAX_LEN) : undefined;
}

// Reads attribution from a URL and referrer. Pure, for tests.
export function parseAttribution(href: string, referrer: string): Attribution {
  const out: Attribution = {};
  let url: URL;
  try { url = new URL(href); } catch { return out; }
  const q = url.searchParams;
  for (const k of UTM_KEYS) {
    const v = clip(q.get(k));
    if (v) out[k] = v;
  }
  // "click" is how the Shuttle Storm site hands over a click-ID marker.
  const click = q.get("click");
  if (q.has("gclid") || q.has("gbraid") || q.has("wbraid") || click === "google") out.click_id = "google";
  else if (q.has("fbclid") || click === "meta") out.click_id = "meta";
  try {
    const host = referrer ? new URL(referrer).hostname : "";
    if (host && host !== url.hostname) out.referrer_host = clip(host);
  } catch { /* bad referrer: ignore */ }
  out.landing_path = clip(url.pathname);
  return out;
}

function hasSignal(a: Attribution): boolean {
  return !!(a.utm_source || a.utm_medium || a.utm_campaign || a.click_id || a.referrer_host);
}

// Records first-touch attribution for this tab. A later visit with real
// signals (tags, a click ID or a referrer) only replaces a stored one that
// had none, so reloading the form doesn't wipe the ad that brought someone in.
export function captureAttribution(): void {
  if (typeof window === "undefined") return;
  const now = parseAttribution(window.location.href, document.referrer);
  const prev = readStored();
  if (prev && (hasSignal(prev) || !hasSignal(now))) return;
  writeStored(now);
}

export function getAttribution(): Attribution | undefined {
  if (typeof window === "undefined") return undefined;
  const stored = readStored();
  if (stored) return stored;
  const now = parseAttribution(window.location.href, document.referrer);
  return hasSignal(now) ? now : undefined;
}

// Kept for 7 days on this device (Meta's click window), so someone who taps an
// ad and comes back to register a few days later still counts for that ad.
// Falls back to this tab only when local storage is off.
export const ATTRIBUTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function storages(): Storage[] {
  const out: Storage[] = [];
  try { out.push(window.localStorage); } catch { /* blocked */ }
  try { out.push(window.sessionStorage); } catch { /* blocked */ }
  return out;
}

function readStored(now = Date.now()): Attribution | null {
  for (const store of storages()) {
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (!raw) continue;
      const { stored_at, ...attr } = JSON.parse(raw) as Attribution & { stored_at?: number };
      if (typeof stored_at === "number" && now - stored_at > ATTRIBUTION_TTL_MS) {
        store.removeItem(STORAGE_KEY);
        continue;
      }
      return attr;
    } catch { /* unreadable: ignore */ }
  }
  return null;
}

function writeStored(a: Attribution): void {
  const value = JSON.stringify({ ...a, stored_at: Date.now() });
  for (const store of storages()) {
    try {
      store.setItem(STORAGE_KEY, value);
      return;
    } catch { /* full or blocked: try the next */ }
  }
}
