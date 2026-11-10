import { useEffect, useRef } from "react";
import { onDeckMatches, venueDate } from "../lib/deskPrompts";
import { notifyOnDeck } from "../lib/notifications";
import type { ProjectedMatch } from "../types";

/** A match is on deck when it's one of the next this many in Up next… */
export const ON_DECK_COUNT = 4;
/** …and its projected court call is at most this many minutes away. */
export const ON_DECK_WITHIN_MIN = 12;

/**
 * "You're up soon": on the tournament's day, an admin's app asks
 * notify-on-deck to tell the players of each match about to be called to
 * stay close to the courts. This device asks once per match; the function
 * sends once per match whichever device asks, and not at all when the
 * director has the alerts off (Emails tab).
 */
export function useOnDeckAlerts(o: {
  enabled: boolean;
  /** The tournament's date (YYYY-MM-DD); nothing is sent on any other day. */
  eventDate: string | null;
  projected: ProjectedMatch[];
  numCourts: number;
  sittingOut: (teamId: string) => boolean;
}): void {
  const asked = useRef(new Set<string>());
  const { enabled, eventDate, projected, numCourts, sittingOut } = o;
  useEffect(() => {
    if (!enabled || !eventDate) return;
    const now = Date.now();
    if (venueDate(now) !== eventDate) return;
    const count = Math.min(ON_DECK_COUNT, Math.max(1, numCourts));
    for (const m of onDeckMatches(projected, now, { count, withinMin: ON_DECK_WITHIN_MIN, sittingOut })) {
      if (asked.current.has(m.id)) continue;
      asked.current.add(m.id);
      void notifyOnDeck(m.id, m.projected_start_at);
    }
  }, [enabled, eventDate, projected, numCourts, sittingOut]);
}
