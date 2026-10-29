-- Approving the second half of a doubles pair links it to the team instead of
-- failing.
--
-- When both partners register separately (each paying their own share), the
-- first approval creates the team and the second used to fail with "submitter
-- already in a team for this category", leaving the entry stuck in Pending.
-- Now, if the team in this category is exactly these two players (either
-- order), the entry is approved and linked to it.
--
-- Also, compared with 20261023000000:
-- * A link is refused when another approved entry on the team already paid
--   for both players; the director rejects this entry and refunds it. If
--   instead this entry paid for both and the other paid one share, it links
--   and returns a warning to refund one share.
-- * A real conflict names the player, their team and the category.
-- * The partner's age is only filled in when the player has none, so the
--   second entry's guess doesn't overwrite the age a player gave themselves.
-- * Approvals within a tournament run one at a time (advisory lock), so two
--   directors approving both halves at once can't create two teams or
--   duplicate players.
-- * Returns linked_existing_team, team_name and warning for the admin toast.
--
-- Rollback: a new migration with the 20261023000000 function body. Don't
-- re-run that file; it also back-fills ages.

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
  v_team_name  text := NULL;
  v_linked     boolean := false;
  v_other      text;
  v_paid_by    text;
  v_paid_both  boolean;
  v_warning    text := NULL;
  v_next_sort  int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_reg FROM public.pending_registrations
   WHERE id = p_reg_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration not found'; END IF;
  IF v_reg.status <> 'pending' THEN RAISE EXCEPTION 'already %', v_reg.status; END IF;

  -- One approval at a time per tournament: player and team lookups below must
  -- see the rows a concurrent approval is creating.
  PERFORM pg_advisory_xact_lock(hashtext('approve_registration|' || v_reg.tournament_id::text)::bigint);

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

  IF v_reg.player_age IS NOT NULL THEN
    UPDATE public.players SET age = v_reg.player_age WHERE id = v_player_id;
  END IF;

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
    -- A partner's own entry or waiver gives their age; this is only a guess.
    IF v_reg.partner_age IS NOT NULL THEN
      UPDATE public.players SET age = v_reg.partner_age WHERE id = v_partner_id AND age IS NULL;
    END IF;
  END IF;

  -- ============ TEAM ============
  -- Only when both players are known. A solo doubles entry joins the category
  -- unpaired, so the directors can partner them from the Players/Teams tabs;
  -- a team with an empty second seat would hide them from pairing.
  IF v_cat.team_size = 2 AND v_partner_id IS NOT NULL THEN
    -- The second entry from the same pair completes their existing team.
    SELECT id, name INTO v_team_id, v_team_name FROM public.teams
     WHERE category_id = v_reg.category_id
       AND ((p1_id = v_player_id AND p2_id = v_partner_id)
         OR (p1_id = v_partner_id AND p2_id = v_player_id))
     ORDER BY sort_order, id
     LIMIT 1
     FOR SHARE;
    v_linked := v_team_id IS NOT NULL;

    IF v_linked THEN
      -- Another approved entry already covers this team. If either entry
      -- paid for both players, one share has been paid twice.
      SELECT player_name, payment_paid_full_for_partner INTO v_paid_by, v_paid_both
        FROM public.pending_registrations
       WHERE approved_team_id = v_team_id AND status = 'approved' AND id <> p_reg_id
       ORDER BY payment_paid_full_for_partner DESC, submitted_at
       LIMIT 1;
      IF v_paid_by IS NOT NULL AND v_paid_both THEN
        RAISE EXCEPTION '% already paid for both players on team "%" in %. Reject this entry and refund its payment.',
          v_paid_by, v_team_name, v_cat.name;
      END IF;
      -- The reverse (this entry paid for both, the other paid one share) is
      -- still the right team, and rejecting would leave a share unpaid, so
      -- link it and tell the director to refund one share.
      IF v_paid_by IS NOT NULL AND v_reg.payment_paid_full_for_partner THEN
        v_warning := format('%s had already paid their own share, and this entry paid for both. Refund one share.', v_paid_by);
      END IF;
    ELSE
      SELECT name INTO v_other FROM public.teams
       WHERE category_id = v_reg.category_id AND v_player_id IN (p1_id, p2_id)
       LIMIT 1;
      IF v_other IS NOT NULL THEN
        RAISE EXCEPTION '% is already on team "%" in %. Change that team before approving, or check both entries use the same email addresses.',
          v_reg.player_name, v_other, v_cat.name;
      END IF;
      SELECT name INTO v_other FROM public.teams
       WHERE category_id = v_reg.category_id AND v_partner_id IN (p1_id, p2_id)
       LIMIT 1;
      IF v_other IS NOT NULL THEN
        RAISE EXCEPTION '% is already on team "%" in %. Change that team before approving, or check both entries use the same email addresses.',
          v_reg.partner_name, v_other, v_cat.name;
      END IF;
      v_team_name := v_reg.player_name || ' & ' || v_reg.partner_name;
      INSERT INTO public.teams (tournament_id, category_id, p1_id, p2_id, sort_order, name)
      VALUES (v_reg.tournament_id, v_reg.category_id, v_player_id, v_partner_id,
              (SELECT coalesce(max(sort_order), -1) + 1 FROM public.teams WHERE category_id = v_reg.category_id),
              v_team_name)
      RETURNING id INTO v_team_id;
    END IF;
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
    'player_id',            v_player_id,
    'partner_id',           v_partner_id,
    'team_id',              v_team_id,
    'team_name',            v_team_name,
    'linked_existing_team', v_linked,
    'warning',              v_warning
  );
END;
$function$;
