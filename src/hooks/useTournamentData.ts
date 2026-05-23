import { useEffect, useRef, useState, useCallback } from "react";
import * as Sentry from "@sentry/react";
import { supabase } from "../lib/supabase";
import * as db from "../lib/db";
import type { Category, Match, Player, PlayerCategory, Team } from "../types";

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => { if (timer) clearTimeout(timer); };
  return debounced as T & { cancel(): void };
}

const SPECTATOR_POLL_MS = 5_000;

export function useTournamentData(tournamentId: string | null, isAdmin = false) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [playerCategories, setPlayerCategories] = useState<PlayerCategory[]>([]);
  const [loading, setLoading] = useState(false);

  const tidRef = useRef(tournamentId);
  tidRef.current = tournamentId;

  // If the live_snapshot RPC is not deployed, fall back to per-table fetches.
  const snapshotUnavailableRef = useRef(false);

  const loadPlayers = useCallback(async () => {
    if (!tidRef.current) return;
    const { data } = await supabase.from("players").select("*").eq("tournament_id", tidRef.current).order("sort_order");
    setPlayers((data ?? []) as Player[]);
  }, []);

  const loadTeams = useCallback(async () => {
    if (!tidRef.current) return;
    const { data } = await supabase.from("teams").select("*").eq("tournament_id", tidRef.current).order("sort_order");
    setTeams((data ?? []) as Team[]);
  }, []);

  const loadMatches = useCallback(async () => {
    if (!tidRef.current) return;
    const { data } = await supabase.from("matches").select("*").eq("tournament_id", tidRef.current).order("slot_idx");
    setMatches((data ?? []) as Match[]);
  }, []);

  const loadCategories = useCallback(async () => {
    if (!tidRef.current) return;
    const { data } = await supabase.from("categories").select("*").eq("tournament_id", tidRef.current).order("sort_order");
    setCategories((data ?? []) as Category[]);
  }, []);

  const loadPlayerCategories = useCallback(async () => {
    if (!tidRef.current) return;
    const pc = await db.listPlayerCategories(tidRef.current);
    setPlayerCategories(pc);
  }, []);

  const loadAllLegacy = useCallback(async () => {
    if (!tidRef.current) return;
    const tid = tidRef.current;
    const [p, t, m, c, pc] = await Promise.all([
      supabase.from("players").select("*").eq("tournament_id", tid).order("sort_order"),
      supabase.from("teams").select("*").eq("tournament_id", tid).order("sort_order"),
      supabase.from("matches").select("*").eq("tournament_id", tid).order("slot_idx"),
      supabase.from("categories").select("*").eq("tournament_id", tid).order("sort_order"),
      db.listPlayerCategories(tid),
    ]);
    setPlayers((p.data ?? []) as Player[]);
    setTeams((t.data ?? []) as Team[]);
    setMatches((m.data ?? []) as Match[]);
    setCategories((c.data ?? []) as Category[]);
    setPlayerCategories(pc);
  }, []);

  // Single-RPC snapshot for spectators. Falls back to legacy multi-fetch
  // if the live_snapshot RPC isn't deployed yet.
  const loadAllSnapshot = useCallback(async () => {
    if (!tidRef.current) return;
    if (snapshotUnavailableRef.current) {
      await loadAllLegacy();
      return;
    }
    try {
      const snap = await db.liveSnapshot(tidRef.current);
      if (snap === null) {
        snapshotUnavailableRef.current = true;
        await loadAllLegacy();
        return;
      }
      setPlayers((snap.players ?? []) as Player[]);
      setTeams((snap.teams ?? []) as Team[]);
      setMatches((snap.matches ?? []) as Match[]);
      setCategories((snap.categories ?? []) as Category[]);
      setPlayerCategories((snap.player_categories ?? []) as PlayerCategory[]);
    } catch (err) {
      // Keep last-good state on transient errors; will retry next tick.
      // eslint-disable-next-line no-console
      console.warn("[useTournamentData] snapshot fetch failed; will retry", err);
    }
  }, [loadAllLegacy]);

  const debouncedLoadPlayers = useRef(debounce(loadPlayers, 300));
  const debouncedLoadTeams = useRef(debounce(loadTeams, 300));
  const debouncedLoadMatches = useRef(debounce(loadMatches, 300));
  const debouncedLoadCategories = useRef(debounce(loadCategories, 300));
  const debouncedLoadPlayerCategories = useRef(debounce(loadPlayerCategories, 300));

  useEffect(() => {
    debouncedLoadPlayers.current = debounce(loadPlayers, 300);
    debouncedLoadTeams.current = debounce(loadTeams, 300);
    debouncedLoadMatches.current = debounce(loadMatches, 300);
    debouncedLoadCategories.current = debounce(loadCategories, 300);
    debouncedLoadPlayerCategories.current = debounce(loadPlayerCategories, 300);
  }, [loadPlayers, loadTeams, loadMatches, loadCategories, loadPlayerCategories]);

  useEffect(() => {
    if (!tournamentId) {
      setPlayers([]); setTeams([]); setMatches([]); setCategories([]); setPlayerCategories([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const initialLoad = isAdmin ? loadAllLegacy : loadAllSnapshot;
    initialLoad().then(() => { if (!cancelled) setLoading(false); });

    if (isAdmin) {
      // Admin: realtime (1 connection) for instant updates
      const pgChannel = supabase
        .channel(`pg:${tournamentId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `tournament_id=eq.${tournamentId}` }, () => {
          debouncedLoadPlayers.current();
          debouncedLoadPlayerCategories.current();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "teams", filter: `tournament_id=eq.${tournamentId}` }, () => {
          debouncedLoadTeams.current();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` }, () => {
          debouncedLoadMatches.current();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter: `tournament_id=eq.${tournamentId}` }, () => {
          debouncedLoadCategories.current();
          debouncedLoadPlayerCategories.current();
        })
        // player_categories has no tournament_id column; subscribe without filter.
        // listPlayerCategories() already scopes via inner-join on players.tournament_id.
        .on("postgres_changes", { event: "*", schema: "public", table: "player_categories" }, () => {
          debouncedLoadPlayerCategories.current();
        });
      // subscribe() can throw synchronously if WebSocket is unusable in this
      // runtime (browser extension monkey-patching, blocked CSP, etc.). Catch
      // and degrade — admin loses live updates but the rest of the UI works.
      try {
        pgChannel.subscribe();
      } catch (err) {
        Sentry.addBreadcrumb({
          category: "realtime",
          level: "warning",
          message: "admin tournament channel subscribe failed",
          data: { tournamentId, error: String(err) },
        });
        // eslint-disable-next-line no-console
        console.warn("[realtime] admin subscribe failed; manual refresh required for live updates", err);
      }

      return () => {
        cancelled = true;
        debouncedLoadPlayers.current.cancel();
        debouncedLoadTeams.current.cancel();
        debouncedLoadMatches.current.cancel();
        debouncedLoadCategories.current.cancel();
        debouncedLoadPlayerCategories.current.cancel();
        supabase.removeChannel(pgChannel);
      };
    } else {
      // Spectators: single live_snapshot RPC every 5s — one round-trip,
      // server-side aggregation. Skips ticks while tab is hidden to save BW.
      const tick = () => { if (!cancelled && !document.hidden) loadAllSnapshot(); };
      const pollId = setInterval(tick, SPECTATOR_POLL_MS);
      const onVisibility = () => { if (!document.hidden) tick(); };
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        cancelled = true;
        clearInterval(pollId);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }
  }, [tournamentId, isAdmin, loadAllLegacy, loadAllSnapshot, loadPlayerCategories]);

  return { players, teams, matches, categories, playerCategories, loading };
}
