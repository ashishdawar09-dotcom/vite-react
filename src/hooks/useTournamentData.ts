import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Match, Player, Team } from "../types";

export function useTournamentData(tournamentId: string | null) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tournamentId) {
      setPlayers([]); setTeams([]); setMatches([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const [p, t, m] = await Promise.all([
        supabase.from("players").select("*").eq("tournament_id", tournamentId).order("sort_order"),
        supabase.from("teams").select("*").eq("tournament_id", tournamentId).order("sort_order"),
        supabase.from("matches").select("*").eq("tournament_id", tournamentId).order("slot_idx"),
      ]);
      if (cancelled) return;
      setPlayers((p.data ?? []) as Player[]);
      setTeams((t.data ?? []) as Team[]);
      setMatches((m.data ?? []) as Match[]);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel(`tournament:${tournamentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `tournament_id=eq.${tournamentId}` }, (p) => { console.log("[realtime] players", p.eventType); load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "teams", filter: `tournament_id=eq.${tournamentId}` }, (p) => { console.log("[realtime] teams", p.eventType); load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` }, (p) => { console.log("[realtime] matches", p.eventType); load(); })
      .subscribe((status) => { console.log("[realtime] subscription status:", status); });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tournamentId]);

  return { players, teams, matches, loading };
}
