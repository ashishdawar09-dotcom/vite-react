import type { Category, Match, ProjectedMatch } from "./types";

// Mirrors the app's court projection (src/hooks/useScheduling.ts).

const MIN = 60_000;

function parseT(s: string | null | undefined): number | null {
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

// Weighted average of the last five real matches in a category, once three
// have finished; otherwise the configured duration.
function adaptiveMatchMinutes(matches: Match[], categoryId: string, fallback: number): number {
  const completed = matches.filter(
    (m) => m.category_id === categoryId && m.confirmed && !m.is_walkover && !m.is_bye && m.started_at && m.confirmed_at,
  );
  if (completed.length < 3) return fallback;
  const recent = [...completed]
    .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""))
    .slice(0, 5);
  const weights = recent.map((_, i) => recent.length - i);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const weighted =
    recent.reduce((sum, m, i) => {
      const dur = (new Date(m.confirmed_at!).getTime() - new Date(m.started_at!).getTime()) / MIN;
      return sum + dur * weights[i];
    }, 0) / sumW;
  return Math.max(2, Math.min(60, weighted));
}

export interface Projection {
  projected: ProjectedMatch[];
  byId: Record<string, ProjectedMatch>;
  tournamentDeltaMin: number;
  tournamentDeltaLabel: string;
  liveByCourt: Record<number, ProjectedMatch>;
}

export function projectSchedule(
  matches: Match[],
  categories: Category[],
  numCourts: number,
  nowMs: number,
): Projection {
  const now = nowMs;
  if (matches.length === 0) {
    return {
      projected: [],
      byId: {},
      tournamentDeltaMin: 0,
      tournamentDeltaLabel: fmtDelta(0),
      liveByCourt: {},
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
    const startsAt = parseT(cat.starts_at);
    const baseStart = Math.max(startsAt ?? now, now);
    const queues = Array.from({ length: Math.max(1, numCourts) }, () => baseStart);
    const nominalMatchMin = cat.match_minutes || 12;
    const matchMin = adaptiveMatchMinutes(matches, cat.id, nominalMatchMin);
    for (const m of ms) {
      const startedAt = parseT(m.started_at);
      const confirmedAt = parseT(m.confirmed_at);
      const scheduledAt = parseT(m.scheduled_at);
      let projected_start_at = m.scheduled_at;
      let delta_min: number | null = null;
      let delta_label = "";
      let projected_court = m.court_number ?? null;
      if (m.confirmed && confirmedAt && scheduledAt) {
        const scheduledFinish = scheduledAt + matchMin * MIN;
        const d = (confirmedAt - scheduledFinish) / MIN;
        delta_min = d;
        delta_label = m.is_walkover
          ? "WALKOVER"
          : d > 1
            ? `${Math.round(d)}M LATE`
            : d < -1
              ? `${Math.round(-d)}M EARLY`
              : "ON TIME";
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
        delta_label =
          elapsed > totalMin + 1 ? `${Math.round(elapsed - totalMin)}M OVER` : `${Math.round(elapsed)}M PLAYING`;
        if (m.court_number != null && m.court_number >= 1 && m.court_number <= queues.length) {
          queues[m.court_number - 1] = Math.max(queues[m.court_number - 1], Math.max(now, expectedFinish));
        }
        projected_start_at = m.started_at;
      } else if (m.status === "pending" && !m.confirmed) {
        let courtIdx = 0;
        for (let i = 1; i < queues.length; i++) {
          if (queues[i] < queues[courtIdx]) courtIdx = i;
        }
        const start = Math.max(queues[courtIdx], now);
        projected_start_at = new Date(start).toISOString();
        queues[courtIdx] = start + matchMin * MIN;
        delta_min = (start - now) / MIN;
        if (m.court_number == null && !m.is_bye) projected_court = courtIdx + 1;
        if (m.is_bye) {
          delta_label = "BYE";
        } else if (delta_min > 60) {
          delta_label = "LATER";
        } else if (delta_min > 1) {
          delta_label = `IN ${Math.round(delta_min)}M`;
        } else {
          delta_label = "STARTS NOW";
        }
      } else {
        delta_label = m.is_bye ? "BYE" : "";
      }
      projected.push({ ...m, projected_start_at, delta_min, delta_label, projected_court });
    }
  }
  const byId: Record<string, ProjectedMatch> = {};
  for (const p of projected) byId[p.id] = p;
  const liveByCourt: Record<number, ProjectedMatch> = {};
  for (const p of projected) {
    if (p.status === "live" && p.court_number != null) {
      liveByCourt[p.court_number] = p;
    }
  }
  const tournamentDeltaMin = tournamentDeltaCount > 0 ? tournamentDeltaSum / tournamentDeltaCount : 0;
  return { projected, byId, tournamentDeltaMin, tournamentDeltaLabel: fmtDelta(tournamentDeltaMin), liveByCourt };
}
