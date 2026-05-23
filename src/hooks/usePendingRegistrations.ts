import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react";
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
      );
    // subscribe() can throw synchronously if WebSocket is broken in this
    // runtime (browser extension, blocked CSP, etc.). Catch and degrade —
    // pending list still works via manual refetch.
    try {
      channel.subscribe();
    } catch (err) {
      Sentry.addBreadcrumb({
        category: "realtime",
        level: "warning",
        message: "pending-registrations subscribe failed",
        data: { tournamentId, error: String(err) },
      });
      // eslint-disable-next-line no-console
      console.warn("[realtime] pending-registrations subscribe failed; refresh manually to see new entries", err);
    }
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
