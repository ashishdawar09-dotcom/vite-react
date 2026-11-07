import { useSyncExternalStore } from "react";
import * as db from "../lib/db";
import { ScoreTaps, type ScoredMatch } from "../lib/scoreTaps";
import { toast } from "../components/Toast";

/**
 * The one saver for every live score on screen: the Matches tab's +/−, the
 * match cards' +/− and score boxes (see src/lib/scoreTaps.ts).
 */
export const scoreTaps = new ScoreTaps(
  (id, patch) => db.updateMatch(id, patch),
  () => toast("A score didn't save, so it shows the last saved score. Check the connection and try again.", "error"),
);

/** Re-renders on every tap; for screens that draw many matches themselves (the Matches tab). */
export function useScoreTaps(): ScoreTaps {
  useSyncExternalStore(scoreTaps.subscribe, scoreTaps.version);
  return scoreTaps;
}

/** One match's numbers on screen. Re-renders only when they change. */
export function useShownScores(m: ScoredMatch): { a: number; b: number } {
  const key = useSyncExternalStore(scoreTaps.subscribe, () => `${scoreTaps.shown(m, "a")}|${scoreTaps.shown(m, "b")}`);
  const [a, b] = key.split("|").map(Number);
  return { a, b };
}
