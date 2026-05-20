export type AgeBand = "kid" | "teen" | "adult";

export type TournamentFees = {
  [band in AgeBand]?: { member: number; non_member: number };
};

export type Tournament = {
  id: string;
  name: string;
  event_date: string | null;
  phase: "none" | "group" | "knockout"; // legacy — use Category.phase instead
  rounds_per_pair: number;               // legacy — use Category.rounds_per_pair
  num_courts: number;
  created_at: string;
  // v12: public registration metadata (all nullable except fees + registration_open)
  venue_name: string | null;
  venue_address: string | null;
  venue_map_url: string | null;
  event_time: string | null;             // HH:MM:SS (Postgres time)
  registration_deadline: string | null;  // ISO timestamp
  contact_info: string | null;
  e_transfer_email: string | null;
  fees: TournamentFees;
  registration_open: boolean;
  terms_text: string | null;             // plain text, \n\n = paragraph break
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
  groups_count: number;       // 0 = auto-derive at stage-start time via formatPlanner
  top_n_advance: number;      // 0 = auto-derive (qualifiers per group → knockout)
  sort_order: number;
  created_at: string;
  // v12: public registration metadata
  age_band: AgeBand | null;
  allow_solo_signup: boolean;
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
  checked_in_at: string | null; // tournament-day check-in timestamp; null = not checked in
  email: string | null;         // optional contact email for court-allocation notifications
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
  /** Set when admin allocates a court (warm-up phase begins). NULL until allocated. */
  court_allocated_at: string | null;
  queue_position: number | null;
  extended_minutes: number;
};

export type PlayerCategory = {
  id: string;
  player_id: string;
  category_id: string;
};

export type TeamWithPlayers = Team & { p1: Player; p2: Player | null };

// Computed at runtime per match by useScheduling
export type ProjectedMatch = Match & {
  projected_start_at: string | null; // wall-clock projection
  delta_min: number | null;          // signed minutes vs schedule
  delta_label: string;               // human-readable
};

// v12: public registration submission record
export type PendingRegistration = {
  id: string;
  tournament_id: string;
  category_id: string;
  submitted_at: string;

  player_name: string;
  player_email: string;
  player_phone: string | null;
  player_is_member: boolean;

  partner_name: string | null;
  partner_email: string | null;
  partner_phone: string | null;
  partner_is_member: boolean | null;

  payment_reference: string;
  payment_paid_full_for_partner: boolean;
  comments: string | null;
  group_choice: "open" | "members" | null;

  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;

  approved_player_id: string | null;
  approved_partner_id: string | null;
  approved_team_id: string | null;
};

// Payload accepted by the register-player Edge Function
export type PublicRegistrationPayload = {
  tournament_id: string;
  category_id: string;
  player_name: string;
  player_email: string;
  player_phone?: string;
  player_is_member: boolean;
  partner_name?: string;
  partner_email?: string;
  partner_phone?: string;
  partner_is_member?: boolean;
  payment_reference: string;
  payment_paid_full_for_partner?: boolean;
  comments?: string;
  group_choice?: "open" | "members";
};
