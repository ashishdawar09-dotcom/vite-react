export type Tournament = {
  id: string;
  name: string;
  event_date: string | null;
  phase: "none" | "group" | "knockout"; // legacy — use Category.phase instead
  rounds_per_pair: number;               // legacy — use Category.rounds_per_pair
  num_courts: number;
  created_at: string;
};

export type Category = {
  id: string;
  tournament_id: string;
  name: string;
  team_size: 1 | 2;
  match_minutes: number;
  starts_at: string | null;
  phase: "none" | "group" | "knockout";
  rounds_per_pair: number;
  sort_order: number;
  created_at: string;
};

export type Player = {
  id: string;
  tournament_id: string;
  name: string;
  color: string;
  photo_url: string | null;
  note: string | null;
  active: boolean;
  sort_order: number;
};

export type Team = {
  id: string;
  tournament_id: string;
  category_id: string;
  name: string;
  p1_id: string;
  p2_id: string | null; // nullable for singles
  sort_order: number;
};

export type Match = {
  id: string;
  tournament_id: string;
  category_id: string;
  stage: "group" | "knockout";
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
  status: "pending" | "live" | "completed";
  started_at: string | null;
  scheduled_at: string | null;
  confirmed_at: string | null;
  court_number: number | null;
  queue_position: number | null;
  extended_minutes: number;
};

export type TeamWithPlayers = Team & { p1: Player; p2: Player | null };

// Computed at runtime per match by useScheduling
export type ProjectedMatch = Match & {
  projected_start_at: string | null; // wall-clock projection
  delta_min: number | null;          // signed minutes vs schedule
  delta_label: string;               // human-readable
};
