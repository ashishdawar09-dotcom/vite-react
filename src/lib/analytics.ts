// Google Analytics 4 for the public registration page only.
//
// Loads /consent.js (the same Consent Mode v2 loader the Shuttle Storm and
// adawar.org sites use): ads storage always denied, analytics denied with a
// banner for EEA/UK/Swiss visitors, granted elsewhere. Nothing loads while
// GA_MEASUREMENT_ID is empty. The ID isn't a secret; it ships in the page.
//
// The admin app, scoreboards and spectator pages are not tracked.

export const GA_MEASUREMENT_ID = "G-FT7CJBVQ4Z";
export const PRIVACY_URL = "https://shuttlestorm.adawar.org/privacy";

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window { gtag?: Gtag }
}

let loading: Promise<void> | null = null;

export function initAnalytics(): Promise<void> {
  if (!GA_MEASUREMENT_ID) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    const s = document.createElement("script");
    s.src = "/consent.js";
    s.dataset.ga = GA_MEASUREMENT_ID;
    s.dataset.privacy = PRIVACY_URL;
    s.onload = () => resolve();
    s.onerror = () => resolve(); // blocked by an extension: carry on untracked
    document.head.appendChild(s);
  });
  return loading;
}

// Sends a GA event once consent.js has set the consent defaults. Never pass
// names, emails or phone numbers here.
export function trackEvent(name: string, params: Record<string, string | number | undefined> = {}): void {
  void initAnalytics().then(() => window.gtag?.("event", name, params));
}

// Card registrations finish on a fresh page load after Stripe, so the amount
// is parked in sessionStorage before the redirect.
const PENDING_KEY = "ga-pending-registration";

export function rememberPendingCardRegistration(value: number): void {
  try { sessionStorage.setItem(PENDING_KEY, String(value)); } catch { /* storage off */ }
}

export function takePendingCardRegistration(): number | undefined {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return v ? Number(v) : undefined;
  } catch {
    return undefined;
  }
}

// One registration_complete per registration, even if the success page is
// reloaded.
export function trackRegistrationComplete(
  registrationId: string | null,
  params: { payment_method: "etransfer" | "card"; value?: number; tournament_id?: string },
): void {
  if (registrationId) {
    const key = `ga-reg-${registrationId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* storage off: may double count on reload */ }
  }
  trackEvent("registration_complete", { ...params, currency: "CAD" });
}
