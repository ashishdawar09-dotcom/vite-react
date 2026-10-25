// Admin data refetches. A failed fetch used to replace the table with [] (the
// Matches tab went blank and courts showed FREE mid-match). Now a failure
// keeps whatever the screen already had, reports "stale" so the UI can say
// so, and retries that table with backoff until it loads.

export type FetchResult<T> = { data: T | null; error: unknown };

export type Refresher = {
  /** Fetch one table. Applies the data and returns true on success; on failure keeps the old data and schedules a retry. */
  run<T>(key: string, fetch: () => PromiseLike<FetchResult<T>>, apply: (data: T) => void): Promise<boolean>;
  /** Forget failures and cancel retries (tournament switch, unmount). */
  reset(): void;
};

export function createRefresher({
  onStaleChange,
  delaysMs = [2_000, 4_000, 8_000, 15_000, 30_000],
}: {
  onStaleChange: (stale: boolean) => void;
  delaysMs?: number[];
}): Refresher {
  const failing = new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null }>();
  let generation = 0;

  const report = (wasStale: boolean) => {
    const stale = failing.size > 0;
    if (stale !== wasStale) onStaleChange(stale);
  };

  async function run<T>(key: string, fetch: () => PromiseLike<FetchResult<T>>, apply: (data: T) => void): Promise<boolean> {
    const gen = generation;
    let ok: boolean;
    let data: T | null = null;
    try {
      const res = await fetch();
      ok = !res.error;
      data = res.data;
    } catch {
      ok = false;
    }
    if (gen !== generation) return false; // reset() since this started

    const wasStale = failing.size > 0;
    const prev = failing.get(key);
    if (prev?.timer) clearTimeout(prev.timer);
    if (ok) {
      apply((data ?? []) as T);
      failing.delete(key);
    } else {
      const attempt = prev ? prev.attempt + 1 : 0;
      const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)];
      const entry = { attempt, timer: null as ReturnType<typeof setTimeout> | null };
      entry.timer = setTimeout(() => { entry.timer = null; void run(key, fetch, apply); }, delay);
      failing.set(key, entry);
    }
    report(wasStale);
    return ok;
  }

  return {
    run,
    reset() {
      generation++;
      const wasStale = failing.size > 0;
      for (const f of failing.values()) if (f.timer) clearTimeout(f.timer);
      failing.clear();
      report(wasStale);
    },
  };
}
