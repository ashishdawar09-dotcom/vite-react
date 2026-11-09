import { useEffect, useMemo, useState } from "react";
import type { Category, Match, ProjectedMatch } from "../types";
import { projectSchedule, type TeamPlayers } from "../lib/projection";

// Projected schedule for every match, enriched with `projected_start_at`,
// `delta_min`, and a `delta_label` suitable for direct display.
//
// Inputs: all matches (across categories), all categories, num_courts, the
// teams (so a player entered in two events is never projected on two courts at
// once), optional `nowMs`.
//
// The projection itself lives in lib/projection.ts (pure, tested), and the
// venue TV uses the same model, so phones and TV show the same times. It
// shares the tournament's courts across every event: one set of court free-at
// times, live and called matches first, then the queue interleaved event by
// event, with the call-to-serve time, changeover and best-of-3 semifinals and
// finals counted. This hook adds:
// - **15-second heartbeat**: an internal tick state is wired into the memo deps,
//   so the projection re-runs every 15s even when no other state changes, and
//   backlogged matches' wall-clocks roll forward.
// - **Warm-up override**: callers should consult `match.court_allocated_at`
//   directly when formatting time labels — this hook doesn't know whether to
//   show warm-up elapsed vs queue projection, so it leaves delta_label/delta_min
//   tracking the queue projection while UI components do the warm-up override.

export function useScheduling(matches: Match[], categories: Category[], numCourts: number, teams?: TeamPlayers[], nowMs?: number): {
  projected: ProjectedMatch[];
  byId: Record<string, ProjectedMatch>;
  tournamentDeltaMin: number;       // weighted sum of completed-match deltas across categories
  tournamentDeltaLabel: string;
  liveByCourt: Record<number, ProjectedMatch | undefined>;
} {
  // 15-second heartbeat so projections re-run even when no other state changes.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    // Dev-only profiling: warn if the projection compute takes longer than
    // 50ms on a single tick. Production builds strip this entirely.
    const profileStart = import.meta.env.DEV ? performance.now() : 0;
    const schedule = projectSchedule(matches, categories, numCourts, nowMs ?? nowTick, { teams });
    if (import.meta.env.DEV) {
      const elapsed = performance.now() - profileStart;
      if (elapsed > 50) {
        console.warn(`[useScheduling] projection took ${elapsed.toFixed(1)}ms for ${matches.length} matches × ${categories.length} categories — consider profiling.`);
      }
    }
    return schedule;
  }, [matches, categories, numCourts, teams, nowMs, nowTick]);
}

export function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtElapsed(fromIso: string | null, toMs?: number): string {
  if (!fromIso) return "—";
  const from = new Date(fromIso).getTime();
  const to = toMs ?? Date.now();
  const sec = Math.max(0, Math.floor((to - from) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
