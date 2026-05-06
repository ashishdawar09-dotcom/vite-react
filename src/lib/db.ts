import { supabase } from "./supabase";
import type { Category, Match, Player, PlayerCategory, Tournament } from "../types";

const PAL = ["#E63946","#457B9D","#2A9D8F","#E9C46A","#F4A261","#264653","#6A4C93","#1982C4","#FF595E","#8AC926","#FFCA3A","#6A0572","#3A86FF","#FB5607","#FF006E","#8338EC"];

const SEED = [
  "Sanjiv","Summit","Rakesh","Balvir","Rajat","Sagar",
  { name: "Abdul", note: "injured" },
  "Kham","Jas","Ashish","Rony","Amit","Raghav","Raghav's Partner",
];

// TOURNAMENTS ------------------------------------------------------------

export async function listTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase.from("tournaments").select("*").order("created_at", { ascending: false });
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
  // Auto-create a default "Doubles" category so the new tournament is immediately usable
  await createCategory(t.id, "Doubles", 2, null, 12);
  return t as Tournament;
}

export async function deleteTournament(id: string) {
  const { error } = await supabase.from("tournaments").delete().eq("id", id);
  if (error) throw error;
}

export async function setNumCourts(id: string, numCourts: number) {
  const { error } = await supabase.from("tournaments").update({ num_courts: numCourts }).eq("id", id);
  if (error) throw error;
}

// CATEGORIES -------------------------------------------------------------

export async function listCategories(tournament_id: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("tournament_id", tournament_id)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as Category[];
}

