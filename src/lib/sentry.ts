// Sentry initialization — opt-in via VITE_SENTRY_DSN env var.
//
// When the DSN is unset (local dev without a Sentry project, or for users
// who haven't configured Sentry), this module is a no-op and `captureError`
// just logs to the console.
//
// To enable in production:
//   1. Create a Sentry project (free tier covers small tournaments).
//   2. Copy the DSN.
//   3. Set VITE_SENTRY_DSN in Netlify + Vercel env vars.
//   4. Redeploy.

import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!DSN) return; // No DSN configured — Sentry stays off.
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    // Sample 10% of perf traces; bumped only if perf monitoring is a focus.
    tracesSampleRate: 0.1,
    // Strip PII before sending — we don't want player names showing up in
    // the Sentry dashboard.
    beforeSend(event) {
      if (event.user) {
        delete event.user.username;
        delete event.user.email;
      }
      return event;
    },
  });
  initialized = true;
}

/** Capture an error to Sentry (no-op if Sentry isn't initialized). */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (initialized) {
    Sentry.captureException(error, { extra: context });
  } else {
    // eslint-disable-next-line no-console
    console.error("[captureError]", error, context);
  }
}
