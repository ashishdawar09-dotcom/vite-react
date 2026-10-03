-- Baseline of the live public schema (Badminton Tournament, wdqooznwzesmjdvlcrxw).
-- Generated from pg_catalog; replaces the hand-applied supabase/legacy/*.sql history.
-- Already applied in production: recorded via `supabase migration repair --status applied`.

set check_function_bodies = false;
set client_min_messages = warning;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create sequence if not exists public.match_audit_log_id_seq as bigint;

create table public.categories (
  id uuid default gen_random_uuid() not null,
  tournament_id uuid not null,
  name text not null,
  team_size integer default 2 not null,
  match_minutes integer default 12 not null,
  starts_at timestamp with time zone,
  phase text default 'none'::text not null,
  rounds_per_pair integer default 1 not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  groups_count integer default 0 not null,
  top_n_advance integer default 0 not null,
  age_band text,
  allow_solo_signup boolean default false not null,
  has_bronze_match boolean default false not null
);

create table public.match_audit_log (
  id bigint default nextval('match_audit_log_id_seq'::regclass) not null,
  match_id uuid not null,
  tournament_id uuid,
  changed_at timestamp with time zone default now() not null,
  changed_by text,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  changed_fields text[]
);

create table public.matches (
  id uuid default gen_random_uuid() not null,
  tournament_id uuid not null,
  stage text not null,
  group_idx integer,
  round_idx integer,
  slot_idx integer not null,
  team_a_id uuid,
  team_b_id uuid,
  score_a integer,
  score_b integer,
  winner_id uuid,
  confirmed boolean default false not null,
  is_bye boolean default false not null,
  created_at timestamp with time zone default now() not null,
  status text default 'pending'::text not null,
  started_at timestamp with time zone,
  category_id uuid not null,
  court_number integer,
  scheduled_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  is_walkover boolean default false not null,
  queue_position integer,
  extended_minutes integer default 0 not null,
  court_allocated_at timestamp with time zone,
  is_bronze boolean default false not null
);

create table public.notification_log (
  id uuid default gen_random_uuid() not null,
  match_id uuid not null,
  player_id uuid not null,
  channel text not null,
  status text not null,
  error_message text,
  sent_at timestamp with time zone default now() not null
);

create table public.pending_registrations (
  id uuid default gen_random_uuid() not null,
  tournament_id uuid not null,
  category_id uuid not null,
  submitted_at timestamp with time zone default now() not null,
  player_name text not null,
  player_email text not null,
  player_phone text,
  player_is_member boolean default false not null,
  partner_name text,
  partner_email text,
  partner_phone text,
  partner_is_member boolean,
  payment_reference text not null,
  payment_paid_full_for_partner boolean default false not null,
  comments text,
  group_choice text,
  status text default 'pending'::text not null,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  rejection_reason text,
  approved_player_id uuid,
  approved_partner_id uuid,
  approved_team_id uuid,
  raw_payload jsonb default '{}'::jsonb not null
);

create table public.player_categories (
  id uuid default gen_random_uuid() not null,
  player_id uuid not null,
  category_id uuid not null,
  created_at timestamp with time zone default now()
);

create table public.players (
  id uuid default gen_random_uuid() not null,
  tournament_id uuid not null,
  name text not null,
  color text default '#457B9D'::text not null,
  photo_url text,
  note text,
  active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  checked_in_at timestamp with time zone,
  email text
);

create table public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  player_id uuid,
  pending_registration_id uuid,
  admin_email text,
  tournament_id uuid not null,
  kind text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone default now() not null,
  last_error text
);

create table public.teams (
  id uuid default gen_random_uuid() not null,
  tournament_id uuid not null,
  name text not null,
  p1_id uuid not null,
  p2_id uuid,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  category_id uuid not null
);

create table public.tournament_admins (
  id uuid default gen_random_uuid() not null,
  email text not null,
  added_at timestamp with time zone default now() not null
);

create table public.tournaments (
  id uuid default gen_random_uuid() not null,
  name text not null,
  event_date date,
  phase text default 'none'::text not null,
  created_at timestamp with time zone default now() not null,
  created_by uuid,
  rounds_per_pair integer default 1 not null,
  num_courts integer default 2 not null,
  venue_name text,
  venue_address text,
  venue_map_url text,
  event_time time without time zone,
  registration_deadline timestamp with time zone,
  contact_info text,
  e_transfer_email text,
  fees jsonb default '{}'::jsonb not null,
  registration_open boolean default true not null,
  terms_text text,
  slug text
);

alter sequence public.match_audit_log_id_seq owned by public.match_audit_log.id;

alter table public.categories add constraint categories_age_band_check CHECK ((age_band = ANY (ARRAY['kid'::text, 'teen'::text, 'adult'::text])));
alter table public.categories add constraint categories_match_minutes_check CHECK (((match_minutes >= 1) AND (match_minutes <= 120)));
alter table public.categories add constraint categories_phase_check CHECK ((phase = ANY (ARRAY['none'::text, 'group'::text, 'knockout'::text])));
alter table public.categories add constraint categories_pkey PRIMARY KEY (id);
alter table public.categories add constraint categories_rounds_per_pair_check CHECK (((rounds_per_pair >= 1) AND (rounds_per_pair <= 3)));
alter table public.categories add constraint categories_team_size_check CHECK ((team_size = ANY (ARRAY[1, 2])));
alter table public.match_audit_log add constraint match_audit_log_pkey PRIMARY KEY (id);
alter table public.matches add constraint matches_pkey PRIMARY KEY (id);
alter table public.matches add constraint matches_stage_check CHECK ((stage = ANY (ARRAY['group'::text, 'knockout'::text])));
alter table public.matches add constraint matches_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'live'::text, 'completed'::text])));
alter table public.notification_log add constraint notification_log_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'push'::text])));
alter table public.notification_log add constraint notification_log_pkey PRIMARY KEY (id);
alter table public.notification_log add constraint notification_log_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped'::text])));
alter table public.pending_registrations add constraint pending_registrations_group_choice_check CHECK ((group_choice = ANY (ARRAY['open'::text, 'members'::text])));
alter table public.pending_registrations add constraint pending_registrations_pkey PRIMARY KEY (id);
alter table public.pending_registrations add constraint pending_registrations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.player_categories add constraint player_categories_pkey PRIMARY KEY (id);
alter table public.player_categories add constraint player_categories_player_id_category_id_key UNIQUE (player_id, category_id);
alter table public.players add constraint players_pkey PRIMARY KEY (id);
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_unique UNIQUE (endpoint);
alter table public.push_subscriptions add constraint push_subscriptions_identity_check CHECK ((((
CASE
    WHEN (player_id IS NOT NULL) THEN 1
    ELSE 0
END +
CASE
    WHEN (pending_registration_id IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (admin_email IS NOT NULL) THEN 1
    ELSE 0
END) = 1));
alter table public.push_subscriptions add constraint push_subscriptions_kind_check CHECK ((kind = ANY (ARRAY['player'::text, 'admin'::text])));
alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table public.teams add constraint teams_pkey PRIMARY KEY (id);
alter table public.tournament_admins add constraint tournament_admins_email_key UNIQUE (email);
alter table public.tournament_admins add constraint tournament_admins_pkey PRIMARY KEY (id);
alter table public.tournaments add constraint tournaments_num_courts_check CHECK (((num_courts >= 1) AND (num_courts <= 12)));
alter table public.tournaments add constraint tournaments_phase_check CHECK ((phase = ANY (ARRAY['none'::text, 'group'::text, 'knockout'::text])));
alter table public.tournaments add constraint tournaments_pkey PRIMARY KEY (id);
alter table public.tournaments add constraint tournaments_rounds_per_pair_check CHECK (((rounds_per_pair >= 1) AND (rounds_per_pair <= 3)));
alter table public.tournaments add constraint tournaments_slug_key UNIQUE (slug);
alter table public.categories add constraint categories_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
alter table public.matches add constraint matches_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.matches add constraint matches_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES teams(id) ON DELETE SET NULL;
alter table public.matches add constraint matches_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES teams(id) ON DELETE SET NULL;
alter table public.matches add constraint matches_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
alter table public.matches add constraint matches_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES teams(id) ON DELETE SET NULL;
alter table public.notification_log add constraint notification_log_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
alter table public.notification_log add constraint notification_log_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
alter table public.pending_registrations add constraint pending_registrations_approved_partner_id_fkey FOREIGN KEY (approved_partner_id) REFERENCES players(id) ON DELETE SET NULL;
alter table public.pending_registrations add constraint pending_registrations_approved_player_id_fkey FOREIGN KEY (approved_player_id) REFERENCES players(id) ON DELETE SET NULL;
alter table public.pending_registrations add constraint pending_registrations_approved_team_id_fkey FOREIGN KEY (approved_team_id) REFERENCES teams(id) ON DELETE SET NULL;
alter table public.pending_registrations add constraint pending_registrations_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.pending_registrations add constraint pending_registrations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.pending_registrations add constraint pending_registrations_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
alter table public.player_categories add constraint player_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.player_categories add constraint player_categories_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
alter table public.players add constraint players_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
alter table public.push_subscriptions add constraint push_subscriptions_pending_registration_id_fkey FOREIGN KEY (pending_registration_id) REFERENCES pending_registrations(id) ON DELETE CASCADE;
alter table public.push_subscriptions add constraint push_subscriptions_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
alter table public.push_subscriptions add constraint push_subscriptions_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
alter table public.teams add constraint teams_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.teams add constraint teams_p1_id_fkey FOREIGN KEY (p1_id) REFERENCES players(id) ON DELETE CASCADE;
alter table public.teams add constraint teams_p2_id_fkey FOREIGN KEY (p2_id) REFERENCES players(id) ON DELETE CASCADE;
alter table public.teams add constraint teams_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
alter table public.tournaments add constraint tournaments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX categories_tournament_idx ON public.categories USING btree (tournament_id);
CREATE INDEX idx_match_audit_match ON public.match_audit_log USING btree (match_id, changed_at DESC);
CREATE INDEX idx_match_audit_tournament ON public.match_audit_log USING btree (tournament_id, changed_at DESC);
CREATE INDEX idx_matches_tid_category_status ON public.matches USING btree (tournament_id, category_id, status);
CREATE INDEX idx_matches_tid_court ON public.matches USING btree (tournament_id, court_number) WHERE (court_number IS NOT NULL);
CREATE INDEX idx_matches_tid_scheduled ON public.matches USING btree (tournament_id, scheduled_at) WHERE (scheduled_at IS NOT NULL);
CREATE INDEX idx_matches_tid_status ON public.matches USING btree (tournament_id, status);
CREATE INDEX idx_notification_log_match ON public.notification_log USING btree (match_id);
CREATE INDEX idx_pending_reg_dedup ON public.pending_registrations USING btree (lower(player_email), category_id) WHERE (status = ANY (ARRAY['pending'::text, 'approved'::text]));
CREATE INDEX idx_pending_reg_tournament_status ON public.pending_registrations USING btree (tournament_id, status, submitted_at DESC);
CREATE INDEX idx_player_categories_category ON public.player_categories USING btree (category_id);
CREATE INDEX idx_player_categories_player ON public.player_categories USING btree (player_id);
CREATE INDEX idx_push_subs_admin ON public.push_subscriptions USING btree (admin_email, tournament_id) WHERE (admin_email IS NOT NULL);
CREATE INDEX idx_push_subs_pending ON public.push_subscriptions USING btree (pending_registration_id) WHERE (pending_registration_id IS NOT NULL);
CREATE INDEX idx_push_subs_player ON public.push_subscriptions USING btree (player_id) WHERE (player_id IS NOT NULL);
CREATE INDEX matches_category_idx ON public.matches USING btree (category_id);
CREATE INDEX matches_stage_idx ON public.matches USING btree (tournament_id, stage);
CREATE INDEX matches_tournament_idx ON public.matches USING btree (tournament_id);
CREATE INDEX players_tournament_idx ON public.players USING btree (tournament_id);
CREATE INDEX teams_category_idx ON public.teams USING btree (category_id);
CREATE INDEX teams_tournament_idx ON public.teams USING btree (tournament_id);
CREATE INDEX tournaments_slug_idx ON public.tournaments USING btree (slug) WHERE (slug IS NOT NULL);
CREATE UNIQUE INDEX tournament_admins_email_lower_idx ON public.tournament_admins USING btree (lower(email));

CREATE OR REPLACE FUNCTION public.admin_players(p_tournament_id uuid)
 RETURNS SETOF players
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT * FROM public.players
     WHERE tournament_id = p_tournament_id
     ORDER BY sort_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_registration(p_reg_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reg        public.pending_registrations%ROWTYPE;
  v_cat        public.categories%ROWTYPE;
  v_player_id  uuid;
  v_partner_id uuid := NULL;
  v_team_id    uuid := NULL;
  v_next_sort  int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_reg FROM public.pending_registrations
   WHERE id = p_reg_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration not found'; END IF;
  IF v_reg.status <> 'pending' THEN RAISE EXCEPTION 'already %', v_reg.status; END IF;

  SELECT * INTO v_cat FROM public.categories WHERE id = v_reg.category_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'category not found'; END IF;

  SELECT coalesce(max(sort_order), -1) + 1 INTO v_next_sort
    FROM public.players WHERE tournament_id = v_reg.tournament_id;

  -- ============ SUBMITTER ============
  SELECT id INTO v_player_id
    FROM public.players
   WHERE tournament_id = v_reg.tournament_id
     AND email IS NOT NULL AND lower(email) = lower(v_reg.player_email)
   LIMIT 1;

  IF v_player_id IS NULL THEN
    INSERT INTO public.players (tournament_id, name, color, active, sort_order, email)
    VALUES (v_reg.tournament_id, v_reg.player_name, '#457B9D', true, v_next_sort, v_reg.player_email)
    RETURNING id INTO v_player_id;
    v_next_sort := v_next_sort + 1;
  END IF;

  INSERT INTO public.player_categories (player_id, category_id)
  VALUES (v_player_id, v_reg.category_id)
  ON CONFLICT (player_id, category_id) DO NOTHING;

  -- ============ PARTNER (doubles only, if email provided) ============
  IF v_cat.team_size = 2 AND v_reg.partner_email IS NOT NULL THEN
    SELECT id INTO v_partner_id
      FROM public.players
     WHERE tournament_id = v_reg.tournament_id
       AND email IS NOT NULL AND lower(email) = lower(v_reg.partner_email)
     LIMIT 1;

    IF v_partner_id IS NULL THEN
      INSERT INTO public.players (tournament_id, name, color, active, sort_order, email)
      VALUES (v_reg.tournament_id, v_reg.partner_name, '#E63946', true, v_next_sort, v_reg.partner_email)
      RETURNING id INTO v_partner_id;
    END IF;
    IF v_partner_id = v_player_id THEN
      RAISE EXCEPTION 'submitter and partner resolve to same player';
    END IF;
    INSERT INTO public.player_categories (player_id, category_id)
    VALUES (v_partner_id, v_reg.category_id) ON CONFLICT (player_id, category_id) DO NOTHING;
  END IF;

  -- ============ TEAM ============
  IF v_cat.team_size = 2 THEN
    IF EXISTS (SELECT 1 FROM public.teams
               WHERE category_id = v_reg.category_id
                 AND (p1_id = v_player_id OR p2_id = v_player_id)) THEN
      RAISE EXCEPTION 'submitter already in a team for this category';
    END IF;
    IF v_partner_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.teams
               WHERE category_id = v_reg.category_id
                 AND (p1_id = v_partner_id OR p2_id = v_partner_id)) THEN
      RAISE EXCEPTION 'partner already in a team for this category';
    END IF;
    INSERT INTO public.teams (tournament_id, category_id, p1_id, p2_id, sort_order, name)
    VALUES (v_reg.tournament_id, v_reg.category_id, v_player_id, v_partner_id,
            (SELECT coalesce(max(sort_order), -1) + 1 FROM public.teams WHERE category_id = v_reg.category_id),
            v_reg.player_name || CASE WHEN v_partner_id IS NOT NULL
                                      THEN ' & ' || v_reg.partner_name ELSE '' END)
    RETURNING id INTO v_team_id;
  END IF;

  -- ============ NEW: migrate push subscriptions from pending → player ============
  UPDATE public.push_subscriptions
     SET player_id = v_player_id,
         pending_registration_id = NULL
   WHERE pending_registration_id = p_reg_id;

  UPDATE public.pending_registrations
     SET status              = 'approved',
         reviewed_at         = now(),
         reviewed_by         = auth.uid(),
         approved_player_id  = v_player_id,
         approved_partner_id = v_partner_id,
         approved_team_id    = v_team_id
   WHERE id = p_reg_id;

  RETURN jsonb_build_object(
    'player_id',  v_player_id,
    'partner_id', v_partner_id,
    'team_id',    v_team_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.extend_match(p_match_id uuid, p_extra_minutes integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE matches
     SET extended_minutes = COALESCE(extended_minutes, 0) + p_extra_minutes
   WHERE id = p_match_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM tournament_admins
    WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$function$;

CREATE OR REPLACE FUNCTION public.live_snapshot(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'tournament', (SELECT to_jsonb(t.*) FROM tournaments t WHERE t.id = p_tournament_id),
    'players',    (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', p.id,
                      'tournament_id', p.tournament_id,
                      'name', p.name,
                      'color', p.color,
                      'photo_url', p.photo_url,
                      'note', p.note,
                      'active', p.active,
                      'sort_order', p.sort_order,
                      'created_at', p.created_at,
                      'checked_in_at', p.checked_in_at
                  ) ORDER BY p.sort_order), '[]'::jsonb)
                   FROM players p WHERE p.tournament_id = p_tournament_id),
    'teams',      (SELECT coalesce(jsonb_agg(t ORDER BY t.sort_order), '[]'::jsonb)
                   FROM teams t WHERE t.tournament_id = p_tournament_id),
    'matches',    (SELECT coalesce(jsonb_agg(m ORDER BY m.slot_idx), '[]'::jsonb)
                   FROM matches m WHERE m.tournament_id = p_tournament_id),
    'categories', (SELECT coalesce(jsonb_agg(c ORDER BY c.sort_order), '[]'::jsonb)
                   FROM categories c WHERE c.tournament_id = p_tournament_id),
    'player_categories',
                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', pc.id, 'player_id', pc.player_id, 'category_id', pc.category_id
                  )), '[]'::jsonb)
                   FROM player_categories pc
                   JOIN players p ON p.id = pc.player_id
                   WHERE p.tournament_id = p_tournament_id),
    'generated_at', extract(epoch from now())
  );
$function$;

CREATE OR REPLACE FUNCTION public.log_match_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor text := coalesce(auth.jwt() ->> 'email', 'system');
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO match_audit_log (match_id, tournament_id, changed_by, action, after_data)
    VALUES (NEW.id, NEW.tournament_id, v_actor, 'insert', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Determine which fields changed (only score/status/winner are interesting).
    IF NEW.score_a IS DISTINCT FROM OLD.score_a THEN v_changed := array_append(v_changed, 'score_a'); END IF;
    IF NEW.score_b IS DISTINCT FROM OLD.score_b THEN v_changed := array_append(v_changed, 'score_b'); END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN v_changed := array_append(v_changed, 'status'); END IF;
    IF NEW.winner_id IS DISTINCT FROM OLD.winner_id THEN v_changed := array_append(v_changed, 'winner_id'); END IF;
    IF NEW.court_number IS DISTINCT FROM OLD.court_number THEN v_changed := array_append(v_changed, 'court_number'); END IF;
    IF NEW.confirmed IS DISTINCT FROM OLD.confirmed THEN v_changed := array_append(v_changed, 'confirmed'); END IF;
    IF array_length(v_changed, 1) > 0 THEN
      INSERT INTO match_audit_log (match_id, tournament_id, changed_by, action, before_data, after_data, changed_fields)
      VALUES (NEW.id, NEW.tournament_id, v_actor, 'update', to_jsonb(OLD), to_jsonb(NEW), v_changed);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO match_audit_log (match_id, tournament_id, changed_by, action, before_data)
    VALUES (OLD.id, OLD.tournament_id, v_actor, 'delete', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_player(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'player', (
      SELECT jsonb_build_object('id', p.id, 'name', p.name)
      FROM players p
      WHERE p.tournament_id = p_tournament_id
        AND p.email IS NOT NULL
        AND lower(p.email) = lower(auth.jwt() ->> 'email')
      LIMIT 1
    ),
    'team_ids', (
      SELECT coalesce(jsonb_agg(t.id), '[]'::jsonb)
      FROM teams t
      JOIN players p ON (p.id = t.p1_id OR p.id = t.p2_id)
      WHERE t.tournament_id = p_tournament_id
        AND p.email IS NOT NULL
        AND lower(p.email) = lower(auth.jwt() ->> 'email')
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.reject_registration(p_reg_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.pending_registrations
     SET status           = 'rejected',
         reviewed_at      = now(),
         reviewed_by      = auth.uid(),
         rejection_reason = p_reason
   WHERE id = p_reg_id
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration not pending or not found';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_player_categories(p_player_id uuid, p_category_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  DELETE FROM player_categories
   WHERE player_id = p_player_id
     AND (p_category_ids IS NULL OR NOT (category_id = ANY(p_category_ids)));
  IF p_category_ids IS NOT NULL AND array_length(p_category_ids, 1) > 0 THEN
    INSERT INTO player_categories (player_id, category_id)
    SELECT p_player_id, unnest(p_category_ids)
    ON CONFLICT (player_id, category_id) DO NOTHING;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.slugify(input text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  s TEXT;
BEGIN
  s := lower(coalesce(input, ''));
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  s := regexp_replace(s, '^-+|-+$', '', 'g');
  IF length(s) > 40 THEN
    s := substring(s FROM 1 FOR 40);
    s := regexp_replace(s, '-+$', '', 'g');
  END IF;
  IF s = '' THEN
    s := 'tournament';
  END IF;
  RETURN s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_match_on_court(p_match_id uuid, p_court integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tid uuid;
  v_busy int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT tournament_id INTO v_tid FROM matches WHERE id = p_match_id;
  IF v_tid IS NULL THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_tid::text || '|' || p_court::text)::bigint
  );

  SELECT count(*) INTO v_busy
    FROM matches
   WHERE tournament_id = v_tid
     AND court_number = p_court
     AND status = 'live'
     AND id <> p_match_id;

  IF v_busy > 0 THEN RETURN false; END IF;

  UPDATE matches
     SET status = 'live',
         started_at = now(),
         court_number = p_court
   WHERE id = p_match_id;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.swap_match_queue_positions(p_id1 uuid, p_pos1 integer, p_id2 uuid, p_pos2 integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- Lock both rows to prevent interleaved updates.
  PERFORM 1 FROM matches WHERE id IN (p_id1, p_id2) FOR UPDATE;
  UPDATE matches SET queue_position = p_pos2 WHERE id = p_id1;
  UPDATE matches SET queue_position = p_pos1 WHERE id = p_id2;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tournaments_autoslug()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  base TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;
  base := public.slugify(NEW.name);
  candidate := base;
  suffix := 1;
  WHILE EXISTS (
    SELECT 1 FROM public.tournaments
     WHERE slug = candidate
       AND (NEW.id IS NULL OR id <> NEW.id)
  ) LOOP
    suffix := suffix + 1;
    candidate := base || '-' || suffix::text;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER tournaments_autoslug BEFORE INSERT ON public.tournaments FOR EACH ROW EXECUTE FUNCTION tournaments_autoslug();
CREATE TRIGGER trg_match_audit AFTER INSERT OR DELETE OR UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION log_match_change();

alter table public.categories enable row level security;
alter table public.match_audit_log enable row level security;
alter table public.matches enable row level security;
alter table public.notification_log enable row level security;
alter table public.pending_registrations enable row level security;
alter table public.player_categories enable row level security;
alter table public.players enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.teams enable row level security;
alter table public.tournament_admins enable row level security;
alter table public.tournaments enable row level security;

create policy "admin write categories" on public.categories as permissive for all to public using (is_admin()) with check (is_admin());
create policy "read categories" on public.categories as permissive for select to public using (true);
create policy "match_audit_read" on public.match_audit_log as permissive for select to public using (true);
create policy "admin write matches" on public.matches as permissive for all to public using (is_admin()) with check (is_admin());
create policy "read matches" on public.matches as permissive for select to public using (true);
create policy "notification_log_admin_read" on public.notification_log as permissive for select to public using (is_admin());
create policy "pending_reg_admin_read" on public.pending_registrations as permissive for select to public using (is_admin());
create policy "player_categories_read" on public.player_categories as permissive for select to public using (true);
create policy "player_categories_write" on public.player_categories as permissive for all to public using (is_admin()) with check (is_admin());
create policy "admin write players" on public.players as permissive for all to public using (is_admin()) with check (is_admin());
create policy "read players" on public.players as permissive for select to public using (true);
create policy "push_subs_admin_read" on public.push_subscriptions as permissive for select to public using (is_admin());
create policy "admin write teams" on public.teams as permissive for all to public using (is_admin()) with check (is_admin());
create policy "read teams" on public.teams as permissive for select to public using (true);
create policy "tournament_admins_admin_write" on public.tournament_admins as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy "tournament_admins_read_self" on public.tournament_admins as permissive for select to public using ((is_admin() OR (lower(email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));
create policy "admin write tournaments" on public.tournaments as permissive for all to public using (is_admin()) with check (is_admin());
create policy "read tournaments" on public.tournaments as permissive for select to public using (true);

-- Privileges (API roles)
revoke all on public.categories from anon, authenticated, service_role;
revoke all on public.match_audit_log from anon, authenticated, service_role;
revoke all on public.match_audit_log_id_seq from anon, authenticated, service_role;
revoke all on public.matches from anon, authenticated, service_role;
revoke all on public.notification_log from anon, authenticated, service_role;
revoke all on public.pending_registrations from anon, authenticated, service_role;
revoke all on public.player_categories from anon, authenticated, service_role;
revoke all on public.players from anon, authenticated, service_role;
revoke all on public.push_subscriptions from anon, authenticated, service_role;
revoke all on public.teams from anon, authenticated, service_role;
revoke all on public.tournament_admins from anon, authenticated, service_role;
revoke all on public.tournaments from anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.categories to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.categories to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.categories to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.match_audit_log to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.match_audit_log to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.match_audit_log to service_role;
grant select, update, usage on public.match_audit_log_id_seq to anon;
grant select, update, usage on public.match_audit_log_id_seq to authenticated;
grant select, update, usage on public.match_audit_log_id_seq to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.matches to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.matches to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.matches to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.notification_log to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.notification_log to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.notification_log to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.pending_registrations to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.pending_registrations to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.pending_registrations to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.player_categories to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.player_categories to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.player_categories to service_role;
grant delete, insert, maintain, references, trigger, truncate, update on public.players to anon;
grant delete, insert, maintain, references, trigger, truncate, update on public.players to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.players to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.push_subscriptions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.push_subscriptions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.push_subscriptions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.teams to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.teams to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.teams to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.tournament_admins to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.tournament_admins to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.tournament_admins to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.tournaments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.tournaments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.tournaments to service_role;
grant select (active) on public.players to anon;
grant select (active) on public.players to authenticated;
grant select (checked_in_at) on public.players to anon;
grant select (checked_in_at) on public.players to authenticated;
grant select (color) on public.players to anon;
grant select (color) on public.players to authenticated;
grant select (created_at) on public.players to anon;
grant select (created_at) on public.players to authenticated;
grant select (id) on public.players to anon;
grant select (id) on public.players to authenticated;
grant select (name) on public.players to anon;
grant select (name) on public.players to authenticated;
grant select (note) on public.players to anon;
grant select (note) on public.players to authenticated;
grant select (photo_url) on public.players to anon;
grant select (photo_url) on public.players to authenticated;
grant select (sort_order) on public.players to anon;
grant select (sort_order) on public.players to authenticated;
grant select (tournament_id) on public.players to anon;
grant select (tournament_id) on public.players to authenticated;

revoke all on function public.admin_players(p_tournament_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_players(p_tournament_id uuid) to authenticated, anon, service_role;
revoke all on function public.approve_registration(p_reg_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.approve_registration(p_reg_id uuid) to authenticated, anon, service_role, public;
revoke all on function public.extend_match(p_match_id uuid, p_extra_minutes integer) from public, anon, authenticated, service_role;
grant execute on function public.extend_match(p_match_id uuid, p_extra_minutes integer) to authenticated, anon, service_role, public;
revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to authenticated, anon, service_role, public;
revoke all on function public.live_snapshot(p_tournament_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.live_snapshot(p_tournament_id uuid) to authenticated, anon, service_role, public;
revoke all on function public.log_match_change() from public, anon, authenticated, service_role;
grant execute on function public.log_match_change() to authenticated, anon, service_role, public;
revoke all on function public.my_player(p_tournament_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_player(p_tournament_id uuid) to authenticated, anon, service_role;
revoke all on function public.reject_registration(p_reg_id uuid, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.reject_registration(p_reg_id uuid, p_reason text) to authenticated, anon, service_role, public;
revoke all on function public.set_player_categories(p_player_id uuid, p_category_ids uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.set_player_categories(p_player_id uuid, p_category_ids uuid[]) to authenticated, anon, service_role, public;
revoke all on function public.slugify(input text) from public, anon, authenticated, service_role;
grant execute on function public.slugify(input text) to authenticated, anon, service_role, public;
revoke all on function public.start_match_on_court(p_match_id uuid, p_court integer) from public, anon, authenticated, service_role;
grant execute on function public.start_match_on_court(p_match_id uuid, p_court integer) to authenticated, anon, service_role, public;
revoke all on function public.swap_match_queue_positions(p_id1 uuid, p_pos1 integer, p_id2 uuid, p_pos2 integer) from public, anon, authenticated, service_role;
grant execute on function public.swap_match_queue_positions(p_id1 uuid, p_pos1 integer, p_id2 uuid, p_pos2 integer) to authenticated, anon, service_role, public;
revoke all on function public.tournaments_autoslug() from public, anon, authenticated, service_role;
grant execute on function public.tournaments_autoslug() to authenticated, anon, service_role, public;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories') then
    alter publication supabase_realtime add table public.categories;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
    alter publication supabase_realtime add table public.matches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'player_categories') then
    alter publication supabase_realtime add table public.player_categories;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players') then
    alter publication supabase_realtime add table public.players;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teams') then
    alter publication supabase_realtime add table public.teams;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournaments') then
    alter publication supabase_realtime add table public.tournaments;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', true, null, null)
on conflict (id) do nothing;
create policy "admin write photos" on storage.objects as permissive for all to public using (((bucket_id = 'player-photos'::text) AND is_admin())) with check (((bucket_id = 'player-photos'::text) AND is_admin()));
create policy "public read photos" on storage.objects as permissive for select to public using ((bucket_id = 'player-photos'::text));
