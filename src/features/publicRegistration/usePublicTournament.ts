import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Category, Tournament } from "../../types";

type State = {
  tournament: Tournament | null;
  categories: Category[];
  loading: boolean;
  error: string | null;
};

// One-shot fetch of public tournament + categories via the anon client.
// Read RLS already allows anonymous SELECT on these tables. No realtime —
// the page is short-lived and a stale category list isn't critical.
export function usePublicTournament(tournamentId: string | undefined): State {
  const [state, setState] = useState<State>({
    tournament: null,
    categories: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!tournamentId) {
      setState({ tournament: null, categories: [], loading: false, error: "Missing tournament id" });
      return;
    }
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      const [tRes, cRes] = await Promise.all([
        supabase.from("tournaments").select("*").eq("id", tournamentId).maybeSingle(),
        supabase
          .from("categories")
          .select("*")
          .eq("tournament_id", tournamentId)
          .order("sort_order", { ascending: true }),
      ]);
      if (cancelled) return;
      if (tRes.error) {
        setState({ tournament: null, categories: [], loading: false, error: tRes.error.message });
        return;
      }
      if (!tRes.data) {
        setState({ tournament: null, categories: [], loading: false, error: "Tournament not found" });
        return;
      }
      setState({
        tournament: tRes.data as Tournament,
        categories: (cRes.data ?? []) as Category[],
        loading: false,
        error: cRes.error?.message ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [tournamentId]);

  return state;
}
