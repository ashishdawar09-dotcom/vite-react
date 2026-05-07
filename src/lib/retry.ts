// Retry wrapper for transient network/Supabase errors.
// Retries on: network failure, 5xx responses, "fetch failed" exceptions.
// Skips: auth errors, RLS violations (4xx), validation errors.

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function isTransient(err: any): boolean {
  if (!err) return false;
  // Network/fetch error
  if (err.message?.includes("fetch") || err.message?.includes("network") || err.name === "TypeError") {
    return true;
  }
  // Supabase wraps errors with .status
  if (typeof err.status === "number" && TRANSIENT_STATUSES.has(err.status)) {
    return true;
  }
  // PostgREST returns code in .code; "PGRST" prefix is server-side
  if (err.code === "503" || err.code === "504") return true;
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; label?: string } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 250;
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (i === attempts - 1 || !isTransient(err)) throw err;
      const delay = baseMs * Math.pow(2, i) + Math.random() * 100;
      // eslint-disable-next-line no-console
      console.warn(`[retry] ${opts.label ?? "op"} attempt ${i + 1} failed, retrying in ${Math.round(delay)}ms`, err?.message ?? err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Wrap a Supabase query-builder result `{ data, error }` so that thrown
// errors from `.then()` get retry treatment. Use as:
//   const { data } = await retried(() => supabase.from(...).select(...));
export async function retried<T>(
  fn: () => PromiseLike<{ data: T | null; error: any }>,
  label?: string
): Promise<{ data: T | null; error: any }> {
  return withRetry(async () => {
    const res = await fn();
    if (res.error && isTransient(res.error)) throw res.error;
    return res;
  }, { label });
}
