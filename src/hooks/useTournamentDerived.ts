import { useEffect, useMemo } from "react";
import { useScheduling } from "./useScheduling";
import type { Category, Match, Player, PlayerCategory, Team, Tournament } from "../types";

export type TeamView = Team & { p1: Player; p2: Player | null };

/**
 * Centralised derivation layer for App.tsx. Combines raw `useTournamentData`
 * output + the current-category selection into the ~15 derived collections
 * that every admin tab needs.
 *
 * Why a hook (vs. inline useMemo in App.tsx):
 *   - App.tsx was 1,085 lines; ~70 of them were these derivations.
 *   - The same memos used to be sprinkled across multiple components (a
 *     handful re-implemented `playerById` / `catById` inline — see the
 *     2026-05-25 perf pass which memoised them per-tab as an interim fix).
 *   - With this hook every consumer either reads from App's props (most
 *     tabs) OR can call the hook directly if they need the same shape
 *     (e.g. spectator pages already build a similar object via
 *     `publicDerive.ts`; that file is the leaner spectator-only variant).
 *
 * Memoization strategy: every derivation is keyed precisely on the inputs
 * it actually uses. The hook itself is cheap — every call sets up a small
 * number of `useMemo` calls; the heavy work only runs when the keyed input
 * changes (a new realtime push, an admin selecting a different category).
 *
 * `currentCategoryId === null` is the "All categories" selection (admin
 * default), and the hook returns whole-tournament collections in that
 * mode.
 */
