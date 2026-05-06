import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Category, Match, Player, Team } from "../types";

export function useTournamentData(tournamentId: string | null) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tournamentId) {
      setPlayers([]); setTeams([]); setMatches([]); setCategories([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const [p, t, m, c] = await Promise.all([
        supabase.from("players").select("*").eq("tournament_id", tournamentId).order("sort_order"),
        supabase.from("teams").select("*").eq("tournament_id", tournamentId).order("sort_order"),
        supabase.from("matches").select("*").eq("tournament_id", tournamentId).order("slot_idx"),
        supabase.from("categories").select("*").eq("tournament_id", tournamentId).order("sort_order"),
      ]);
      if (cancelled) return;
      setPlayers((p.data ?? []) as Player[]);
      setTeams((t.data ?? []) as Team[]);
      setMatches((m.data ?? []) as Match[]);
      setCategories((c.data ?? []) as Category[]);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel(`tournament:${tournamentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `tournament_id=eq.${tournamentId}` }, (p) => { console.log("[realtime] players", p.eventType); load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "teams", filter: `tournament_id=eq.${tournamentId}` }, (p) => { console.log("[realtime] teams", p.eventType); load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` }, (p) => { console.log("[realtime] matches", p.eventType); load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter: `tournament_id=eq.${tournamentId}` }, (p) => { console.log("[realtime] categories", p.eventType); load(); })
      .subscribe((status) => { console.log("[realtime] subscription status:", status); });

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [tournamentId]);

  return { players, teams, matches, categories, loading };
}
