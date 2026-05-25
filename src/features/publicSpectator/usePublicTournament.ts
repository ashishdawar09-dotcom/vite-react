import { useEffect, useState } from "react";
import * as db from "../../lib/db";
import { useTournamentData } from "../../hooks/useTournamentData";
import { useScheduling } from "../../hooks/useScheduling";
import type { Tournament } from "../../types";

/**
 * Resolves a public slug → tournament row, then composes the same data
 * pipeline an admin shell uses (snapshot polling + court projection).
 * Anonymous-friendly: every query relies on RLS SELECT-public policies from
 * schema_v14, so callers don't need an auth session.
 *
 * Return shape:
 *   - resolving=true while we look up the slug
 *   - tournament=null + notFound=true if the slug doesn't exist
 *   - tournament set + data loading via useTournamentData (spectator mode)
 *   - all the derived collections downstream LiveTab / hero / results pages need
 */
export function usePublicTournament(slug: string | undefined) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [resolving, setResolving] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!slug) {
      setResolving(false);
      setNotFound(true);
      return;
    }
    setResolving(true);
    setNotFound(false);
    setError(null);
    db.getTournamentBySlug(slug)
      .then(t => {
        if (cancelled) return;
        if (!t) setNotFound(true);
        else setTournament(t);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  // Spectator-mode data fetch (live_snapshot polling every 5s).
  const tournamentId = tournament?.id ?? null;
  const { players, teams, matches, categories, playerCategories, loading } =
    useTournamentData(tournamentId, false);

  // Court scheduling projection — same hook the admin shell uses.
  const numCourts = tournament?.num_courts ?? 2;
  const scheduling = useScheduling(matches, categories, numCourts);

  return {
    tournament,
    resolving,
    notFound,
    error,
    players,
    teams,
    matches,
    categories,
    playerCategories,
    numCourts,
    dataLoading: loading,
    ...scheduling,
  };
}
