// Starting a category: which shape it takes, and the rows a 2-entry
// category's Final needs. The writes themselves go through
// db.startCategoryStage, which inserts the matches and sets the phase in one
// transaction and refuses if the category has already started.

import { defaultFormat, splitIntoGroups } from "./formatPlanner";
import type { Match } from "../types";

export type StartPlan =
  | { kind: "groups"; groupsCount: number; groupSizes: number[]; topNAdvance: number }
  /** Exactly 2 entries: no group stage, one Final. */
  | { kind: "final" }
  | { kind: "too-few" };

/**
 * Format for `n` entrants. Resolution order: the format card the admin
 * picked, then the category's saved values, then the planner default.
 */
export function planStart(
  n: number,
  override: { groupsCount: number; topNAdvance: number } | undefined,
  saved: { groups_count: number | null; top_n_advance: number | null },
): StartPlan {
  if (n < 2) return { kind: "too-few" };
  let groupsCount = override?.groupsCount ?? saved.groups_count ?? 0;
  let topNAdvance = override?.topNAdvance ?? saved.top_n_advance ?? 0;
  let groupSizes: number[];
  if (groupsCount > 0) {
    groupSizes = splitIntoGroups(n, groupsCount);
  } else {
    const plan = defaultFormat(n);
    groupsCount = plan.groupsCount;
    groupSizes = plan.groupSizes;
    if (topNAdvance <= 0) topNAdvance = plan.topNAdvance;
  }
  if (groupsCount === 0 || groupSizes.length === 0) return n === 2 ? { kind: "final" } : { kind: "too-few" };
  return { kind: "groups", groupsCount, groupSizes, topNAdvance };
}

/** The single knockout match for a "Final only" category. */
export function finalOnlyRows(teamA: string, teamB: string): Partial<Match>[] {
  return [{
    group_idx: null, round_idx: 0, slot_idx: 0, team_a_id: teamA, team_b_id: teamB,
    winner_id: null, confirmed: false, is_bye: false, status: "pending", is_bronze: false,
  }];
}

/** Whether this screen already holds the category's rows for `stage` ("any" = any stage). */
export function hasStageRows(matches: Pick<Match, "category_id" | "stage">[], categoryId: string, stage: "group" | "knockout" | "any"): boolean {
  return matches.some(m => m.category_id === categoryId && (stage === "any" || m.stage === stage));
}

/** start_category_stage refused because another tap or admin got there first. */
export function isStageAlreadyStarted(err: unknown): boolean {
  return !!err && typeof (err as { message?: unknown }).message === "string" &&
    (err as { message: string }).message.includes("stage_already_started");
}
