import { useEffect, useMemo, useState } from "react";
import type { Category, Match, ProjectedMatch } from "../types";

// Per-court projected schedule. Returns matches enriched with `projected_start_at`,
// `delta_min`, and a `delta_label` suitable for direct display.
//
// Inputs: all matches (across categories), all categories, num_courts, optional `nowMs`.
//
// Key design properties:
// - **Auto-rolling time**: every pending match's projected_start_at is floored at
//   `now` so backlogged queues advance forward as wall-clock time passes, never
//   freezing in the past.
// - **Adaptive duration**: once a category has ≥3 confirmed matches, the queue
//   simulation uses the recent weighted-avg actual match duration rather than
//   the nominal category.match_minutes.
// - **15-second heartbeat**: an internal tick state is wired into the memo deps,
//   so the projection re-runs every 15s even when no other state changes.
// - **Warm-up override**: callers should consult `match.court_allocated_at`
//   directly when formatting time labels — this hook doesn't know whether to
//   show warm-up elapsed vs queue projection, so it leaves delta_label/delta_min
//   tracking the queue projection while UI components do the warm-up override.

const MIN = 60_000; // ms in a minute

function parseT(s: string | null): number | null {
  if (!s) return null;
  const n = new Date(s).getTime();
  return Number.isFinite(n) ? n : null;
}

function fmtDelta(min: number): string {
  const m = Math.round(min);
  if (Math.abs(m) < 1) return "ON TIME";
  if (m < 0) return `${-m} MIN AHEAD`;
  return `${m} MIN BEHIND`;
}

/**
 * Weighted-avg of actual match durations for the given category. Falls back to
 * the nominal `fallback` (category.match_minutes) until at least 3 matches have
 * completed. Recent matches weight more heavily so a sudden shift in pacing
 * (e.g. tighter scoring in the knockout rounds) influences projections quickly.
 *
 * Window: last 5 confirmed non-walkover, non-bye matches. Weights: 5,4,3,2,1.
 */
function adaptiveMatchMinutes(matches: Match[], categoryId: string, fallback: number): number {
  const completed = matches.filter(m =>
    m.category_id === categoryId &&
    m.confirmed && !m.is_walkover && !m.is_bye &&
    m.started_at && m.confirmed_at,
  );
  if (completed.length < 3) return fallback;
  const recent = [...completed]
    .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""))
    .slice(0, 5);
  const weights = recent.map((_, i) => recent.length - i);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const weighted = recent.reduce((sum, m, i) => {
    const dur = (new Date(m.confirmed_at!).getTime() - new Date(m.started_at!).getTime()) / MIN;
    return sum + dur * weights[i];
  }, 0) / sumW;
  // Clamp to a reasonable range — avoid extreme outliers throwing projections off.
  return Math.max(2, Math.min(60, weighted));
}

