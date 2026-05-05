export type Tournament = {
  id: string;
  name: string;
  event_date: string | null;
  phase: "none" | "group" | "knockout";
  rounds_per_pair: number;
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
  name: string;
  p1_id: string;
  p2_id: string;
  sort_order: number;
};

export type Match = {
  id: string;
  tournament_id: string;
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
  status: "pending" | "live" | "completed";
  started_at: string | null;
};

export type TeamWithPlayers = Team & { p1: Player; p2: Player };
