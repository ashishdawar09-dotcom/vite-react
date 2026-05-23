import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || "";

// In vitest (MODE === "test") the supabase client is never actually called —
// only pure helpers are tested — so a missing env should not throw and abort
// the whole test run. In every other mode (dev / production / Vercel build)
// missing env is a real bug we want to surface immediately.
const isTest = import.meta.env.MODE === "test";
if (!isTest && (!url || !key)) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
}

// Stub values used ONLY when running under vitest with no env configured.
// The resulting client cannot actually connect to anything, which is fine
// because tests never call it.
const clientUrl = url || "https://stub.invalid.supabase.co";
const clientKey = key || "stub-key-for-tests";

// Custom fetch with timeout + transient-error retry. Wraps the global fetch
// so every Supabase HTTP call gets resilience for free.
const FETCH_TIMEOUT_MS = 15_000;
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const attempts = 3;
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(input, { ...init, signal: init?.signal ?? ctrl.signal });
      clearTimeout(t);
      // Retry on transient server statuses
      if (RETRY_STATUSES.has(res.status) && i < attempts - 1) {
        const delay = 250 * Math.pow(2, i) + Math.random() * 100;
        // eslint-disable-next-line no-console
        console.warn(`[supabase] HTTP ${res.status} — retry ${i + 1}/${attempts} in ${Math.round(delay)}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err: any) {
      clearTimeout(t);
      lastErr = err;
      const isAbort = err?.name === "AbortError";
      const isNetwork = err?.message?.includes("fetch") || err?.message?.includes("network") || err?.name === "TypeError";
      if (i === attempts - 1 || (!isAbort && !isNetwork)) throw err;
      const delay = 250 * Math.pow(2, i) + Math.random() * 100;
      // eslint-disable-next-line no-console
      console.warn(`[supabase] network err — retry ${i + 1}/${attempts} in ${Math.round(delay)}ms`, err?.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export const supabase = createClient(clientUrl, clientKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: resilientFetch },
});

// Comma-separated list of admin emails. Falls back to single VITE_ADMIN_EMAIL
// for backwards compatibility.
const adminListEnv =
  (import.meta.env.VITE_ADMIN_EMAILS as string | undefined) ??
  (import.meta.env.VITE_ADMIN_EMAIL as string | undefined) ??
  "";

export const ADMIN_EMAILS: string[] = adminListEnv
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Backwards-compat single export
export const ADMIN_EMAIL = ADMIN_EMAILS[0] ?? "";
