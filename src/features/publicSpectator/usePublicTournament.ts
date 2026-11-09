import { useEffect, useRef, useState } from "react";
import * as db from "../../lib/db";
import { useTournamentData } from "../../hooks/useTournamentData";
import { useScheduling } from "../../hooks/useScheduling";
import type { Tournament } from "../../types";
import { clearCachedTournament, readCachedTournament, writeCachedTournament } from "./tournamentCache";

/**
 * Resolves a public slug → tournament row, then composes the same data
 * pipeline an admin shell uses (snapshot polling + court projection).
 * Anonymous-friendly: every query relies on RLS SELECT-public policies from
 * schema_v14, so callers don't need an auth session.
 *
 * Return shape:
 *   - resolving=true while we look up the slug (false from the start when
 *     this device has the row saved from an earlier visit)
 *   - tournament=null + notFound=true if the slug doesn't exist
 *   - tournament set + data loading via useTournamentData (spectator mode)
 *   - all the derived collections downstream LiveTab / hero / results pages need
 */
export function usePublicTournament(slug: string | undefined) {
  // A device that has opened this slug before starts on the row it saw then,
  // so scores start loading straight away; the lookup below still runs and
  // replaces it (see tournamentCache.ts).
  const [cached] = useState(() => (slug ? readCachedTournament(slug) : null));
  const [tournament, setTournament] = useState<Tournament | null>(cached);
  const [resolving, setResolving] = useState(cached === null);
  // The row on screen, for the lookup's error handling.
  const shownRef = useRef<Tournament | null>(cached);
  useEffect(() => { shownRef.current = tournament; }, [tournament]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to retry a failed slug lookup. Without it, a phone or the venue TV
  // that opened the page during a Wi-Fi drop or Supabase blip stayed stuck
  // until someone reloaded it.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryId: ReturnType<typeof setTimeout> | null = null;
    if (!slug) {
      setResolving(false);
      setNotFound(true);
      return;
    }
    if (attempt === 0) {
      const saved = readCachedTournament(slug);
      if (saved) {
        setTournament(prev => (prev && prev.id === saved.id && prev.slug === slug ? prev : saved));
        setResolving(false);
      } else {
        setResolving(true);
      }
    }
    setNotFound(false);
    db.getTournamentBySlug(slug)
      .then(t => {
        if (cancelled) return;
        setError(null);
        if (!t) {
          setNotFound(true);
          setTournament(null);
          clearCachedTournament(slug);
        } else {
          setTournament(t);
          writeCachedTournament(slug, t);
        }
      })
      .catch(e => {
        if (cancelled) return;
        // With a saved row on screen, keep showing it and retry quietly: the
        // scores come from the 5 s feed either way.
        if (!shownRef.current) setError(e instanceof Error ? e.message : String(e));
        // 5 s, 10 s, 20 s, then every 30 s.
        retryId = setTimeout(() => setAttempt(a => a + 1), Math.min(5_000 * 2 ** attempt, 30_000));
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
      if (retryId) clearTimeout(retryId);
    };
  }, [slug, attempt]);

  // Spectator-mode data fetch (live_snapshot polling every 5s).
  const tournamentId = tournament?.id ?? null;
  const { players, teams, matches, categories, playerCategories, loading } =
    useTournamentData(tournamentId, false);

  // Court scheduling projection — same hook the admin shell uses.
  const numCourts = tournament?.num_courts ?? 2;
  const scheduling = useScheduling(matches, categories, numCourts, teams);

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
