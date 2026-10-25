// Knockout bracket propagation, shared by the Knockout/Groups match cards
// (App.tsx) and the Matches tab.
//
// Everything is scoped to the confirmed match's own category. The admin's
// default "All" view holds every category's matches, and round/slot numbers
// repeat across categories, so a lookup by round and slot alone can write a
// winner into another category's bracket.
//
// A downstream match is only reset when the team in its slot actually
// changes. Re-confirming a corrected score with the same winner leaves the
// next round, and anything already played there, untouched.

import type { Match } from "../types";

export type MatchUpdate = { id: string; patch: Partial<Match> };
export type KnockoutPlan = {
  /** Writes to make, in order. */
  updates: MatchUpdate[];
  /** Matches whose result, score, court or clock these updates wipe. Ask before applying when non-empty. */
  cleared: Match[];
};

/** Fields that return a match to "not started". Mirrors db.rescheduleMatch, plus the warm-up timestamp. */
export const RESET_MATCH: Partial<Match> = {
  winner_id: null,
  confirmed: false,
  confirmed_at: null,
  score_a: null,
  score_b: null,
  status: "pending",
  is_walkover: false,
  started_at: null,
  court_number: null,
  court_allocated_at: null,
  extended_minutes: 0,
};

type Side = "team_a_id" | "team_b_id";

/** True once anything has happened on the match beyond having its teams filled in. */
function hasProgress(m: Match): boolean {
  return !!(
    m.winner_id || m.confirmed || m.status !== "pending" || m.started_at ||
    m.court_allocated_at || m.court_number != null || m.score_a != null || m.score_b != null
  );
}

/**
 * Work out every bracket write that follows from `match` being won by
 * `winnerId`. `all` may hold any mix of categories and stages; only the
 * match's own category's knockout rows are read. Pure: nothing is written.
 */
export function planKnockoutAdvance(all: Match[], match: Match, winnerId: string | null): KnockoutPlan {
  const plan: KnockoutPlan = { updates: [], cleared: [] };
  if (match.stage !== "knockout" || match.round_idx == null || match.is_bronze || !winnerId) return plan;

  // Working copies, so a cascade sees the effect of earlier steps.
  const rows = new Map<string, Match>();
  for (const m of all) {
    if (m.category_id === match.category_id && m.stage === "knockout" && m.round_idx != null) rows.set(m.id, { ...m });
  }
  const tree = () => [...rows.values()].filter(m => !m.is_bronze);
  const finalRound = Math.max(...[...rows.values()].map(m => m.round_idx!));
  const bronze = [...rows.values()].find(m => m.is_bronze) ?? null;

  const order: string[] = [];
  const patches = new Map<string, Partial<Match>>();
  const write = (target: Match, patch: Partial<Match>) => {
    Object.assign(target, patch);
    if (!patches.has(target.id)) { patches.set(target.id, {}); order.push(target.id); }
    Object.assign(patches.get(target.id)!, patch);
  };

  // Put `team` into `target[side]`. If that changes who is in the slot and
  // the target had already started, reset it and pull its old result out of
  // the rounds it fed.
  const place = (target: Match, side: Side, team: string | null, withReset: boolean) => {
    if (target[side] === team) return;
    const before = { ...target };
    if (withReset && hasProgress(before)) {
      plan.cleared.push(before);
      write(target, { [side]: team, ...RESET_MATCH });
      if (before.winner_id) advance(before, null);
    } else {
      write(target, { [side]: team });
    }
  };

  // `from` now produces `winner` (null = its result was wiped).
  function advance(from: Match, winner: string | null) {
    const r = from.round_idx!;
    const next = tree().find(m => m.round_idx === r + 1 && m.slot_idx === Math.floor(from.slot_idx / 2));
    if (next) place(next, from.slot_idx % 2 === 0 ? "team_a_id" : "team_b_id", winner, true);

    if (bronze && r === finalRound - 1) {
      const loser = winner == null ? null : (from.team_a_id === winner ? from.team_b_id : from.team_a_id);
      place(bronze, from.slot_idx === 0 ? "team_a_id" : "team_b_id", loser ?? null, true);
    }
  }

  advance(rows.get(match.id) ?? { ...match }, winnerId);
  plan.updates = order.map(id => ({ id, patch: patches.get(id)! }));
  return plan;
}

