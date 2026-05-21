-- =============================================================================
-- schema_v13_push_notifications.sql
-- Web Push subscriptions — players (and admins, Phase 2) opt in to receive
-- court-allocation pushes on their phone. Each browser-tournament pair is
-- one row. Subscriptions are first linked to the pending registration,
-- then migrated to the player record when the admin approves.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity (exactly one of player_id / pending_registration_id / admin_email must be set)
  player_id                UUID REFERENCES public.players(id) ON DELETE CASCADE,
  pending_registration_id  UUID REFERENCES public.pending_registrations(id) ON DELETE CASCADE,
  admin_email              TEXT,
  -- Scope
  tournament_id            UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  -- Type of subscriber
  kind                     TEXT NOT NULL CHECK (kind IN ('player', 'admin')),
  -- Browser endpoint (RFC 8030)
  endpoint                 TEXT NOT NULL,
  p256dh                   TEXT NOT NULL,
  auth                     TEXT NOT NULL,
  -- Diagnostics
  user_agent               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error               TEXT,
  -- An endpoint is globally unique per device — used as the dedup key on upserts.
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint),
  -- Identity sanity: at least one and at most one of the three identity fields is set.
  CONSTRAINT push_subscriptions_identity_check CHECK (
    (CASE WHEN player_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN pending_registration_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN admin_email IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_push_subs_player
  ON public.push_subscriptions (player_id) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_push_subs_pending
  ON public.push_subscriptions (pending_registration_id) WHERE pending_registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_push_subs_admin
  ON public.push_subscriptions (admin_email, tournament_id) WHERE admin_email IS NOT NULL;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Admins can read their own + their tournament's subscriptions for debugging.
DROP POLICY IF EXISTS push_subs_admin_read ON public.push_subscriptions;
CREATE POLICY push_subs_admin_read ON public.push_subscriptions
  FOR SELECT USING (public.is_admin());

-- No client INSERT/UPDATE/DELETE policy: all writes go through the
-- subscribe-push Edge Function (service role) or via the
-- approve_registration RPC's migration logic below.

-- ============================================================================
-- Hook: when approve_registration() migrates a pending row to a player,
-- carry over any push subscriptions tied to the pending row.
-- We update the existing approve_registration RPC.
-- ============================================================================
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
$$;

GRANT EXECUTE ON FUNCTION public.approve_registration(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
