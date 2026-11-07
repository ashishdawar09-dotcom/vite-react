import { VISITOR_EVENT, type VisitorPing } from "./liveVisitors";

// Sends "visitor" messages (see liveVisitors.ts) to Supabase Realtime's
// broadcast API with the public (publishable) key. Fire and forget: these
// never throw and never retry.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || "";
const endpoint = () => `${url}/realtime/v1/api/broadcast`;

// Crawlers and page-speed tools aren't visitors (same list as the website's
// live.js). Decided once, as the page loads, like live.js.
const NOT_A_VISITOR = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview/i;
const notAVisitor = typeof navigator !== "undefined" && NOT_A_VISITOR.test(navigator.userAgent || "");
const canSend = () => !!url && !!key && !notAVisitor;

/** A JSON request; `keepalive` lets it finish while the page closes. */
export function sendVisitorPing(topic: string, payload: VisitorPing, keepalive = false): void {
  if (!canSend() || typeof fetch !== "function") return;
  try {
    void fetch(endpoint(), {
      method: "POST",
      keepalive,
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic, event: VISITOR_EVENT, payload, private: false }] }),
    }).catch(() => {});
  } catch {
    // A visitor count is never worth breaking the page for.
  }
}

/**
 * "Bye" while the page is going away. A JSON request needs a CORS check
 * first, and Chrome drops it when the page navigates; a beacon with a
 * form-encoded body and the key in the address needs none, so it goes out.
 */
export function sendVisitorBye(topic: string, id: string, n: number): void {
  if (!canSend()) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const body = new URLSearchParams();
      body.append("messages[][topic]", topic);
      body.append("messages[][event]", VISITOR_EVENT);
      body.append("messages[][payload][id]", id);
      body.append("messages[][payload][n]", String(n));
      body.append("messages[][payload][bye]", "true");
      if (navigator.sendBeacon(`${endpoint()}?apikey=${encodeURIComponent(key)}`, body)) return;
    }
  } catch {
    // Fall back below.
  }
  sendVisitorPing(topic, { id, n, bye: true }, true);
}