export function useTournamentDerived(
  tournament: Tournament | null,
  players: Player[],
  teams: Team[],
  matches: Match[],
  categories: Category[],
  playerCategories: PlayerCategory[],
  currentCategoryId: string | null,
) {
  // Lookup tables. Tiny derivations, kept as their own memos so consumers
  // (tabs, modal pickers) get stable references between unrelated renders.
  const playerById = useMemo(
    () => Object.fromEntries(players.map(p => [p.id, p])),
    [players],
  );
  const catById = useMemo(
    () => Object.fromEntries(categories.map(c => [c.id, c])),
    [categories],
  );

  const currentCategory = useMemo(
    () => categories.find(c => c.id === currentCategoryId) ?? null,
    [categories, currentCategoryId],
  );

  // Tournament-level phase: the currently-selected category's phase if any,
  // else the phase of the first non-"none" category, else "none". Drives
  // the LIVE tab's stage badge ("GROUP STAGE" / "KNOCKOUT").
  const phase: "none" | "group" | "knockout" = useMemo(
    () => currentCategory?.phase
      ?? (categories.find(c => c.phase !== "none")?.phase ?? "none"),
    [currentCategory, categories],
  );

  // All teams (across categories) projected with embedded p1/p2 objects.
  // Filter strips orphan teams where the p1 player was deleted but the
  // team row hadn't been cleaned up yet.
  const allTeamsView = useMemo<TeamView[]>(
    () => teams.map(t => {
      const p1 = playerById[t.p1_id];
      const p2 = t.p2_id ? playerById[t.p2_id] : null;
      return { ...t, p1, p2 } as TeamView;
    }).filter(t => t.p1) as TeamView[],
    [teams, playerById],
  );
  const allTeamById = useMemo(
    () => Object.fromEntries(allTeamsView.map(t => [t.id, t])),
    [allTeamsView],
  );

  // Scoped to the current category (or the whole tournament if no category
  // is selected). Most tabs read teamsView, not allTeamsView.
  const teamsView = useMemo<TeamView[]>(
    () => currentCategoryId
      ? allTeamsView.filter(t => t.category_id === currentCategoryId)
      : allTeamsView,
    [allTeamsView, currentCategoryId],
  );
  const teamById = useMemo(
    () => Object.fromEntries(teamsView.map(t => [t.id, t])),
    [teamsView],
  );

  // Matches scoped to the current category.
  const categoryMatches = useMemo(
    () => currentCategoryId
      ? matches.filter(m => m.category_id === currentCategoryId)
      : matches,
    [matches, currentCategoryId],
  );

  // Group + knockout splits, with a deterministic tie-break on id so cards
  // never swap positions between snapshot polls while a user is editing a
  // score. Each is a sorted plain array — consumers `.map` over them.
  const groupMatches = useMemo(
    () => categoryMatches.filter(m => m.stage === "group").sort((a, b) =>
      ((a.group_idx ?? 0) - (b.group_idx ?? 0)) ||
      (a.slot_idx - b.slot_idx) ||
      a.id.localeCompare(b.id),
    ),
    [categoryMatches],
  );
  const knockoutMatches = useMemo(
    () => categoryMatches.filter(m => m.stage === "knockout").sort((a, b) =>
      ((a.round_idx ?? 0) - (b.round_idx ?? 0)) ||
      (a.slot_idx - b.slot_idx) ||
      a.id.localeCompare(b.id),
    ),
    [categoryMatches],
  );

  // Court count drives the scheduling projection. Falls back to 2 (the
  // default num_courts on a new tournament) so the hook stays valid even
  // before a tournament is selected.
  const numCourts = tournament?.num_courts ?? 2;
  const scheduling = useScheduling(matches, categories, numCourts);
  const { projected: projectedMatches, byId: projectedById, tournamentDeltaMin, tournamentDeltaLabel, liveByCourt } = scheduling;

  // Groups: a 2D array of TeamView, indexed by group_idx then by team. Used
  // by LiveTab + GroupsTab to render standings + per-group cards.
  const groups = useMemo<TeamView[][]>(() => {
    const map = new Map<number, Set<string>>();
    groupMatches.forEach(m => {
      if (m.group_idx == null) return;
      if (!map.has(m.group_idx)) map.set(m.group_idx, new Set());
      const s = map.get(m.group_idx)!;
      if (m.team_a_id) s.add(m.team_a_id);
      if (m.team_b_id) s.add(m.team_b_id);
    });
    return [...map.keys()].sort((a, b) => a - b).map(gi =>
      [...map.get(gi)!].map(id => teamById[id]).filter(Boolean) as TeamView[],
    );
  }, [groupMatches, teamById]);

  // Knockout: a 2D Match[][] indexed by round_idx then by slot_idx. Used by
  // KnockoutTab to render the bracket + by App.tsx propagateWinner.
  const knockout = useMemo<Match[][]>(() => {
    const map = new Map<number, Match[]>();
    knockoutMatches.forEach(m => {
      if (m.round_idx == null) return;
      if (!map.has(m.round_idx)) map.set(m.round_idx, []);
      map.get(m.round_idx)!.push(m);
    });
    return [...map.keys()].sort((a, b) => a - b).map(ri =>
      map.get(ri)!.sort((a, b) => a.slot_idx - b.slot_idx),
    );
  }, [knockoutMatches]);

  // Map each player to the set of categories they're assigned to (M2M join
  // collapsed for fast lookup). Used by the CategoryEditor + the active /
  // unpaired derivations below.
  const playerCategoryMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const pc of playerCategories) {
      if (!map.has(pc.player_id)) map.set(pc.player_id, new Set());
      map.get(pc.player_id)!.add(pc.category_id);
    }
    return map;
  }, [playerCategories]);

  // Active players in the current category (or all if no filter). This is
  // the source of truth for who's eligible to be paired here. Without this
  // filter, Auto-Pair / Partner-Picker pull in players from other categories
  // and tag the resulting teams with the wrong category_id.
  const active = useMemo(() => {
    const all = players.filter(p => p.active);
    if (!currentCategoryId) return all;
    return all.filter(p => playerCategoryMap.get(p.id)?.has(currentCategoryId));
  }, [players, currentCategoryId, playerCategoryMap]);

  const paired = useMemo(
    () => new Set(teamsView.flatMap(t => [t.p1_id, t.p2_id]).filter((id): id is string => id !== null)),
    [teamsView],
  );
  const unpaired = useMemo(
    () => active.filter(p => !paired.has(p.id)),
    [active, paired],
  );

  // Teams currently in the viewed category whose players don't all belong
  // to this category — leftovers from the pre-fix Auto-Pair bug. Surfaced
  // via the "Clean up" button on the Teams tab.
  const invalidTeamsInCategory = useMemo(() => {
    if (!currentCategoryId) return [];
    return teamsView.filter(t => {
      const p1Ok = playerCategoryMap.get(t.p1_id)?.has(currentCategoryId) ?? false;
      const p2Ok = !t.p2_id || (playerCategoryMap.get(t.p2_id)?.has(currentCategoryId) ?? false);
      return !p1Ok || !p2Ok;
    });
  }, [teamsView, currentCategoryId, playerCategoryMap]);

  // Voided to satisfy ESLint about useEffect not being used yet — App.tsx
  // still owns the editingPlayerCats sync effect because it needs setState
  // setters that aren't part of the derivation layer.
  void useEffect;

  return {
    // raw category context
    currentCategory,
    phase,
    catById,
    // player lookups
    playerById,
    playerCategoryMap,
    // team views
    allTeamsView,
    allTeamById,
    teamsView,
    teamById,
    // match views
    categoryMatches,
    groupMatches,
    knockoutMatches,
    // shape: groups / knockout brackets
    groups,
    knockout,
    // category-aware roster splits
    active,
    paired,
    unpaired,
    invalidTeamsInCategory,
    // scheduling pass-through (single source of truth for projected match
    // wall-clocks, court allocation, and overall tournament-delta state).
    numCourts,
    projectedMatches,
    projectedById,
    tournamentDeltaMin,
    tournamentDeltaLabel,
    liveByCourt,
  };
}
