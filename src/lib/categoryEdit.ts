// What the category editor's Save writes for an existing category.
//
// Save used to write the format (groups_count, top_n_advance,
// rounds_per_pair) every time, taken from whichever format card was
// highlighted. The highlight was worked out from the current number of
// active players, so after a Sit Out (or any change in entries) the saved
// format no longer matched a card and "Recommended" was preselected. In a
// rehearsal, changing only the match length on a started event turned
// "3 groups, top 1 each" into "2 groups, top 2 each", and Start Knockout
// then built a quarter-final that included teams already knocked out.
//
// Now the format is written only when the admin picked a card, and never
// once the event's draw exists; singles/doubles is fixed from then on too.

import type { Category } from "../types";
import type { FormatPlan } from "./formatPlanner";

/** The draw exists (group stage or knockout): format and team size are part of it. */
export function categoryStarted(category: Pick<Category, "phase"> | null | undefined): boolean {
  return !!category && category.phase !== "none";
}

export type CategoryFields = Pick<Category,
  "name" | "team_size" | "match_minutes" | "starts_at" | "age_band" | "min_age" |
  "allow_solo_signup" | "has_bronze_match" | "price" | "price_basis">;

/**
 * The update for an existing category. `picked` is the format card the admin
 * chose in this edit, or null if they didn't touch the format.
 */
export function categoryUpdatePatch(
  category: Pick<Category, "phase">,
  fields: CategoryFields,
  picked: Pick<FormatPlan, "groupsCount" | "topNAdvance" | "roundsPerPair"> | null,
): Partial<Category> {
  const started = categoryStarted(category);
  const { team_size, ...rest } = fields;
  const patch: Partial<Category> = { ...rest };
  if (!started) patch.team_size = team_size;
  if (!started && picked) {
    patch.groups_count = picked.groupsCount;
    patch.top_n_advance = picked.topNAdvance;
    patch.rounds_per_pair = picked.roundsPerPair;
  }
  return patch;
}

/** "3 groups, top 1 each", from the saved values, for the locked view. */
export function savedFormatText(c: Pick<Category, "groups_count" | "top_n_advance" | "rounds_per_pair">): string {
  const g = c.groups_count ?? 0;
  const top = c.top_n_advance ?? 0;
  if (g <= 0) return top > 0 ? `knockout, top ${top}` : "knockout only";
  const groups = g === 1 ? "1 group" : `${g} groups`;
  const adv = top > 0 ? `, top ${top}${g === 1 ? "" : " each"} go through` : ", no knockout";
  const twice = (c.rounds_per_pair ?? 1) > 1 ? ", everyone plays twice" : "";
  return `${groups}${adv}${twice}`;
}
