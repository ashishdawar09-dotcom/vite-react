-- Solo doubles entries: don't create a half-empty team on approval.
--
-- approve_registration used to insert a team with p2_id = NULL when a doubles
-- entry had no partner. The admin app counts anyone in a team as paired, so the
-- player showed "Team assigned" and never appeared in Unpaired / the partner
-- picker. Now the player is only added to the category; pairing happens in the
-- app. Body otherwise identical to the baseline definition.

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
  -- Only when both players are known. A solo doubles entry joins the category
  -- unpaired, so the directors can partner them from the Players/Teams tabs;
  -- a team with an empty second seat would hide them from pairing.
  IF v_cat.team_size = 2 AND v_partner_id IS NOT NULL THEN
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
