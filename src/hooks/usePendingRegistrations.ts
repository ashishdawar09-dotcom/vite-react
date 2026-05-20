import { useCallback, useEffect, useRef, useState } from "react";
import { listPendingRegistrations } from "../lib/db";
import { supabase } from "../lib/supabase";
import type { PendingRegistration } from "../types";

type State = {
  pending: PendingRegistration[];
  loading: boolean;
  error: string | null;
};

// Admin-only hook: subscribes to pending_registrations changes for one
// tournament. Mirrors the postgres_changes channel pattern from
// useTournamentData. Quietly no-ops if isAdmin is false (RLS would block reads
// anyway, but skipping the request keeps the network clean).
export function usePendingRegistrations(
  tournamentId: string | null | undefined,
  isAdmin: boolean,
): State & { refetch: () => Promise<void>; removeLocal: (id: string) => void } {
  const [state, setState] = useState<State>({ pending: [], loading: false, error: null });
  const debounceRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!tournamentId || !isAdmin) {
      setState({ pending: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const rows = await listPendingRegistrations(tournamentId, "pending");
      setState({ pending: rows, loading: false, error: null });
    } catch (e) {
      setState({
        pending: [],
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, [tournamentId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime subscription, debounced (300ms) to coalesce rapid changes
  useEffect(() => {
    if (!tournamentId || !isAdmin) return;
    const channel = supabase
      .channel(`pending-reg:${tournamentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pending_registrations",
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => {
          if (debounceRef.current) window.clearTimeout(debounceRef.current);
          debounceRef.current = window.setTimeout(() => { void load(); }, 300);
        },
      )
      .subscribe();
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [tournamentId, isAdmin, load]);

  // Optimistic removal helper for approve/reject — avoids waiting for realtime
  const removeLocal = useCallback((id: string) => {
    setState((s) => ({ ...s, pending: s.pending.filter((r) => r.id !== id) }));
  }, []);

  return { ...state, refetch: load, removeLocal };
}
