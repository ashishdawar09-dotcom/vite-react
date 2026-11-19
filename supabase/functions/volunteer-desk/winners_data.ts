// supabase/functions/volunteer-desk/winners_data.ts
//
// Reads what champions.ts needs for one tournament. Used by the desk's
// Winners tab (volunteer-desk) and by the public winners feed (winners-feed).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { type ChampCategory, type ChampMatch, type ChampPlayer, type ChampTeam, championTeamId, type WinnerPhoto, type WinnersEvent, winnersEvents } from "./champions.ts";

export async function loadWinners(supabase: SupabaseClient, tournamentId: string): Promise<WinnersEvent[]> {
  const [{ data: cats, error: cErr }, { data: matches, error: mErr }, { data: teams }, { data: photos }] = await Promise.all([
    supabase.from("categories").select("id, name, sort_order, groups_count, top_n_advance").eq("tournament_id", tournamentId),
    supabase.from("matches").select("category_id, stage, round_idx, slot_idx, team_a_id, team_b_id, winner_id, confirmed, is_bye, is_bronze")
      .eq("tournament_id", tournamentId).limit(5000),
    supabase.from("teams").select("id, p1_id, p2_id").eq("tournament_id", tournamentId).limit(2000),
    supabase.from("category_winner_photos").select("category_id, photo_url, uploaded_by, updated_at").eq("tournament_id", tournamentId),
  ]);
  if (cErr || mErr) throw new Error(`winners read failed: ${(cErr ?? mErr)!.message}`);
  const categories = (cats ?? []) as ChampCategory[];
  const allMatches = (matches ?? []) as ChampMatch[];
  const allTeams = (teams ?? []) as ChampTeam[];
  // Only the champions' own rows are read from players.
  const teamById = new Map(allTeams.map((t) => [t.id, t]));
  const ids = new Set<string>();
  for (const c of categories) {
    const team = teamById.get(championTeamId(c, allMatches.filter((m) => m.category_id === c.id)) ?? "");
    for (const id of [team?.p1_id, team?.p2_id]) if (id) ids.add(id);
  }
  const { data: players } = ids.size
    ? await supabase.from("players").select("id, name, photo_url").in("id", [...ids])
    : { data: [] };
  return winnersEvents(categories, allMatches, allTeams, (players ?? []) as ChampPlayer[], (photos ?? []) as WinnerPhoto[]);
}
