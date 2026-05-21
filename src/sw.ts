/// <reference lib="webworker" />
//
// Custom service worker — extends vite-plugin-pwa's precaching with
// Web Push support. Compiled via the injectManifest strategy.
//
// Two responsibilities beyond caching:
//   1. push event: render an OS notification for incoming push payloads
//   2. notificationclick: focus / open the app at the relevant URL
//
// Workbox precaching code below is identical to the default generateSW
// scaffold — we only add the push handlers.

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkOnly, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Precache the app shell (Workbox auto-injects this manifest at build time)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Supabase API + Auth + Storage + Realtime → always go to network. Stale
// cached responses would break realtime + admin UX. NetworkOnly = no caching.
registerRoute(
  ({ url }) => url.hostname.endsWith(".supabase.co"),
  new NetworkOnly(),
);

// Image-style assets → cache-first with 30-day expiry.
registerRoute(
  ({ request }) => ["image", "font"].includes(request.destination),
  new CacheFirst({
    cacheName: "images-cache",
    plugins: [
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
);

// ---------- WEB PUSH --------------------------------------------------------

type PushPayload = {
  title: string;
  body: string;
  url?: string;     // path inside the SPA to focus when clicked
  tag?: string;     // dedup key — repeat pushes with the same tag replace prior
  requireInteraction?: boolean;
};

self.addEventListener("push", (event) => {
  let payload: PushPayload;
  try {
    payload = event.data?.json() as PushPayload;
  } catch {
    // Fallback for plain-text pushes
    payload = {
      title: "Badminton",
      body: event.data?.text() ?? "Tap to open.",
    };
  }
  if (!payload?.title) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag,
      data: { url: payload.url ?? "/" },
      requireInteraction: payload.requireInteraction ?? false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url: string = (event.notification.data as { url?: string })?.url || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Reuse an existing same-origin window if we have one
      for (const c of allClients) {
        if (c.url.startsWith(self.location.origin)) {
          await c.focus();
          // navigate is best-effort — not supported everywhere
          if ("navigate" in c) {
            try { await (c as WindowClient).navigate(url); } catch { /* ignore */ }
          }
          return;
        }
      }
      // Otherwise open a fresh tab
      await self.clients.openWindow(url);
    })(),
  );
});

// Skip waiting + claim clients so the new SW takes over immediately on update.
self.addEventListener("install", () => { void self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
