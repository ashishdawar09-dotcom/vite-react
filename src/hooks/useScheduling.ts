import { useEffect, useMemo, useState } from "react";
import type { Category, Match, ProjectedMatch } from "../types";

// Per-court projected schedule. Returns matches enriched with `projected_start_at`
// and `delta_min` based on current state of all matches in the same category.
//
// Inputs: all matches (across categories), all categories, num_courts, current "now"
// For each category:
//   queues = num_courts slots, each holding the next-free timestamp
//   ordered = matches sorted by stage (group, knockout) then slot
//   for each match:
//     - if confirmed: occupy court via court_number; set queues[c] = confirmed_at
//     - if live: occupy court via court_number; queues[c] = max(now, started_at + match_minutes)
//     - if pending: pick min queue slot; set projected_start_at = queues[c]; queues[c] += match_minutes
//
// Delta semantics:
//   - pending: minutes until projected start (negative = overdue)
//   - live: elapsed - match_minutes (positive = running over)
//   - completed: confirmed_at - (scheduled_finish) (positive = late)

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

export function useScheduling(matches: Match[], categories: Category[], numCourts: number, nowMs?: number): {
  projected: ProjectedMatch[];
  byId: Record<string, ProjectedMatch>;
  tournamentDeltaMin: number;       // weighted sum of completed-match deltas across categories
  tournamentDeltaLabel: string;
  liveByCourt: Record<number, ProjectedMatch | undefined>;
} {
  // Tick once a minute so "starts in N min" countdowns refresh
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(x => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // tick only used to force re-render; suppress unused-var
  void tick;

  return useMemo(() => {
    // Dev-only profiling: warn if the projection compute takes longer than
    // 50ms on a single tick. Production builds strip this entirely.
    const profileStart = import.meta.env.DEV ? performance.now() : 0;

    const now = nowMs ?? Date.now();
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

      // Per-court free-at queue. Init each court at category.starts_at (or now if past/null).
      const startsAt = parseT(cat.starts_at);
      const baseStart = startsAt ?? now;
      const queues: number[] = Array.from({ length: Math.max(1, numCourts) }, () => baseStart);
      const matchMin = cat.match_minutes || 12;

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
          // Mark this court as freed at confirmed_at
          if (m.court_number != null && m.court_number >= 1 && m.court_number <= queues.length) {
            queues[m.court_number - 1] = Math.max(queues[m.court_number - 1], confirmedAt);
          }
          projected_start_at = m.scheduled_at;
          tournamentDeltaSum += d;
          tournamentDeltaCount++;
        } else if (m.status === "live" && startedAt) {
          const totalMin = matchMin + (m.extended_minutes ?? 0);
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
          const start = queues[courtIdx];
          projected_start_at = new Date(start).toISOString();
          queues[courtIdx] = start + matchMin * MIN;
          // Pending delta = mins until scheduled start (negative if overdue)
          delta_min = (start - now) / MIN;
          if (m.is_bye) {
            delta_label = "BYE";
          } else if (delta_min > 60) {
            delta_label = "LATER";
          } else if (delta_min > 1) {
            delta_label = `IN ${Math.round(delta_min)}M`;
          } else if (delta_min > -1) {
            delta_label = "STARTS NOW";
          } else {
            delta_label = `${Math.round(-delta_min)}M OVERDUE`;
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
  }, [matches, categories, numCourts, nowMs]); // eslint-disable-line react-hooks/exhaustive-deps
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
