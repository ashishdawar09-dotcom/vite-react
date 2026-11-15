// Result options from the start of a match, not only at time over (Ashish,
// Nov 15 2026). Pure: nothing here writes; db.ts writes these same fields.
//
//   Before play (pending, or warming up on a court): Walkover.
//   During play (live), at any time: Walkover, Retired (injury), Select Winner.
//
// Walkover = the match didn't really happen: no score is kept.
// Retired = it was played until a side stopped (injury): the score so far is
// shown and the other side wins, even if it was behind.
// Select Winner = the director decides; the score so far is kept.
// Points rule (Ashish, Nov 15): a walkover or a retirement gives the win but
// no points either way (lib/groups.ts countsForPoints).

import type { Match } from "../types";
import { RESET_MATCH, planKnockoutUndo, type KnockoutPlan } from "./knockout";

export type ResultOption = "walkover" | "retired" | "winner";

/** Which options a match offers right now (admin only; the caller checks that). */
export function resultOptions(m: Pick<Match, "confirmed" | "is_bye" | "status" | "team_a_id" | "team_b_id">): ResultOption[] {
  if (m.confirmed || m.is_bye || m.status === "completed" || !m.team_a_id || !m.team_b_id) return [];
  if (m.status === "live") return ["walkover", "retired", "winner"];
  return ["walkover"];
}

type Sides = Pick<Match, "team_a_id" | "team_b_id">;
const otherSide = (m: Sides, teamId: string) => (teamId === m.team_a_id ? m.team_b_id : teamId === m.team_b_id ? m.team_a_id : null);

/** The fields each kind of result writes (db.markWalkover / retireMatch / selectMatchWinner use these). */
export const walkoverFields = (at: string): Partial<Match> =>
  ({ score_a: null, score_b: null, confirmed: true, status: "completed", confirmed_at: at, is_walkover: true, is_retired: false });
export const retiredFields = (at: string): Partial<Match> =>
  ({ confirmed: true, status: "completed", confirmed_at: at, is_walkover: false, is_retired: true });
export const pickedFields = (at: string): Partial<Match> =>
  ({ confirmed: true, status: "completed", confirmed_at: at, is_walkover: false, is_retired: false });

/** A no-show or forfeit: `winnerId` wins, no score, a court that was only warming up is freed. */
export function walkoverPatch(m: Match, winnerId: string, at: string): Partial<Match> | null {
  if (!resultOptions(m).includes("walkover") || !otherSide(m, winnerId)) return null;
  return {
    ...walkoverFields(at), winner_id: winnerId,
    ...(m.status !== "live" ? { court_number: null, court_allocated_at: null } : {}),
  };
}

/**
 * `retiringId` stops (injury). The other side wins with the score on screen.
 * Best of 3: `extra` is stopEarlyPatch (games won), as Select Winner does today.
 */
export function retiredPatch(m: Match, retiringId: string, shown: { a: number | null; b: number | null }, at: string, extra: Partial<Match> = {}): Partial<Match> | null {
  if (!resultOptions(m).includes("retired")) return null;
  const winnerId = otherSide(m, retiringId);
  if (!winnerId) return null;
  return { score_a: shown.a ?? 0, score_b: shown.b ?? 0, ...extra, ...retiredFields(at), winner_id: winnerId };
}

/** Select Winner at any time in play: the score on screen stays. */
export function pickedWinnerPatch(m: Match, winnerId: string, shown: { a: number | null; b: number | null }, at: string, extra: Partial<Match> = {}): Partial<Match> | null {
  if (!resultOptions(m).includes("winner") || !otherSide(m, winnerId)) return null;
  return { score_a: shown.a ?? m.score_a, score_b: shown.b ?? m.score_b, ...extra, ...pickedFields(at), winner_id: winnerId };
}

