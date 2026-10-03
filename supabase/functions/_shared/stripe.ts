// Minimal Stripe REST client for the badminton functions (no SDK dependency).
// Secrets (set in Supabase → Edge Functions → Secrets, never in code):
//   STRIPE_SECRET_KEY      restricted key with Checkout Sessions write
//   STRIPE_WEBHOOK_SECRET  signing secret of the stripe-webhook endpoint

const API = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return !!Deno.env.get("STRIPE_SECRET_KEY");
}

// Flattens nested params into Stripe's form encoding: a[b][0][c]=v.
function encode(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) encode(item as Record<string, unknown>, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === "object") {
      encode(v as Record<string, unknown>, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

export async function stripePost<T = Record<string, unknown>>(
  path: string,
  params: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${API}${path}`, { method: "POST", headers, body: encode(params) });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe ${res.status}: ${body?.error?.message ?? "request failed"}`);
  }
  return body as T;
}

// Verifies the Stripe-Signature header (v1 HMAC-SHA256 over "t.payload")
// with a 5-minute tolerance.
export async function verifyStripeSignature(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((s) => timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
