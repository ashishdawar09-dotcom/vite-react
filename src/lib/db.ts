import { supabase } from "./supabase";
import type { Match, Player, Tournament } from "../types";

const PAL = ["#E63946","#457B9D","#2A9D8F","#E9C46A","#F4A261","#264653","#6A4C93","#1982C4","#FF595E","#8AC926","#FFCA3A","#6A0572","#3A86FF","#FB5607","#FF006E","#8338EC"];

const SEED = [
  "Sanjiv","Summit","Rakesh","Balvir","Rajat","Sagar",
  { name: "Abdul", note: "injured" },
  "Kham","Jas","Ashish","Rony","Amit","Raghav","Raghav's Partner",
];

export async function listTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Tournament[];
}

export async function createTournament(name: string, eventDate: string | null, seedPlayers: boolean): Promise<Tournament> {
  const { data: t, error } = await supabase
    .from("tournaments")
    .insert({ name, event_date: eventDate, phase: "none" })
    .select()
    .single();
  if (error) throw error;
  if (seedPlayers) {
    const rows = SEED.map((s, i) => {
      const obj = typeof s === "string" ? { name: s } : s;
      return {
        tournament_id: t.id,
        name: obj.name,
        note: (obj as any).note ?? null,
        color: PAL[i % PAL.length],
        active: !(obj as any).note,
        sort_order: i,
      };
    });
    const { error: pe } = await supabase.from("players").insert(rows);
    if (pe) throw pe;
  }
  return t as Tournament;
}

export async function deleteTournament(id: string) {
  const { error } = await supabase.from("tournaments").delete().eq("id", id);
  if (error) throw error;
}

export async function setPhase(id: string, phase: Tournament["phase"]) {
  const { error } = await supabase.from("tournaments").update({ phase }).eq("id", id);
  if (error) throw error;
}

export async function setRoundsPerPair(id: string, rounds: number) {
  const { error } = await supabase.from("tournaments").update({ rounds_per_pair: rounds }).eq("id", id);
  if (error) throw error;
}

export async function startMatch(id: string) {
  const { error } = await supabase.from("matches").update({ status: "live", started_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// PLAYERS ----------------------------------------------------------------

export async function addPlayer(tournament_id: string, name: string, sort_order: number) {
  const color = PAL[Math.floor(Math.random() * PAL.length)];
  const { error } = await supabase.from("players").insert({ tournament_id, name, color, active: true, sort_order });
  if (error) throw error;
}

export async function updatePlayer(id: string, patch: Partial<Player>) {
  const { error } = await supabase.from("players").update(patch).eq("id", id);
  if (error) throw error;
}

export async function uploadPlayerPhoto(playerId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${playerId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("player-photos").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("player-photos").getPublicUrl(path);
  return data.publicUrl;
}

// TEAMS ------------------------------------------------------------------

export async function createTeam(tournament_id: string, p1_id: string, p2_id: string, sort_order: number, name?: string) {
  const { error } = await supabase
    .from("teams")
    .insert({ tournament_id, p1_id, p2_id, sort_order, name: name ?? `Team ${sort_order + 1}` });
  if (error) throw error;
}

export async function deleteTeam(id: string) {
  const { error } = await supabase.from("teams").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteTeamsForTournament(tournament_id: string) {
  const { error } = await supabase.from("teams").delete().eq("tournament_id", tournament_id);
  if (error) throw error;
}

export async function deleteTeamsContainingPlayer(player_id: string) {
  const { error } = await supabase
    .from("teams")
    .delete()
    .or(`p1_id.eq.${player_id},p2_id.eq.${player_id}`);
  if (error) throw error;
}

// MATCHES ----------------------------------------------------------------

export async function insertMatches(rows: Omit<Match, "id">[]) {
  if (!rows.length) return;
  const { error } = await supabase.from("matches").insert(rows);
  if (error) throw error;
}

export async function updateMatch(id: string, patch: Partial<Match>) {
  const { error } = await supabase.from("matches").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteMatchesForTournament(tournament_id: string) {
  const { error } = await supabase.from("matches").delete().eq("tournament_id", tournament_id);
  if (error) throw error;
}
