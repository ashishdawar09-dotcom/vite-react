// Drops Sentry events thrown by scripts that in-app browsers inject into
// the page, which are not our code and which we can't fix.
//
// Instagram's and Facebook's in-app browsers inject an inline script that
// reports form submits to the native app (logSubmitButtonClicked →
// sendPostMessage → dispatchToBridge). On iOS that postMessage can reject
// with "InvalidAccessError", which Sentry records as an unhandled rejection
// against the page URL. We ship no inline scripts (index.html loads only
// /src/main.tsx, bundled to /assets/*.js), so a stack made only of frames
// whose file is the page itself came from an injected script.

import type { ErrorEvent } from "@sentry/react";

/** Function names used by the Meta in-app browser's injected bridge script. */
const META_IAB_FRAMES = new Set(["dispatchToBridge", "sendPostMessage", "logSubmitButtonClicked"]);

function bareName(fn: string): string {
  return fn.replace(/^async\s+/, "").split(".").pop() ?? fn;
}

function pagePath(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

export function isInjectedScriptError(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.flatMap((v) => v.stacktrace?.frames ?? []) ?? [];
  if (frames.length === 0) return false;

  // Match the bare name inside "Object.fn", "window.x.fn" or "async fn",
  // whatever file the frame claims (often the page the script was injected
  // into, which after an in-app navigation isn't the event's page URL).
  if (frames.some((f) => f.function && META_IAB_FRAMES.has(bareName(f.function)))) return true;

  // Every frame points at the HTML page rather than a bundled script. Sentry
  // also gives a stackless window.onerror one stand-in frame at the page URL
  // with function "?"; that says nothing about where the error came from, so
  // only real, named frames count.
  const page = event.request?.url ? pagePath(event.request.url) : null;
  return (
    page !== null &&
    frames.some((f) => !!f.function && f.function !== "?") &&
    frames.every((f) => !!f.filename && pagePath(f.filename) === page)
  );
}
