// PROTOTYPE (assessment, Nov 15 2026): 🔁 Replace team. Pure: nothing here writes.
//
// Knockout: put another team into a slot of a match that hasn't started. The
// team leaving keeps every result it already played. If it reached this match
// through a bye, the bye row moves to the new team (a bye is not a match).
// Group stage: swap a team that hasn't played yet into all its group matches.

import type { Match } from "../types";
import { hasProgress, type KnockoutPlan } from "./knockout";

type Side = "team_a_id" | "team_b_id";

export type ReplaceRefusal =
  | "wrong-category" | "not-knockout" | "bye" | "already-played" | "in-play" | "empty-slot"
  | "same-team" | "still-in-draw" | "sitting-out" | "knockout-started" | "has-played" | "already-in-group" | "no-matches";

export type ReplacePlan =
  | { ok: true; plan: KnockoutPlan; outgoing: string; incoming: string; matchIds: string[] }
  | { ok: false; reason: ReplaceRefusal; matches?: Match[] };

const isUnplayed = (m: Match) => !m.confirmed && m.status !== "completed" && !m.is_bye;

/**
 * Knockout: replace whoever is in `target[side]` with `incomingId`.
 * `incomingOut` says whether a team has a player sitting out.
 */
export function planReplaceKnockout(
  all: Match[], target: Match, side: Side, incomingId: string, incomingCategoryId: string | null,
  incomingOut: (teamId: string) => boolean = () => false,
): ReplacePlan {
  if (incomingCategoryId !== target.category_id) return { ok: false, reason: "wrong-category" };
  if (target.stage !== "knockout") return { ok: false, reason: "not-knockout" };
  if (target.is_bye) return { ok: false, reason: "bye" };
  if (target.confirmed || target.status === "completed") return { ok: false, reason: "already-played" };
  if (hasProgress(target)) return { ok: false, reason: "in-play" };       // on court, live or has a score: cancel the court first
  const outgoing = target[side];
  if (!outgoing) return { ok: false, reason: "empty-slot" };             // empty slot: that's "+ Select Team"
  if (outgoing === incomingId) return { ok: false, reason: "same-team" };
  if (incomingOut(incomingId)) return { ok: false, reason: "sitting-out" };

  const cat = all.filter(m => m.category_id === target.category_id);
  // The incoming team must not still be alive anywhere: an unplayed match of
  // its own (knockout slot or group match) means it is still in the draw.
  const alive = cat.filter(m => m.id !== target.id && isUnplayed(m) && (m.team_a_id === incomingId || m.team_b_id === incomingId));
  if (alive.length) return { ok: false, reason: "still-in-draw", matches: alive };
  // A team that came through a bye in round 1 still holds the bye row's win.
  const byeHeld = cat.filter(m => m.is_bye && m.winner_id === incomingId);
  if (byeHeld.some(b => cat.some(n => n.stage === "knockout" && n.round_idx === (b.round_idx ?? -9) + 1 &&
      n.slot_idx === Math.floor(b.slot_idx / 2) && isUnplayed(n) && n[b.slot_idx % 2 === 0 ? "team_a_id" : "team_b_id"] === incomingId))) {
    return { ok: false, reason: "still-in-draw" };
  }

  const updates: KnockoutPlan["updates"] = [{ id: target.id, patch: { [side]: incomingId } }];
  // If the team leaving got here through a bye, the bye goes with the slot.
  const feeder = cat.find(m => m.stage === "knockout" && m.round_idx === (target.round_idx ?? -9) - 1 &&
    Math.floor(m.slot_idx / 2) === target.slot_idx && (m.slot_idx % 2 === 0) === (side === "team_a_id"));
  if (feeder?.is_bye && feeder.winner_id === outgoing) {
    const fs: Side = feeder.team_a_id === outgoing ? "team_a_id" : "team_b_id";
    updates.unshift({ id: feeder.id, patch: { [fs]: incomingId, winner_id: incomingId } });
  }
  return { ok: true, plan: { updates, cleared: [] }, outgoing, incoming: incomingId, matchIds: updates.map(u => u.id) };
}

/**
 * Group stage, before the team's first match: `outgoingId` is swapped for
 * `incomingId` in every one of its group matches. Refused once it has played
 * or is on court, once the event's knockout exists, or if the incoming team
 * already has a match in this event.
 */
export function planReplaceGroup(
  all: Match[], categoryId: string, outgoingId: string, incomingId: string, incomingCategoryId: string | null,
  incomingOut: (teamId: string) => boolean = () => false,
): ReplacePlan {
  if (incomingCategoryId !== categoryId) return { ok: false, reason: "wrong-category" };
  if (outgoingId === incomingId) return { ok: false, reason: "same-team" };
  if (incomingOut(incomingId)) return { ok: false, reason: "sitting-out" };
  const cat = all.filter(m => m.category_id === categoryId);
  if (cat.some(m => m.stage === "knockout")) return { ok: false, reason: "knockout-started" };
  const mine = cat.filter(m => m.stage === "group" && (m.team_a_id === outgoingId || m.team_b_id === outgoingId));
  if (!mine.length) return { ok: false, reason: "no-matches" };
  const played = mine.filter(m => hasProgress(m));
  if (played.length) return { ok: false, reason: "has-played", matches: played };
  if (cat.some(m => m.team_a_id === incomingId || m.team_b_id === incomingId || m.winner_id === incomingId)) {
    return { ok: false, reason: "already-in-group" };
  }
  const updates = mine.map(m => ({
    id: m.id,
    patch: (m.team_a_id === outgoingId ? { team_a_id: incomingId } : { team_b_id: incomingId }) as Partial<Match>,
  }));
  return { ok: true, plan: { updates, cleared: [] }, outgoing: outgoingId, incoming: incomingId, matchIds: updates.map(u => u.id) };
}
