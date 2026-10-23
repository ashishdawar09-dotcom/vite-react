export type AgeBand = "kid" | "teen" | "adult";

export type PriceBasis = "per_player" | "per_team";

// Legacy: per-tournament fee grid, superseded by Category.price. Still a
// column in the database but no longer read or written by the app.
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
  // v15: share surface — public spectator URL /t/:slug. Auto-generated on
  // insert by a DB trigger if the client doesn't supply one (current behavior).
  slug: string;
  // Waiver + concessions (20261010000000_waiver_consent). A tournament with
  // waiver_text makes every participant accept it; waiver_version is stored
  // with each consent. youth_price / student_price are reduced per-player
  // fees, applied when lower than the category price.
  rules_url: string | null;
  waiver_url: string | null;
  waiver_text: string | null;
  waiver_version: string | null;
  youth_price: number | null;
  student_price: number | null;
  student_label: string | null;
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
  // v15: when on, knockout generation adds a 3rd-place playoff match for
  // the two semi-final losers. Only effective when the bracket has SFs
  // (slots >= 4); ignored otherwise.
  has_bronze_match: boolean;
  // Registration price in CAD (null = not set). Singles are always per player.
  price: number | null;
  price_basis: PriceBasis;
  // Minimum age on tournament day for every player in an entry (e.g. 35 for
  // "Men's Doubles 35+"). Null = no minimum beyond the age band.
  min_age?: number | null;
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
  // Age on tournament day, from the registration form. Admin-only: only
  // present on rows loaded through admin_players.
  age?: number | null;
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
  // v15: true on the extra match generated for the 3rd-place playoff. Lives in
  // the same round_idx as the Final (last round) at slot_idx=1; Final is slot 0.
  is_bronze: boolean;
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

  payment_reference: string | null;     // e-Transfer reference, or "Stripe pi_…" once paid by card
  payment_paid_full_for_partner: boolean;
  comments: string | null;
  group_choice: "open" | "members" | null;

  payment_method: PaymentMethod;
  amount_due_cents: number | null;
  card_payment_status: "awaiting" | "paid" | "expired" | "refunded" | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;

  // Card registrations start as awaiting_payment and become pending once paid.
  status: "pending" | "approved" | "rejected" | "awaiting_payment" | "payment_expired";
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;

  approved_player_id: string | null;
  approved_partner_id: string | null;
  approved_team_id: string | null;

  player_age: number | null;
  partner_age: number | null;
  player_fee_type: FeeType | null;
  partner_fee_type: FeeType | null;
  partner_consent_token: string | null;
  partner_waiver_email_status: string | null;   // null | 'sent' | 'failed: …'
  partner_waiver_emailed_at: string | null;
  confirmation_email_status: string | null;     // null | 'sending' | 'sent' | 'failed: …'
  confirmation_emailed_at: string | null;
  approval_email_status: string | null;
  approval_emailed_at: string | null;
  admin_email_status: string | null;            // directors' new-entry alert
  admin_emailed_at: string | null;
};

export type FeeType = "standard" | "youth" | "student";

// One participant's acceptance of the regulations, waiver and codes of
// conduct. Written by Edge Functions only; admins can read.
export type WaiverConsent = {
  id: string;
  registration_id: string | null;
  tournament_id: string;
  role: "player" | "partner";
  participant_name: string;
  participant_email: string | null;
  participant_age: number;
  guardian_name: string | null;
  signature: string;
  waiver_version: string;
  accepted_at: string;
};

export type ConsentPayload = {
  guardian_name?: string;
  signature: string;
  accepted_rules: boolean;
  accepted_waiver: boolean;
  accepted_codes_of_conduct: boolean;
  waiver_version: string | null;
};

// Payload accepted by the register-player Edge Function
export type PaymentMethod = "etransfer" | "card";

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
  payment_method: PaymentMethod;
  payment_reference?: string;           // required for e-Transfer
  payment_paid_full_for_partner?: boolean;
  comments?: string;
  website?: string;                     // honeypot; always empty for people
  player_age?: number;
  player_student?: boolean;
  partner_age?: number;
  partner_student?: boolean;
  consent?: ConsentPayload;
  group_choice?: "open" | "members";
};