export function useScheduling(matches: Match[], categories: Category[], numCourts: number, nowMs?: number): {
  projected: ProjectedMatch[];
  byId: Record<string, ProjectedMatch>;
  tournamentDeltaMin: number;       // weighted sum of completed-match deltas across categories
  tournamentDeltaLabel: string;
  liveByCourt: Record<number, ProjectedMatch | undefined>;
} {
  // 15-second heartbeat so projections re-run even when no other state changes.
  // Wired into the memo deps below so backlogged matches' wall-clocks advance.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    // Dev-only profiling: warn if the projection compute takes longer than
    // 50ms on a single tick. Production builds strip this entirely.
    const profileStart = import.meta.env.DEV ? performance.now() : 0;

    const now = nowMs ?? nowTick;
    // Bail out when there's nothing to project — saves a function call's worth
    // of overhead on a freshly-created tournament with no matches yet.
    if (matches.length === 0) {
      return {
        projected: [] as ProjectedMatch[],
        byId: {} as Record<string, ProjectedMatch>,
        tournamentDeltaMin: 0,
        tournamentDeltaLabel: fmtDelta(0),
        liveByCourt: {} as Record<number, ProjectedMatch | undefined>,
      };
    }
    const projected: ProjectedMatch[] = [];
    const byCat = new Map<string, Match[]>();
    for (const m of matches) {
      const arr = byCat.get(m.category_id) ?? [];
      arr.push(m);
      byCat.set(m.category_id, arr);
    }

    let tournamentDeltaSum = 0;
    let tournamentDeltaCount = 0;

    for (const cat of categories) {
      const ms = (byCat.get(cat.id) ?? []).slice().sort((a, b) => {
        // group before knockout, then by group/round, then slot
        const stageOrder = a.stage === "group" ? 0 : 1;
        const stageOrderB = b.stage === "group" ? 0 : 1;
        if (stageOrder !== stageOrderB) return stageOrder - stageOrderB;
        const ai = a.stage === "group" ? (a.group_idx ?? 0) : (a.round_idx ?? 0);
        const bi = b.stage === "group" ? (b.group_idx ?? 0) : (b.round_idx ?? 0);
        if (ai !== bi) return ai - bi;
        const aq = a.queue_position ?? a.slot_idx;
        const bq = b.queue_position ?? b.slot_idx;
        return aq - bq;
      });

      // Per-court free-at queue. Floor the baseline at `now` so a category that
      // was scheduled to start in the past doesn't lock projections in the past.
      const startsAt = parseT(cat.starts_at);
      const baseStart = Math.max(startsAt ?? now, now);
      const queues: number[] = Array.from({ length: Math.max(1, numCourts) }, () => baseStart);

      // Adaptive duration: learns from actual recent matches in this category.
      const nominalMatchMin = cat.match_minutes || 12;
      const matchMin = adaptiveMatchMinutes(matches, cat.id, nominalMatchMin);

      for (const m of ms) {
        const startedAt = parseT(m.started_at);
        const confirmedAt = parseT(m.confirmed_at);
        const scheduledAt = parseT(m.scheduled_at);
        let projected_start_at: string | null = m.scheduled_at;
        let delta_min: number | null = null;
        let delta_label = "";

        if (m.confirmed && confirmedAt && scheduledAt) {
          const scheduledFinish = scheduledAt + matchMin * MIN;
          const d = (confirmedAt - scheduledFinish) / MIN;
          delta_min = d;
          delta_label = m.is_walkover ? "WALKOVER" : (d > 1 ? `${Math.round(d)}M LATE` : d < -1 ? `${Math.round(-d)}M EARLY` : "ON TIME");
          if (m.court_number != null && m.court_number >= 1 && m.court_number <= queues.length) {
            queues[m.court_number - 1] = Math.max(queues[m.court_number - 1], confirmedAt);
          }
          projected_start_at = m.scheduled_at;
          tournamentDeltaSum += d;
          tournamentDeltaCount++;
        } else if (m.status === "live" && startedAt) {
          const totalMin = (cat.match_minutes || 12) + (m.extended_minutes ?? 0);
          const expectedFinish = startedAt + totalMin * MIN;
          const elapsed = (now - startedAt) / MIN;
          delta_min = elapsed - totalMin;
          delta_label = elapsed > totalMin + 1 ? `${Math.round(elapsed - totalMin)}M OVER` : `${Math.round(elapsed)}M PLAYING`;
          if (m.court_number != null && m.court_number >= 1 && m.court_number <= queues.length) {
            queues[m.court_number - 1] = Math.max(queues[m.court_number - 1], Math.max(now, expectedFinish));
          }
          projected_start_at = m.started_at;
        } else if (m.status === "pending" && !m.confirmed) {
          // Pick the court that frees up earliest
          let courtIdx = 0;
          for (let i = 1; i < queues.length; i++) {
            if (queues[i] < queues[courtIdx]) courtIdx = i;
          }
          // Floor the projected start at `now` so a backlogged queue rolls
          // forward instead of showing past times.
          const start = Math.max(queues[courtIdx], now);
          projected_start_at = new Date(start).toISOString();
          queues[courtIdx] = start + matchMin * MIN;
          delta_min = (start - now) / MIN;
          if (m.is_bye) {
            delta_label = "BYE";
          } else if (delta_min > 60) {
            delta_label = "LATER";
          } else if (delta_min > 1) {
            delta_label = `IN ${Math.round(delta_min)}M`;
          } else {
            // After the now-floor clamp, delta_min is at or near 0 for any
            // backlogged match. The wall-clock at projected_start_at rolls
            // forward as real time passes (visible via fmtClock in the UI),
            // so this label is purely a "ready" signal.
            delta_label = "STARTS NOW";
          }
        } else {
          delta_label = m.is_bye ? "BYE" : "";
        }

        projected.push({ ...m, projected_start_at, delta_min, delta_label });
      }
    }

    const byId: Record<string, ProjectedMatch> = {};
    for (const p of projected) byId[p.id] = p;

    const liveByCourt: Record<number, ProjectedMatch | undefined> = {};
    for (const p of projected) {
      if (p.status === "live" && p.court_number != null) {
        liveByCourt[p.court_number] = p;
      }
    }

    const tournamentDeltaMin = tournamentDeltaCount > 0 ? tournamentDeltaSum / tournamentDeltaCount : 0;

    if (import.meta.env.DEV) {
      const elapsed = performance.now() - profileStart;
      if (elapsed > 50) {
        // eslint-disable-next-line no-console
        console.warn(`[useScheduling] projection took ${elapsed.toFixed(1)}ms for ${matches.length} matches × ${categories.length} categories — consider profiling.`);
      }
    }

    return { projected, byId, tournamentDeltaMin, tournamentDeltaLabel: fmtDelta(tournamentDeltaMin), liveByCourt };
  }, [matches, categories, numCourts, nowMs, nowTick]); // eslint-disable-line react-hooks/exhaustive-deps
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
