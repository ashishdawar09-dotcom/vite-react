// Requests the service worker should never see, handed to the browser's
// Service Worker Static Routing API (Chrome and Edge 123+, Chrome on Android).
//
// The registration form says "bye" with navigator.sendBeacon as the visitor
// leaves (sendVisitorPing.ts). While this worker controls the page, Chrome
// first offers that beacon to the worker's fetch event, and when the page is
// navigating away the request is often dropped before it reaches the
// network: on production, Nov 7 2026, 8 of 15 byes arrived with the worker in
// control against 8 of 8 without it. A static route sends the request
// straight to the network without asking the worker.
//
// Browsers without the API (Safari, every browser on iPhone, Firefox, older
// Chrome) carry on exactly as before.

/** The live visitor count's REST broadcast endpoint, on any Supabase project. */
export const VISITOR_BROADCAST_URL = {
  protocol: "https",
  hostname: "*.supabase.co",
  pathname: "/realtime/v1/api/broadcast",
} as const;

type RouterRule = { condition: { urlPattern: unknown }; source: "network" };

/** The parts of the install event used here; `addRoutes` exists only where the API does. */
export type InstallEventLike = {
  waitUntil(promise: Promise<unknown>): void;
  addRoutes?: (rules: RouterRule | RouterRule[]) => Promise<void>;
};

/**
 * Call synchronously inside the service worker's install listener. Returns
 * whether the route was handed to the browser. Never throws, and a rule the
 * browser refuses never fails the install (a failed install would leave
 * everyone on the previous version of the app).
 */
export function addNetworkRoutes(event: InstallEventLike): boolean {
  if (typeof event.addRoutes !== "function" || typeof URLPattern !== "function") return false;
  try {
    const added = event.addRoutes({
      condition: { urlPattern: new URLPattern({ ...VISITOR_BROADCAST_URL }) },
      source: "network",
    });
    event.waitUntil(
      Promise.resolve(added).catch((err: unknown) => {
        console.warn("[sw] static route not added", err);
      }),
    );
    return true;
  } catch (err) {
    console.warn("[sw] static route not added", err);
    return false;
  }
}