/** Apply a plan's writes in order. Stops at, and rethrows, the first failure. */
export async function applyPlan(plan: KnockoutPlan, write: (id: string, patch: Partial<Match>) => Promise<void>) {
  for (const u of plan.updates) await write(u.id, u.patch);
}

/** One line per cleared match, for the confirm prompt. */
export function describeCleared(cleared: Match[], label: (m: Match) => string): string {
  return cleared.map(m => `• ${label(m)}${m.winner_id ? " (result)" : m.started_at || m.court_number != null ? " (on court)" : ""}`).join("\n");
}

/** "Semi-final 2", "Final", "Bronze match", from the match's own category. */
export function knockoutLabel(m: Match, all: Match[]): string {
  if (m.is_bronze) return "Bronze match";
  const rounds = all.filter(x => x.category_id === m.category_id && x.stage === "knockout" && x.round_idx != null).map(x => x.round_idx!);
  const fromFinal = Math.max(...rounds, m.round_idx ?? 0) - (m.round_idx ?? 0);
  if (fromFinal === 0) return "Final";
  const name = fromFinal === 1 ? "Semi-final" : fromFinal === 2 ? "Quarter-final" : `Round ${(m.round_idx ?? 0) + 1}`;
  return `${name} ${m.slot_idx + 1}`;
}

/**
 * Plan the bracket writes for `match` being won by `winnerId` and, if they
 * would wipe anything already played or on court, ask first. Returns null when
 * the admin cancels; call it before saving the match itself so a cancel
 * changes nothing.
 */
export function confirmKnockoutPlan(
  all: Match[], match: Match, winnerId: string | null,
  ask: (message: string) => boolean = msg => window.confirm(msg),
): KnockoutPlan | null {
  const plan = planKnockoutAdvance(all, match, winnerId);
  if (plan.cleared.length === 0) return plan;
  const list = describeCleared(plan.cleared, m => knockoutLabel(m, all));
  return ask(`This changes who goes through, so these matches will be reset and must be played again:\n\n${list}\n\nContinue?`) ? plan : null;
}

export type PlacePlan = KnockoutPlan & {
  /** Matches the team has already played (or the target itself, if confirmed). Non-empty = refuse. */
  blocked: Match[];
};

/**
 * "+ Select Team": put `teamId` into `target[side]`, taking it out of any
 * other slot it holds in the same category's bracket. A team with a result
 * anywhere in the bracket is never moved (that used to wipe the semi and the
 * Final it had played); `blocked` lists those matches and nothing is written.
 * Unplayed slots it leaves are emptied; one that was on court is reset and
 * listed in `cleared` so the caller can ask first. Pure: nothing is written.
 */
export function planPlaceTeam(all: Match[], target: Match, side: Side, teamId: string): PlacePlan {
  const plan: PlacePlan = { updates: [], cleared: [], blocked: [] };
  if (target.confirmed && !target.is_bye) { plan.blocked.push(target); return plan; }

  const others = all.filter(m =>
    m.id !== target.id && m.category_id === target.category_id && m.stage === "knockout" &&
    (m.team_a_id === teamId || m.team_b_id === teamId || m.winner_id === teamId));
  plan.blocked = others.filter(m => !m.is_bye && (m.confirmed || m.winner_id != null));
  if (plan.blocked.length) return plan;

  for (const m of others) {
    const patch: Partial<Match> = {};
    if (m.team_a_id === teamId) patch.team_a_id = null;
    if (m.team_b_id === teamId) patch.team_b_id = null;
    if (m.is_bye) {
      patch.winner_id = null;
    } else if (hasProgress(m)) {
      plan.cleared.push(m);
      Object.assign(patch, RESET_MATCH);
    }
    plan.updates.push({ id: m.id, patch });
  }
  plan.updates.push({ id: target.id, patch: { [side]: teamId } });
  return plan;
}
