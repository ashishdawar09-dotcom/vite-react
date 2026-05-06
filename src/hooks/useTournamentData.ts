import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import * as db from "../lib/db";
import type { Category, Match, Player, PlayerCategory, Team } from "../types";

export function useTournamentData(tournamentId: string | null) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [playerCategories, setPlayerCategories] = useState<PlayerCategory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tournamentId) {
      setPlayers([]); setTeams([]); setMatches([]); setCategories([]); setPlayerCategories([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const [p, t, m, c, pc] = await Promise.all([
        supabase.from("players").select("*").eq("tournament_id", tournamentId).order("sort_order"),
        supabase.from("teams").select("*").eq("tournament_id", tournamentId).order("sort_order"),
        supabase.from("matches").select("*").eq("tournament_id", tournamentId).order("slot_idx"),
        supabase.from("categories").select("*").eq("tournament_id", tournamentId).order("sort_order"),
        db.listPlayerCategories(tournamentId),
      ]);
      if (cancelled) return;
      setPlayers((p.data ?? []) as Player[]);
      setTeams((t.data ?? []) as Team[]);
      setMatches((m.data ?? []) as Match[]);
      setCategories((c.data ?? []) as Category[]);
      setPlayerCategories(pc);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel(`tournament:${tournamentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `tournament_id=eq.${tournamentId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "teams", filter: `tournament_id=eq.${tournamentId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter: `tournament_id=eq.${tournamentId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "player_categories" }, () => load())
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [tournamentId]);

  return { players, teams, matches, categories, playerCategories, loading };
}
