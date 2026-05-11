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

export async function updateTournament(id: string, patch: Partial<Tournament>) {
  // Strip immutable / derived fields defensively so callers can pass a full Tournament if they want.
  const { id: _i, created_at: _c, ...safe } = patch as Tournament;
  void _i; void _c;
  const { error } = await supabase.from("tournaments").update(safe).eq("id", id);
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
  // Atomic RPC: delete-stale + insert-new in one transaction (schema_v6).
  const { error } = await supabase.rpc("set_player_categories", {
    p_player_id: player_id,
    p_category_ids: category_ids,
  });
  if (error) {
    // Fallback for environments where RPC isn't deployed yet.
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) {
      const { data: existing, error: fetchErr } = await supabase
        .from("player_categories").select("category_id").eq("player_id", player_id);
      if (fetchErr) throw fetchErr;
      const current = new Set((existing ?? []).map((r: any) => r.category_id));
      const desired = new Set(category_ids);
      const toRemove = [...current].filter(id => !desired.has(id));
      const toAdd = [...desired].filter(id => !current.has(id));
      if (toRemove.length > 0) {
        const { error: e1 } = await supabase.from("player_categories").delete().eq("player_id", player_id).in("category_id", toRemove);
        if (e1) throw e1;
      }
      if (toAdd.length > 0) {
        const rows = toAdd.map(category_id => ({ player_id, category_id }));
        const { error: e2 } = await supabase.from("player_categories").upsert(rows, { onConflict: "player_id,category_id" });
        if (e2) throw e2;
      }
      return;
    }
    throw error;
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

/**
 * Atomically start a match on a court. Uses an RPC that locks the court row
 * before checking occupancy, so two admins can't double-book.
 * Returns true on success, false if court is already occupied (caller should
 * show a toast / pick another court).
 */
export async function startMatchOnCourt(id: string, court_number: number): Promise<boolean> {
  const { data, error } = await supabase.rpc("start_match_on_court", {
    p_match_id: id,
    p_court: court_number,
  });
  if (error) {
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) {
      // Fallback to legacy non-atomic update if RPC not deployed.
      const { error: e } = await supabase
        .from("matches")
        .update({ status: "live", started_at: new Date().toISOString(), court_number })
        .eq("id", id);
      if (e) throw e;
      return true;
    }
    throw error;
  }
  return data === true;
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
  // Atomic via RPC. Falls back to non-atomic dual update if RPC missing.
  const { error } = await supabase.rpc("swap_match_queue_positions", {
    p_id1: id1, p_pos1: pos1, p_id2: id2, p_pos2: pos2,
  });
  if (error) {
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) {
      const [r1, r2] = await Promise.all([
        supabase.from("matches").update({ queue_position: pos2 }).eq("id", id1),
        supabase.from("matches").update({ queue_position: pos1 }).eq("id", id2),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      return;
    }
    throw error;
  }
}

export async function reassignCourt(id: string, court_number: number) {
  const { error } = await supabase.from("matches").update({ court_number }).eq("id", id);
  if (error) throw error;
}

export async function extendMatch(id: string, extraMinutes: number) {
  // Atomic increment via RPC — eliminates lost-update race when two admins
  // tap "+5 min" concurrently. Falls back to read-modify-write if RPC missing.
  const { error } = await supabase.rpc("extend_match", {
    p_match_id: id,
    p_extra_minutes: extraMinutes,
  });
  if (error) {
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) {
      const { data } = await supabase.from("matches").select("extended_minutes").eq("id", id).single();
      const current = (data as any)?.extended_minutes ?? 0;
      const { error: e } = await supabase.from("matches").update({ extended_minutes: current + extraMinutes }).eq("id", id);
      if (e) throw e;
      return;
    }
    throw error;
  }
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

// LIVE SNAPSHOT (single round-trip for spectators) -----------------------------

export type LiveSnapshot = {
  tournament: any;
  players: Player[];
  teams: any[];
  matches: Match[];
  categories: Category[];
  player_categories: PlayerCategory[];
  generated_at: number;
};

export async function liveSnapshot(tournament_id: string): Promise<LiveSnapshot | null> {
  const { data, error } = await supabase.rpc("live_snapshot", { p_tournament_id: tournament_id });
  if (error) {
    // Falls back to multi-fetch path if RPC not deployed; caller will use the
    // legacy loadAll() in useTournamentData.
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) {
      return null;
    }
    throw error;
  }
  return data as LiveSnapshot;
}

// TOURNAMENT ADMINS ------------------------------------------------------------

export type TournamentAdmin = {
  id: string;
  email: string;
  added_at: string;
};

export async function listTournamentAdmins(): Promise<TournamentAdmin[]> {
  const { data, error } = await supabase
    .from("tournament_admins")
    .select("id, email, added_at")
    .order("added_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TournamentAdmin[];
}

export async function addTournamentAdmin(email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    throw new Error("Enter a valid email address");
  }
  const { error } = await supabase
    .from("tournament_admins")
    .insert({ email: clean });
  if (error) {
    if (error.code === "23505" || /duplicate/i.test(error.message ?? "")) {
      throw new Error("That email is already an admin");
    }
    throw error;
  }
}

export async function removeTournamentAdmin(email: string): Promise<void> {
  const { error } = await supabase
    .from("tournament_admins")
    .delete()
    .eq("email", email.toLowerCase());
  if (error) throw error;
}

/**
 * Check whether the given email is currently an admin. Returns false if
 * email is null/empty or the row is not visible (RLS may hide it for
 * non-admin users; this is fine — the lookup-self policy still lets a
 * user see their own row).
 */
export async function isEmailAdmin(email: string | null): Promise<boolean> {
  if (!email) return false;
  const { data, error } = await supabase
    .from("tournament_admins")
    .select("email")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) {
    // If the table doesn't exist yet (pre-v6), treat as not-admin so we
    // don't break the app during migrations.
    if (/relation .* does not exist/i.test(error.message ?? "")) return false;
    throw error;
  }
  return !!data;
}

// AUDIT LOG --------------------------------------------------------------------

export type MatchAuditEntry = {
  id: number;
  match_id: string;
  tournament_id: string | null;
  changed_at: string;
  changed_by: string | null;
  action: "insert" | "update" | "delete";
  before_data: any | null;
  after_data: any | null;
  changed_fields: string[] | null;
};

export async function listMatchAudit(match_id: string, limit = 50): Promise<MatchAuditEntry[]> {
  const { data, error } = await supabase
    .from("match_audit_log")
    .select("*")
    .eq("match_id", match_id)
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (/relation .* does not exist/i.test(error.message ?? "")) return [];
    throw error;
  }
  return (data ?? []) as MatchAuditEntry[];
}
