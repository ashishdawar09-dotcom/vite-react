// Web Push client helpers — subscribe / unsubscribe the browser and POST
// the subscription payload to the subscribe-push Edge Function.
//
// Note: Notification.requestPermission() MUST be called from a user gesture
// (click / tap handler). Calling it inside useEffect on mount will be ignored
// on iOS and flagged as a bad UX on Chrome. The callers in this codebase all
// invoke these helpers from button click handlers.

export type PushSupportStatus =
  | "unsupported"     // browser lacks PushManager / Notification / service workers
  | "denied"          // user previously denied permission for this origin
  | "granted"         // already granted — can subscribe silently
  | "default";        // not asked yet — calling subscribe will prompt

export function pushSupportStatus(): PushSupportStatus {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  if (!("serviceWorker" in navigator)) return "unsupported";
  
  const hasPushManager =
    "PushManager" in window ||
    (typeof ServiceWorkerRegistration !== "undefined" && "pushManager" in ServiceWorkerRegistration.prototype);
  if (!hasPushManager) return "unsupported";
  
  return Notification.permission as PushSupportStatus;
}

// VAPID public key (URL-safe base64) → Uint8Array, as PushManager requires.
function urlBase64ToUint8(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

type Identity =
  | { kind: "player"; pending_registration_id: string }
  | { kind: "player"; player_id: string }
  | { kind: "admin"; admin_email: string };

export type SubscribeResult =
  | { ok: true; subscriptionId: string }
  | { ok: false; reason: "unsupported" | "denied" | "no-vapid-key" | "subscribe-failed" | "server-failed"; error?: string };

// Subscribes this browser to Web Push, then POSTs the subscription to the
// subscribe-push Edge Function. Idempotent — calling again from the same
// browser just refreshes the row (UPSERT on endpoint).
export async function subscribeToPush(
  tournamentId: string,
  identity: Identity,
): Promise<SubscribeResult> {
  const status = pushSupportStatus();
  if (status === "unsupported") return { ok: false, reason: "unsupported" };
  if (status === "denied") return { ok: false, reason: "denied" };

  const vapidPublic = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();
  if (!vapidPublic) {
    console.error("VITE_VAPID_PUBLIC_KEY env var is not set");
    return { ok: false, reason: "no-vapid-key" };
  }

  // Ask if not already granted. MUST be inside a user gesture.
  if (status !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      return { ok: false, reason: "denied" };
    }
  }

  // Subscribe via the active service worker
  let subscription: PushSubscription;
  try {
    const reg = await navigator.serviceWorker.ready;
    subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: TS narrows Uint8Array.buffer to ArrayBufferLike, but the
        // PushManager spec accepts BufferSource with a definite ArrayBuffer.
        // Safe at runtime — atob never returns a SharedArrayBuffer.
        applicationServerKey: urlBase64ToUint8(vapidPublic) as BufferSource,
      }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "subscribe-failed", error: msg };
  }

  // Extract keys for the server-side encrypter
  const subJson = subscription.toJSON();
  const endpoint = subJson.endpoint ?? subscription.endpoint;
  const keys = subJson.keys ?? {};
  if (!endpoint || !keys.p256dh || !keys.auth) {
    return { ok: false, reason: "subscribe-failed", error: "Subscription missing keys" };
  }

  // POST to subscribe-push Edge Function
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/subscribe-push`;
  const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const payload: Record<string, unknown> = {
    tournament_id: tournamentId,
    kind: identity.kind,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: navigator.userAgent.slice(0, 200),
  };
  if ("pending_registration_id" in identity) payload.pending_registration_id = identity.pending_registration_id;
  if ("player_id" in identity) payload.player_id = identity.player_id;
  if ("admin_email" in identity) payload.admin_email = identity.admin_email;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify(payload),
    });
    const body = (await resp.json().catch(() => ({}))) as { success?: boolean; subscriptionId?: string; error?: string };
    if (!resp.ok || !body.success) {
      return { ok: false, reason: "server-failed", error: body.error ?? `HTTP ${resp.status}` };
    }
    return { ok: true, subscriptionId: body.subscriptionId ?? "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "server-failed", error: msg };
  }
}
