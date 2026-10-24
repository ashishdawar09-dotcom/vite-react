// Where a registration came from, recorded in our own database so ad
// platform numbers can be checked against real entries.
//
// First touch per browser tab: the campaign tags (utm_*) on the URL that
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
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const prev = JSON.parse(stored) as Attribution;
      if (hasSignal(prev) || !hasSignal(now)) return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(now));
  } catch { /* storage off: getAttribution falls back to the current URL */ }
}

export function getAttribution(): Attribution | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as Attribution;
  } catch { /* storage off */ }
  const now = parseAttribution(window.location.href, document.referrer);
  return hasSignal(now) ? now : undefined;
}
