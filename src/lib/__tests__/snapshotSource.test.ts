import { describe, expect, it } from "vitest";
import {
  DEGRADED_POLL_MS,
  RECHECK_MS,
  chooseSnapshotSource,
  initialSnapshotSourceState,
  isSnapshotBody,
  isSnapshotResponse,
  recordEndpointResult,
  snapshotPollDelay,
  type SnapshotSourceState,
} from "../snapshotSource";

const NORMAL = 5_000;

// Runs one poll the way db.liveSnapshot does: pick a source, and if it was
// the endpoint, record the outcome. Returns the source used by the poll's
// first attempt and the new state.
function poll(state: SnapshotSourceState, now: number, endpointOk: boolean) {
  const source = chooseSnapshotSource(state, now);
  const next = source === "endpoint" ? recordEndpointResult(state, endpointOk, now) : state;
  return { source, state: next };
}

describe("snapshotSource", () => {
  it("starts on the endpoint at the normal cadence", () => {
    expect(chooseSnapshotSource(initialSnapshotSourceState, 0)).toBe("endpoint");
    expect(snapshotPollDelay(initialSnapshotSourceState, NORMAL)).toBe(NORMAL);
  });

  it("a single failure falls back for that poll only; the next poll tries the endpoint", () => {
    const first = poll(initialSnapshotSourceState, 0, false);
    expect(first.source).toBe("endpoint");
    expect(first.state.consecutiveFailures).toBe(1);
    expect(snapshotPollDelay(first.state, NORMAL)).toBe(NORMAL);
    expect(chooseSnapshotSource(first.state, NORMAL)).toBe("endpoint");
  });

  it("three consecutive failures switch to the RPC at 30 s with a 60 s endpoint re-check", () => {
    let s = initialSnapshotSourceState;
    let t = 0;
    for (let i = 0; i < 3; i++) {
      const r = poll(s, t, false);
      expect(r.source).toBe("endpoint");
      s = r.state;
      t += NORMAL;
    }
    const lastAttempt = t - NORMAL;
    expect(snapshotPollDelay(s, NORMAL)).toBe(DEGRADED_POLL_MS);
    // Within the re-check window: RPC only.
    expect(chooseSnapshotSource(s, lastAttempt + DEGRADED_POLL_MS)).toBe("rpc");
    // At 60 s since the last endpoint attempt: try the endpoint again.
    expect(chooseSnapshotSource(s, lastAttempt + RECHECK_MS)).toBe("endpoint");
  });

  it("a failed re-check stays degraded and waits another 60 s", () => {
    let s: SnapshotSourceState = { consecutiveFailures: 3, lastEndpointAttemptAt: 0 };
    const r = poll(s, RECHECK_MS, false);
    expect(r.source).toBe("endpoint");
    s = r.state;
    expect(s.consecutiveFailures).toBe(4);
    expect(chooseSnapshotSource(s, RECHECK_MS + DEGRADED_POLL_MS)).toBe("rpc");
    expect(chooseSnapshotSource(s, 2 * RECHECK_MS)).toBe("endpoint");
  });

  it("one endpoint success returns to the endpoint at the normal cadence", () => {
    const s = recordEndpointResult({ consecutiveFailures: 5, lastEndpointAttemptAt: 0 }, true, RECHECK_MS);
    expect(s.consecutiveFailures).toBe(0);
    expect(snapshotPollDelay(s, NORMAL)).toBe(NORMAL);
    expect(chooseSnapshotSource(s, RECHECK_MS + 1)).toBe("endpoint");
  });

  it("keeps a slower caller cadence while degraded if it is already above 30 s", () => {
    expect(snapshotPollDelay({ consecutiveFailures: 3, lastEndpointAttemptAt: 0 }, 45_000)).toBe(45_000);
  });

  it("treats non-200 and non-JSON responses as failures", () => {
    expect(isSnapshotResponse(200, "application/json; charset=utf-8")).toBe(true);
    expect(isSnapshotResponse(500, "application/json")).toBe(false);
    expect(isSnapshotResponse(200, "text/html; charset=utf-8")).toBe(false);
    expect(isSnapshotResponse(200, null)).toBe(false);
  });

  it("only accepts bodies shaped like a snapshot", () => {
    expect(isSnapshotBody({ matches: [], players: [], teams: [] })).toBe(true);
    expect(isSnapshotBody(null)).toBe(false);
    expect(isSnapshotBody({ error: "upstream" })).toBe(false);
    expect(isSnapshotBody("<!doctype html>")).toBe(false);
  });
});