/** "A is behind 9–12": a warning before Select Winner records the trailing side. Never a block. */
export function behindWarning(m: Sides, winnerId: string, shown: { a: number | null; b: number | null }): string | null {
  const a = shown.a ?? 0, b = shown.b ?? 0;
  const mine = winnerId === m.team_a_id ? a : b, theirs = winnerId === m.team_a_id ? b : a;
  return mine < theirs ? `behind ${mine}–${theirs}` : null;
}

export type UndoPlan =
  | { ok: true; plan: KnockoutPlan }
  | { ok: false; reason: "not-a-result" | "bye" | "knockout-started" | "replacement-next" };

/**
 * ↶ Undo result: the match goes back to "not played" (no court, no score).
 * Knockout: the slot it filled in the next round is emptied, and a later
 * match that already started is reset (listed in `cleared`, ask first).
 * Refused for byes, for a group match once the event's knockout exists (the
 * bracket was built from that table), and when the next slot now holds a
 * replacement team.
 */
export function planUndoResult(all: Match[], m: Match): UndoPlan {
  if (!m.confirmed && m.status !== "completed") return { ok: false, reason: "not-a-result" };
  if (m.is_bye) return { ok: false, reason: "bye" };
  if (m.stage === "group") {
    const ko = all.some(x => x.category_id === m.category_id && x.stage === "knockout");
    if (ko) return { ok: false, reason: "knockout-started" };
    return { ok: true, plan: { updates: [{ id: m.id, patch: { ...RESET_MATCH } }], cleared: [] } };
  }
  const next = all.find(x => x.category_id === m.category_id && x.stage === "knockout" && !x.is_bronze &&
    x.round_idx === (m.round_idx ?? -9) + 1 && x.slot_idx === Math.floor(m.slot_idx / 2));
  const side = m.slot_idx % 2 === 0 ? "team_a_id" : "team_b_id";
  if (next && m.winner_id && next[side] != null && next[side] !== m.winner_id) return { ok: false, reason: "replacement-next" };
  const down = planKnockoutUndo(all, m);
  return {
    ok: true,
    plan: { updates: [{ id: m.id, patch: { ...RESET_MATCH } }, ...down.updates], cleared: down.cleared },
  };
}


/**
 * The question asked before a result option saves. Names who wins and who
 * forfeits or retires; Select Winner on the trailing side gets a warning
 * (never a block: an injury can rightly give the win to the side behind).
 */
export function resultConfirmText(
  kind: ResultOption, m: Pick<Match, "team_a_id" | "team_b_id" | "stage">, chosenId: string,
  shown: { a: number | null; b: number | null }, name: (teamId: string | null) => string,
): string {
  const other = otherSide(m, chosenId);
  const through = m.stage === "knockout" ? " and goes through" : "";
  const score = `${shown.a ?? 0}–${shown.b ?? 0}`;
  if (kind === "walkover") {
    return `Walkover: ${name(chosenId)} win${through}.\n${name(other)} forfeit. No points count either way.`;
  }
  if (kind === "retired") {
    return `${name(chosenId)} retire (injury).\n${name(other)} win${through}. The score so far (${score}) is shown, but no points count either way.`;
  }
  const behind = behindWarning(m, chosenId, shown);
  return `${name(chosenId)} win${through}?` + (behind
    ? `\n\n⚠️ ${name(chosenId)} are ${behind} on the score on screen. The score stays and counts in point difference. For an injury use Retired instead.`
    : `\nThe score on screen (${score}) stays.`);
}

/** Why Undo was refused, in words for the toast. */
export function undoRefusedText(reason: Exclude<UndoPlan, { ok: true }>["reason"]): string {
  switch (reason) {
    case "knockout-started": return "This event's knockout has started, so its group results are fixed. Use Edit Score to correct a score.";
    case "replacement-next": return "The next round now holds a replacement team, so this result can't be undone. Use Edit Score to correct the score.";
    case "bye": return "A bye isn't a match, so there is nothing to undo.";
    default: return "This match has no result to undo.";
  }
}
