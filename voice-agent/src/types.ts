// Shapes returned by the public `live_snapshot` RPC (see supabase/migrations).
// Only the fields the voice agent reads are listed.

export interface Env {
  AI: Ai;
  BadmintonVoiceAgent: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  DEFAULT_TOURNAMENT_ID?: string;
}

export interface Tournament {
  id: string;
  name: string;
  num_courts: number;
}

export interface Player {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  category_id: string;
  p1_id: string;
  p2_id: string | null;
}

export interface Category {
  id: string;
  name: string;
  team_size: number;
  match_minutes: number;
  starts_at: string | null;
  phase: "none" | "group" | "knockout" | string;
  sort_order: number;
  groups_count: number;
  top_n_advance: number;
  age_band: string | null;
  has_bronze_match: boolean;
}

export interface Match {
  id: string;
  category_id: string;
  stage: "group" | "knockout" | string;
  group_idx: number | null;
  round_idx: number | null;
  slot_idx: number;
  team_a_id: string | null;
  team_b_id: string | null;
  score_a: number | null;
  score_b: number | null;
  winner_id: string | null;
  confirmed: boolean;
  is_bye: boolean;
  is_walkover: boolean;
  status: "pending" | "live" | "done" | string;
  started_at: string | null;
  confirmed_at: string | null;
  scheduled_at: string | null;
  court_number: number | null;
  queue_position: number | null;
  extended_minutes: number | null;
  court_allocated_at: string | null;
}

export interface Snapshot {
  tournament: Tournament | null;
  players: Player[];
  teams: Team[];
  matches: Match[];
  categories: Category[];
  player_categories: { player_id: string; category_id: string }[];
  generated_at: number;
}

export interface ProjectedMatch extends Match {
  projected_start_at: string | null;
  delta_min: number | null;
  delta_label: string;
  projected_court: number | null;
}
