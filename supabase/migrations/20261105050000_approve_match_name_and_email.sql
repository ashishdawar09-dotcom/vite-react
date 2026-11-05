-- Approval matches an entrant to an existing player by email AND first name,
-- not email alone.
--
-- On Nov 4 2026 a mother entered her 12-year-old daughter in Youth Girls'
-- Singles with her own email. Approval found the mother's player record by
-- that email and gave it the daughter's event and age (12), and the daughter
-- never got a record. Any shared email did the same: a parent and child, or
-- two adults using one family address.
--
-- Now:
-- * The submitter (and a named partner) is the existing player with the same
--   email and the same first name, so "Jagan" and "Jagan Krishnaraj" are
--   still one player. With a different first name, a new player is created
--   with that email, and the result's warning tells the director, in case
--   it is one person under two names (a nickname). A blank name still
--   matches on email alone, as before.
-- * The lookup is ordered (sort_order, id), so with two players on one
--   email the oldest matching one is used every time, not an arbitrary row.
-- * Warnings add up instead of replacing each other.
-- Everything else is unchanged from 20261029000000_approve_completes_team.sql.
--
-- Rollback: a new migration with the 20261029000000 function body.

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
  v_shared     text;
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
  -- Same player = same email and same first name. Email alone put a child
  -- entered with a parent's email onto the parent's record (it gained the
  -- child's event and age). First name, not full name, so "Jagan" and
  -- "Jagan Krishnaraj" stay one player.
  SELECT id INTO v_player_id
    FROM public.players
   WHERE tournament_id = v_reg.tournament_id
     AND email IS NOT NULL AND lower(email) = lower(v_reg.player_email)
     AND (coalesce(btrim(v_reg.player_name), '') = ''
          OR split_part(lower(btrim(name)), ' ', 1) = split_part(lower(btrim(v_reg.player_name)), ' ', 1))
   ORDER BY sort_order, id
   LIMIT 1;

  IF v_player_id IS NULL THEN
    -- Another player already uses this email: a separate player, and a note
    -- for the director in case it is one person under two names.
    SELECT name INTO v_shared FROM public.players
     WHERE tournament_id = v_reg.tournament_id
       AND email IS NOT NULL AND lower(email) = lower(v_reg.player_email)
     ORDER BY sort_order, id
     LIMIT 1;
    INSERT INTO public.players (tournament_id, name, color, active, sort_order, email)
    VALUES (v_reg.tournament_id, v_reg.player_name, '#457B9D', true, v_next_sort, v_reg.player_email)
    RETURNING id INTO v_player_id;
    v_next_sort := v_next_sort + 1;
    IF v_shared IS NOT NULL THEN
      v_warning := concat_ws(' ', v_warning, format(
        '%s was added as a new player because their email also belongs to %s. If they are the same person, fix it before the draw.',
        v_reg.player_name, v_shared));
    END IF;
  END IF;

  INSERT INTO public.player_categories (player_id, category_id)
  VALUES (v_player_id, v_reg.category_id)
  ON CONFLICT (player_id, category_id) DO NOTHING;

  IF v_reg.player_age IS NOT NULL THEN
    UPDATE public.players SET age = v_reg.player_age WHERE id = v_player_id;
  END IF;

  -- ============ PARTNER (doubles only, if email provided) ============
  IF v_cat.team_size = 2 AND v_reg.partner_email IS NOT NULL THEN
    -- Same rule as the submitter: email and first name.
    SELECT id INTO v_partner_id
      FROM public.players
     WHERE tournament_id = v_reg.tournament_id
       AND email IS NOT NULL AND lower(email) = lower(v_reg.partner_email)
       AND (coalesce(btrim(v_reg.partner_name), '') = ''
            OR split_part(lower(btrim(name)), ' ', 1) = split_part(lower(btrim(v_reg.partner_name)), ' ', 1))
     ORDER BY sort_order, id
     LIMIT 1;

    IF v_partner_id IS NULL THEN
      v_shared := NULL;
      SELECT name INTO v_shared FROM public.players
       WHERE tournament_id = v_reg.tournament_id
         AND email IS NOT NULL AND lower(email) = lower(v_reg.partner_email)
       ORDER BY sort_order, id
       LIMIT 1;
      INSERT INTO public.players (tournament_id, name, color, active, sort_order, email)
      VALUES (v_reg.tournament_id, v_reg.partner_name, '#E63946', true, v_next_sort, v_reg.partner_email)
      RETURNING id INTO v_partner_id;
      IF v_shared IS NOT NULL THEN
        v_warning := concat_ws(' ', v_warning, format(
          'Partner %s was added as a new player because their email also belongs to %s. If they are the same person, fix it before the draw.',
          v_reg.partner_name, v_shared));
      END IF;
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
        v_warning := concat_ws(' ', v_warning, format('%s had already paid their own share, and this entry paid for both. Refund one share.', v_paid_by));
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
