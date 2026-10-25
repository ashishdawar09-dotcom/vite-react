// Decides, per spectator poll, whether to read the live snapshot from the
// CDN-cached /api/snapshot endpoint or straight from the live_snapshot RPC.
//
// Pure (no fetch, no clock): callers pass `now` and record each endpoint
// attempt's outcome. Policy (KTD5 in docs/plans/race-day-2026.md):
//   - Healthy: every poll tries the endpoint. A failed attempt falls back to
//     the RPC for that poll only; the next poll tries the endpoint again.
//   - After DEGRADE_AFTER consecutive failures: degraded. Polls go to the RPC
//     at DEGRADED_POLL_MS, and the endpoint is re-checked every RECHECK_MS.
//   - One endpoint success returns to healthy at the normal cadence.

export const DEGRADE_AFTER = 3;
export const DEGRADED_POLL_MS = 30_000;
export const RECHECK_MS = 60_000;

export type SnapshotSourceState = {
  consecutiveFailures: number;
  lastEndpointAttemptAt: number | null;
};

export type SnapshotSource = "endpoint" | "rpc";

export const initialSnapshotSourceState: SnapshotSourceState = {
  consecutiveFailures: 0,
  lastEndpointAttemptAt: null,
};

export function isDegraded(state: SnapshotSourceState): boolean {
  return state.consecutiveFailures >= DEGRADE_AFTER;
}

export function chooseSnapshotSource(state: SnapshotSourceState, now: number): SnapshotSource {
  if (!isDegraded(state)) return "endpoint";
  const last = state.lastEndpointAttemptAt;
  return last === null || now - last >= RECHECK_MS ? "endpoint" : "rpc";
}

export function recordEndpointResult(
  state: SnapshotSourceState,
  ok: boolean,
  now: number,
): SnapshotSourceState {
  return {
    consecutiveFailures: ok ? 0 : state.consecutiveFailures + 1,
    lastEndpointAttemptAt: now,
  };
}

/** Delay before the next poll: the caller's normal cadence, or 30 s while degraded. */
export function snapshotPollDelay(state: SnapshotSourceState, normalMs: number): number {
  return isDegraded(state) ? Math.max(normalMs, DEGRADED_POLL_MS) : normalMs;
}

/**
 * Whether an endpoint response can be parsed as a snapshot. Vite dev and a
 * misrouted SPA rewrite both answer /api/* with index.html and a 200, so the
 * content type matters as much as the status.
 */
export function isSnapshotResponse(status: number, contentType: string | null): boolean {
  return status === 200 && /^application\/json\b/i.test(contentType ?? "");
}

/** Parsed body must look like a live_snapshot payload, not `null` or an error object. */
export function isSnapshotBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { matches?: unknown }).matches) &&
    Array.isArray((body as { players?: unknown }).players)
  );
}
