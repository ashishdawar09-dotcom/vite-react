-- =============================================================================
-- schema_v12_public_registration.sql
-- Public-facing registration form: per-tournament config + pending submissions
-- + atomic approve/reject RPCs. Idempotent. Run via Supabase SQL editor.
-- =============================================================================

-- 1. TOURNAMENTS: registration metadata --------------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS venue_name TEXT,
  ADD COLUMN IF NOT EXISTS venue_address TEXT,
  ADD COLUMN IF NOT EXISTS venue_map_url TEXT,
  ADD COLUMN IF NOT EXISTS event_time TIME,
  ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_info TEXT,
  ADD COLUMN IF NOT EXISTS e_transfer_email TEXT,
  ADD COLUMN IF NOT EXISTS fees JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS registration_open BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS terms_text TEXT;

COMMENT ON COLUMN public.tournaments.fees IS
  'Per-tournament fee table. Shape: { "<age_band>": { "member": int, "non_member": int } }';

-- 2. CATEGORIES: age band + solo-signup flag ---------------------------------
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS age_band TEXT
    CHECK (age_band IN ('kid','teen','adult')),
  ADD COLUMN IF NOT EXISTS allow_solo_signup BOOLEAN NOT NULL DEFAULT false;

-- 3. PENDING_REGISTRATIONS ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pending_registrations (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id                 UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  category_id                   UUID NOT NULL REFERENCES public.categories(id)  ON DELETE CASCADE,
  submitted_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  player_name                   TEXT  NOT NULL,
  player_email                  TEXT  NOT NULL,
  player_phone                  TEXT,
  player_is_member              BOOLEAN NOT NULL DEFAULT false,

  partner_name                  TEXT,
  partner_email                 TEXT,
  partner_phone                 TEXT,
  partner_is_member             BOOLEAN,

  payment_reference             TEXT NOT NULL,
  payment_paid_full_for_partner BOOLEAN NOT NULL DEFAULT false,
  comments                      TEXT,
  group_choice                  TEXT CHECK (group_choice IN ('open','members')),

  status                        TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','approved','rejected')),
  reviewed_at                   TIMESTAMPTZ,
  reviewed_by                   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason              TEXT,

  approved_player_id            UUID REFERENCES public.players(id) ON DELETE SET NULL,
  approved_partner_id           UUID REFERENCES public.players(id) ON DELETE SET NULL,
  approved_team_id              UUID REFERENCES public.teams(id)   ON DELETE SET NULL,

  raw_payload                   JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pending_reg_tournament_status
  ON public.pending_registrations (tournament_id, status, submitted_at DESC);

-- Partial non-unique index helps the Edge Function's dedup check.
CREATE INDEX IF NOT EXISTS idx_pending_reg_dedup
  ON public.pending_registrations (lower(player_email), category_id)
  WHERE status IN ('pending','approved');

ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;

-- Admin-only read. NO INSERT/UPDATE/DELETE policy: writes only via service-role
-- (Edge Function) or via SECURITY DEFINER RPCs below (defense in depth).
DROP POLICY IF EXISTS pending_reg_admin_read ON public.pending_registrations;
CREATE POLICY pending_reg_admin_read ON public.pending_registrations
  FOR SELECT USING (public.is_admin());

-- 4. APPROVE_REGISTRATION RPC -----------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_registration(p_reg_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration not found';
  END IF;
  IF v_reg.status <> 'pending' THEN
    RAISE EXCEPTION 'already %', v_reg.status;
  END IF;

  SELECT * INTO v_cat FROM public.categories WHERE id = v_reg.category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category not found';
  END IF;

  -- next sort_order for new players in this tournament
  SELECT coalesce(max(sort_order), -1) + 1 INTO v_next_sort
    FROM public.players WHERE tournament_id = v_reg.tournament_id;

  -- ============ SUBMITTER ============
  -- Match by non-null email only. Admin-created players have email=NULL and
  -- must NEVER match — that would silently merge a stranger into their record.
  SELECT id INTO v_player_id
    FROM public.players
   WHERE tournament_id = v_reg.tournament_id
     AND email IS NOT NULL
     AND lower(email) = lower(v_reg.player_email)
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
       AND email IS NOT NULL
       AND lower(email) = lower(v_reg.partner_email)
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
    VALUES (v_partner_id, v_reg.category_id)
    ON CONFLICT (player_id, category_id) DO NOTHING;
  END IF;

  -- ============ TEAM (doubles only) ============
  IF v_cat.team_size = 2 THEN
    IF EXISTS (
      SELECT 1 FROM public.teams
       WHERE category_id = v_reg.category_id
         AND (p1_id = v_player_id OR p2_id = v_player_id)
    ) THEN
      RAISE EXCEPTION 'submitter already in a team for this category';
    END IF;

    IF v_partner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.teams
       WHERE category_id = v_reg.category_id
         AND (p1_id = v_partner_id OR p2_id = v_partner_id)
    ) THEN
      RAISE EXCEPTION 'partner already in a team for this category';
    END IF;

    INSERT INTO public.teams (tournament_id, category_id, p1_id, p2_id, sort_order, name)
    VALUES (
      v_reg.tournament_id, v_reg.category_id,
      v_player_id, v_partner_id,
      (SELECT coalesce(max(sort_order), -1) + 1 FROM public.teams WHERE category_id = v_reg.category_id),
      v_reg.player_name || CASE WHEN v_partner_id IS NOT NULL
                                THEN ' & ' || v_reg.partner_name
                                ELSE '' END
    )
    RETURNING id INTO v_team_id;
  END IF;

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
$$;

GRANT EXECUTE ON FUNCTION public.approve_registration(uuid) TO authenticated;

-- 5. REJECT_REGISTRATION RPC -------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_registration(p_reg_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.reject_registration(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
