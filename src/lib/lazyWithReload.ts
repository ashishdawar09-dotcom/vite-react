import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// Sessionstorage key. Stores the pathname at which the reload was triggered,
// so we can detect "same path is still broken" and stop after one retry.
const RELOAD_KEY = "chunk-reload-fired";

/**
 * Recognise the "the chunk URL is gone" failure mode that fires after a
 * deploy. Each browser phrases it slightly differently:
 *   - iOS Safari: "Importing a module script failed."
 *   - Chrome:     "Failed to fetch dynamically imported module"
 *   - Firefox:    "error loading dynamically imported module"
 *   - Webpack-flavoured tooling sometimes throws ChunkLoadError.
 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Importing a module script failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /ChunkLoadError/i.test(msg)
  );
}

/**
 * Drop-in replacement for `React.lazy()` that auto-reloads the page when the
 * dynamic import fails because the chunk URL no longer exists on the server.
 *
 * Why: every Vercel deploy ships fresh hashed chunk filenames. A user whose
 * iPhone PWA has the previous deploy's HTML cached (by the service worker or
 * the browser disk cache) will try to load the OLD chunks — which Vercel has
 * already garbage-collected. The dynamic import rejects, the lazy promise
 * surfaces it as a render-time error, and the user sees "Something Went Wrong"
 * (or, on iOS, gets a Sentry report with "TypeError: Importing a module
 * script failed").
 *
 * The recovery is always the same: reload to fetch fresh HTML + chunks.
 * This helper makes that recovery automatic and invisible to the user.
 *
 * Guarded against infinite-reload loops via sessionStorage — see RELOAD_KEY.
 * Call `clearChunkReloadGuard()` after a successful mount to re-arm the
 * recovery for the next deploy.
 */
export function lazyWithReload<T extends ComponentType<unknown>>(
  loader: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await loader();
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      const path = typeof window !== "undefined" ? window.location.pathname : "";
      // If we already reloaded for this same path and the chunk STILL fails,
      // give up and let the ErrorBoundary show its real-error fallback.
      // Otherwise we'd loop forever.
      try {
        if (sessionStorage.getItem(RELOAD_KEY) === path) {
          throw err;
        }
        sessionStorage.setItem(RELOAD_KEY, path);
      } catch {
        // Private mode / sessionStorage disabled — still try one reload.
      }
      window.location.reload();
      // Resolve with a never-rendered stub so the lazy promise doesn't
      // reject before the reload navigates the page away.
      return new Promise<{ default: T }>(() => {});
    }
  });
}

/**
 * Clear the sessionStorage guard. Call after the app has successfully
 * mounted — that proves the chunks for THIS path loaded fine, so any future
 * chunk-load failure (next deploy) should get its own one-shot reload.
 */
export function clearChunkReloadGuard() {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    // Private mode / disabled storage — best-effort.
  }
}
