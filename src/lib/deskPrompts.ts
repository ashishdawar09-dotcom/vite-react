// What the race-day desk should do next, worked out from the matches.
//
// - eventsReadyForKnockout: events whose group matches are all in but whose
//   knockout hasn't been started. Until someone taps Start Knockout, none of
//   their knockout matches can show in Up next.
// - onDeckMatches: the waiting matches whose players should hear "you're up
//   soon" (src/hooks/useOnDeckAlerts.ts).

import type { Category, Match, ProjectedMatch } from "../types";
import { isRoundRobinOnly } from "./groups";

const MIN = 60_000;

/** Events (in event order) whose groups are all done and whose knockout hasn't started. */
export function eventsReadyForKnockout(
  categories: Pick<Category, "id" | "sort_order" | "groups_count" | "top_n_advance">[],
  matches: Pick<Match, "category_id" | "stage" | "confirmed">[],
): string[] {
  return [...categories]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter(c => {
      if (isRoundRobinOnly(c)) return false;
      const mine = matches.filter(m => m.category_id === c.id);
      const groups = mine.filter(m => m.stage === "group");
      return groups.length > 0 && groups.every(m => m.confirmed) && !mine.some(m => m.stage === "knockout");
    })
    .map(c => c.id);
}

/** A match waiting for a court call: both teams known, not called, not a bye. */
export function isWaitingForCall(m: Pick<Match, "status" | "confirmed" | "is_bye" | "team_a_id" | "team_b_id" | "court_allocated_at">): boolean {
  return m.status === "pending" && !m.confirmed && !m.is_bye && !!m.team_a_id && !!m.team_b_id && !m.court_allocated_at;
}

export type OnDeckOptions = {
  /** How many matches at the front of Up next can be on deck. */
  count: number;
  /** Only matches whose projected court call is at most this many minutes away. */
  withinMin: number;
  /** A team with a player sitting out: its match becomes a walkover, so no alert. */
  sittingOut?: (teamId: string) => boolean;
};

/**
 * The matches at the front of Up next (venue wide, by projected court call)
 * whose call is close: their players get "you're up soon, stay close".
 */
export function onDeckMatches(projected: ProjectedMatch[], now: number, opts: OnDeckOptions): ProjectedMatch[] {
  const out = (t: string | null) => !!t && !!opts.sittingOut?.(t);
  return projected
    .filter(m => isWaitingForCall(m) && m.projected_start_at && !out(m.team_a_id) && !out(m.team_b_id))
    .sort((a, b) => Date.parse(a.projected_start_at!) - Date.parse(b.projected_start_at!))
    .slice(0, Math.max(0, opts.count))
    .filter(m => Date.parse(m.projected_start_at!) - now <= opts.withinMin * MIN);
}

/** Today's date in the venue's zone (BC: UTC-7 all year since Nov 2026), as YYYY-MM-DD. */
export function venueDate(now: number): string {
  return new Date(now - 7 * 60 * MIN).toISOString().slice(0, 10);
}