export async function createCategory(
  tournament_id: string,
  name: string,
  team_size: 1 | 2,
  starts_at: string | null,
  match_minutes: number,
): Promise<Category> {
  const { data: existing } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("tournament_id", tournament_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const sort_order = existing && existing.length ? (existing[0].sort_order + 1) : 0;
  const { data, error } = await supabase
    .from("categories")
    .insert({ tournament_id, name, team_size, starts_at, match_minutes, sort_order, phase: "none", rounds_per_pair: 1 })
    .select()
    .single();
  if (error) throw error;
  return data as Category;
}

export async function updateCategory(id: string, patch: Partial<Category>) {
  const { error } = await supabase.from("categories").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCategory(id: string) {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

export async function setCategoryPhase(id: string, phase: Category["phase"]) {
  const { error } = await supabase.from("categories").update({ phase }).eq("id", id);
  if (error) throw error;
}

export async function setCategoryRoundsPerPair(id: string, rounds: number) {
  const { error } = await supabase.from("categories").update({ rounds_per_pair: rounds }).eq("id", id);
  if (error) throw error;
}

// PLAYERS ----------------------------------------------------------------

export async function addPlayer(tournament_id: string, name: string, sort_order: number): Promise<Player> {
  const color = PAL[Math.floor(Math.random() * PAL.length)];
  const { data, error } = await supabase.from("players").insert({ tournament_id, name, color, active: true, sort_order }).select().single();
  if (error) throw error;
  return data as Player;
}

export async function deletePlayer(id: string) {
  const { error } = await supabase.from("players").delete().eq("id", id);
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

// PLAYER-CATEGORY ASSIGNMENTS --------------------------------------------

export async function listPlayerCategories(tournament_id: string): Promise<PlayerCategory[]> {
  const { data, error } = await supabase
    .from("player_categories")
    .select("*, players!inner(tournament_id)")
    .eq("players.tournament_id", tournament_id);
  if (error) throw error;
  return (data ?? []).map((d: any) => ({ id: d.id, player_id: d.player_id, category_id: d.category_id }));
}

export async function setPlayerCategories(player_id: string, category_ids: string[]) {
  const { data: existing, error: fetchErr } = await supabase
    .from("player_categories").select("category_id").eq("player_id", player_id);
  if (fetchErr) throw fetchErr;
  const current = new Set((existing ?? []).map((r: any) => r.category_id));
  const desired = new Set(category_ids);
  const toRemove = [...current].filter(id => !desired.has(id));
  const toAdd = [...desired].filter(id => !current.has(id));
  if (toRemove.length > 0) {
    const { error } = await supabase.from("player_categories").delete().eq("player_id", player_id).in("category_id", toRemove);
    if (error) throw error;
  }
  if (toAdd.length > 0) {
    const rows = toAdd.map(category_id => ({ player_id, category_id }));
    const { error } = await supabase.from("player_categories").upsert(rows, { onConflict: "player_id,category_id" });
    if (error) throw error;
  }
}

export async function addPlayerToCategory(player_id: string, category_id: string) {
  const { error } = await supabase.from("player_categories").upsert({ player_id, category_id }, { onConflict: "player_id,category_id" });
  if (error) throw error;
}

export async function removePlayerFromCategory(player_id: string, category_id: string) {
  const { error } = await supabase.from("player_categories").delete().eq("player_id", player_id).eq("category_id", category_id);
  if (error) throw error;
}

// TEAMS ------------------------------------------------------------------

export async function createTeam(
  tournament_id: string,
  category_id: string,
  p1_id: string,
  p2_id: string | null,
  sort_order: number,
  name?: string,
) {
  const { error } = await supabase
    .from("teams")
    .insert({ tournament_id, category_id, p1_id, p2_id, sort_order, name: name ?? `Team ${sort_order + 1}` });
  if (error) throw error;
}

export async function deleteTeam(id: string) {
  const { error } = await supabase.from("teams").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteTeamsForCategory(category_id: string) {
  const { error } = await supabase.from("teams").delete().eq("category_id", category_id);
  if (error) throw error;
}

export async function deleteTeamsContainingPlayer(player_id: string, category_id?: string) {
  let q = supabase.from("teams").delete().or(`p1_id.eq.${player_id},p2_id.eq.${player_id}`);
  if (category_id) q = q.eq("category_id", category_id);
  const { error } = await q;
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

export async function deleteMatchesForCategory(category_id: string) {
  const { error } = await supabase.from("matches").delete().eq("category_id", category_id);
  if (error) throw error;
}

export async function startMatchOnCourt(id: string, court_number: number) {
  const { error } = await supabase
    .from("matches")
    .update({ status: "live", started_at: new Date().toISOString(), court_number })
    .eq("id", id);
  if (error) throw error;
}

export async function setMatchScheduledAt(id: string, scheduled_at: string | null) {
  const { error } = await supabase.from("matches").update({ scheduled_at }).eq("id", id);
  if (error) throw error;
}

export async function setMatchQueuePosition(id: string, queue_position: number) {
  const { error } = await supabase.from("matches").update({ queue_position }).eq("id", id);
  if (error) throw error;
}

export async function swapMatchQueuePositions(id1: string, pos1: number, id2: string, pos2: number) {
  const [r1, r2] = await Promise.all([
    supabase.from("matches").update({ queue_position: pos2 }).eq("id", id1),
    supabase.from("matches").update({ queue_position: pos1 }).eq("id", id2),
  ]);
  if (r1.error) throw r1.error;
  if (r2.error) throw r2.error;
}

export async function reassignCourt(id: string, court_number: number) {
  const { error } = await supabase.from("matches").update({ court_number }).eq("id", id);
  if (error) throw error;
}

export async function extendMatch(id: string, extraMinutes: number) {
  const { data } = await supabase.from("matches").select("extended_minutes").eq("id", id).single();
  const current = (data as any)?.extended_minutes ?? 0;
  const { error } = await supabase.from("matches").update({ extended_minutes: current + extraMinutes }).eq("id", id);
  if (error) throw error;
}

export async function selectMatchWinner(id: string, winner_id: string) {
  const { error } = await supabase.from("matches").update({
    winner_id, confirmed: true, status: "completed", confirmed_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

export async function rescheduleMatch(id: string) {
  const { error } = await supabase.from("matches").update({
    status: "pending", started_at: null, court_number: null, score_a: null, score_b: null,
    extended_minutes: 0, confirmed: false, winner_id: null, is_walkover: false, confirmed_at: null,
  }).eq("id", id);
  if (error) throw error;
}

export async function cancelMatch(id: string) {
  const { error } = await supabase.from("matches").update({
    status: "completed", confirmed: true, score_a: 0, score_b: 0, winner_id: null,
    is_walkover: true, confirmed_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

export async function markWalkover(id: string, winner_id: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("matches")
    .update({ winner_id, confirmed: true, status: "completed", is_walkover: true, confirmed_at: now })
    .eq("id", id);
  if (error) throw error;
}

// LEGACY / KEPT FOR COMPATIBILITY ----------------------------------------

export async function setRoundsPerPair(id: string, rounds: number) {
  // legacy tournament-level — prefer setCategoryRoundsPerPair
  const { error } = await supabase.from("tournaments").update({ rounds_per_pair: rounds }).eq("id", id);
  if (error) throw error;
}

export async function setPhase(id: string, phase: Tournament["phase"]) {
  // legacy tournament-level — prefer setCategoryPhase
  const { error } = await supabase.from("tournaments").update({ phase }).eq("id", id);
  if (error) throw error;
}

export async function startMatch(id: string) {
  // legacy — prefer startMatchOnCourt
  const { error } = await supabase
    .from("matches")
    .update({ status: "live", started_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTeamsForTournament(tournament_id: string) {
  const { error } = await supabase.from("teams").delete().eq("tournament_id", tournament_id);
  if (error) throw error;
}

export async function deleteMatchesForTournament(tournament_id: string) {
  const { error } = await supabase.from("matches").delete().eq("tournament_id", tournament_id);
  if (error) throw error;
}
