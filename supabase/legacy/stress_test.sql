-- ============================================================
-- STRESS TEST: 40 players, 4 categories, 100+ teams, group stages
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Create stress test tournament
INSERT INTO public.tournaments (id, name, event_date, phase, num_courts)
VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'STRESS TEST MEGA TOURNAMENT', '2026-05-10', 'none', 6)
ON CONFLICT (id) DO NOTHING;

-- 2. Create 4 categories
INSERT INTO public.categories (id, tournament_id, name, team_size, match_minutes, starts_at, phase, rounds_per_pair, sort_order) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Mens Doubles', 2, 12, NOW() + interval '10 minutes', 'none', 1, 0),
  ('c2222222-2222-2222-2222-222222222222', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Womens Doubles', 2, 10, NOW() + interval '30 minutes', 'none', 1, 1),
  ('c3333333-3333-3333-3333-333333333333', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Mixed Doubles', 2, 15, NOW() + interval '1 hour', 'none', 1, 2),
  ('c4444444-4444-4444-4444-444444444444', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Mens Singles', 1, 8, NOW() + interval '2 hours', 'none', 1, 3)
ON CONFLICT (id) DO NOTHING;

-- 3. Create 40 players
DO $$
DECLARE
  tid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  colors text[] := ARRAY['#E63946','#457B9D','#2A9D8F','#E9C46A','#F4A261','#264653','#6A4C93','#1982C4','#FF595E','#8AC926','#FFCA3A','#6A0572','#3A86FF','#FB5607','#FF006E','#8338EC'];
  names text[] := ARRAY[
    'Arjun Sharma','Vikram Singh','Rahul Patel','Amir Khan','Sanjay Gupta',
    'Rajesh Kumar','Deepak Verma','Ankit Joshi','Mohit Agarwal','Suresh Reddy',
    'Ravi Nair','Karan Mehta','Nikhil Das','Arun Bhat','Pradeep Rao',
    'Siddharth Iyer','Rohan Malik','Varun Chauhan','Gaurav Saxena','Harsh Tiwari',
    'Priya Sharma','Neha Singh','Ananya Patel','Kavita Reddy','Pooja Verma',
    'Sneha Gupta','Ritu Joshi','Divya Kumar','Swati Nair','Meera Das',
    'Isha Mehta','Tanvi Bhat','Sakshi Rao','Aisha Khan','Nidhi Iyer',
    'Pallavi Malik','Shruti Chauhan','Tanya Saxena','Komal Tiwari','Ritika Agarwal'
  ];
  pid uuid;
BEGIN
  FOR i IN 1..40 LOOP
    INSERT INTO public.players (id, tournament_id, name, color, active, sort_order)
    VALUES (
      gen_random_uuid(),
      tid,
      names[i],
      colors[((i-1) % array_length(colors, 1)) + 1],
      true,
      i - 1
    );
  END LOOP;
END $$;

-- 4. Assign players to categories via player_categories
-- Men (players 1-20) → Mens Doubles, Mens Singles
-- Women (players 21-40) → Womens Doubles
-- Mixed: first 10 men + first 10 women → Mixed Doubles
DO $$
DECLARE
  tid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  pids uuid[];
  i int;
BEGIN
  SELECT array_agg(id ORDER BY sort_order) INTO pids
  FROM public.players WHERE tournament_id = tid;

  -- Mens Doubles: players 1-20
  FOR i IN 1..20 LOOP
    INSERT INTO public.player_categories (player_id, category_id)
    VALUES (pids[i], 'c1111111-1111-1111-1111-111111111111')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Womens Doubles: players 21-40
  FOR i IN 21..40 LOOP
    INSERT INTO public.player_categories (player_id, category_id)
    VALUES (pids[i], 'c2222222-2222-2222-2222-222222222222')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Mixed Doubles: first 10 men + first 10 women
  FOR i IN 1..10 LOOP
    INSERT INTO public.player_categories (player_id, category_id)
    VALUES (pids[i], 'c3333333-3333-3333-3333-333333333333')
    ON CONFLICT DO NOTHING;
  END LOOP;
  FOR i IN 21..30 LOOP
    INSERT INTO public.player_categories (player_id, category_id)
    VALUES (pids[i], 'c3333333-3333-3333-3333-333333333333')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Mens Singles: players 1-16
  FOR i IN 1..16 LOOP
    INSERT INTO public.player_categories (player_id, category_id)
    VALUES (pids[i], 'c4444444-4444-4444-4444-444444444444')
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 5. Create teams
-- Mens Doubles: 10 teams (20 players paired)
-- Womens Doubles: 10 teams (20 players paired)
-- Mixed Doubles: 10 teams (man + woman)
-- Mens Singles: 16 solo teams
DO $$
DECLARE
  tid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  pids uuid[];
  ord int := 0;
BEGIN
  SELECT array_agg(id ORDER BY sort_order) INTO pids
  FROM public.players WHERE tournament_id = tid;

  -- Mens Doubles: 10 teams
  FOR i IN 0..9 LOOP
    INSERT INTO public.teams (tournament_id, category_id, p1_id, p2_id, sort_order, name)
    VALUES (tid, 'c1111111-1111-1111-1111-111111111111', pids[i*2+1], pids[i*2+2], ord, 'MD Team ' || (i+1));
    ord := ord + 1;
  END LOOP;

  -- Womens Doubles: 10 teams
  FOR i IN 0..9 LOOP
    INSERT INTO public.teams (tournament_id, category_id, p1_id, p2_id, sort_order, name)
    VALUES (tid, 'c2222222-2222-2222-2222-222222222222', pids[20+i*2+1], pids[20+i*2+2], ord, 'WD Team ' || (i+1));
    ord := ord + 1;
  END LOOP;

  -- Mixed Doubles: 10 teams (man i + woman i)
  FOR i IN 0..9 LOOP
    INSERT INTO public.teams (tournament_id, category_id, p1_id, p2_id, sort_order, name)
    VALUES (tid, 'c3333333-3333-3333-3333-333333333333', pids[i+1], pids[20+i+1], ord, 'MX Team ' || (i+1));
    ord := ord + 1;
  END LOOP;

  -- Mens Singles: 16 solo teams
  FOR i IN 0..15 LOOP
    INSERT INTO public.teams (tournament_id, category_id, p1_id, p2_id, sort_order, name)
    VALUES (tid, 'c4444444-4444-4444-4444-444444444444', pids[i+1], NULL, ord, 'MS Player ' || (i+1));
    ord := ord + 1;
  END LOOP;
END $$;

-- 6. Generate group-stage matches for ALL 4 categories
-- Groups of 4-5 teams, round-robin within each group
DO $$
DECLARE
  tid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  cat_id uuid;
  cat_ids uuid[] := ARRAY[
    'c1111111-1111-1111-1111-111111111111',
    'c2222222-2222-2222-2222-222222222222',
    'c3333333-3333-3333-3333-333333333333',
    'c4444444-4444-4444-4444-444444444444'
  ];
  team_ids uuid[];
  n_teams int;
  g_size int;
  n_groups int;
  slot int;
  gi int;
  g_start int;
  g_end int;
BEGIN
  FOREACH cat_id IN ARRAY cat_ids LOOP
    SELECT array_agg(id ORDER BY sort_order) INTO team_ids
    FROM public.teams WHERE tournament_id = tid AND category_id = cat_id;

    n_teams := array_length(team_ids, 1);
    IF n_teams IS NULL OR n_teams < 2 THEN CONTINUE; END IF;

    g_size := CASE WHEN n_teams <= 6 THEN 3 ELSE 4 END;
    n_groups := CEIL(n_teams::float / g_size);
    slot := 0;

    FOR gi IN 0..(n_groups - 1) LOOP
      g_start := gi * g_size + 1;
      g_end := LEAST((gi + 1) * g_size, n_teams);

      FOR i IN g_start..g_end LOOP
        FOR j IN (i+1)..g_end LOOP
          INSERT INTO public.matches (
            tournament_id, category_id, stage, group_idx, round_idx, slot_idx,
            team_a_id, team_b_id, score_a, score_b, winner_id,
            confirmed, is_bye, is_walkover, status, started_at, extended_minutes
          ) VALUES (
            tid, cat_id, 'group', gi, NULL, slot,
            team_ids[i], team_ids[j], NULL, NULL, NULL,
            false, false, false, 'pending', NULL, 0
          );
          slot := slot + 1;
        END LOOP;
      END LOOP;
    END LOOP;

    -- Set category phase to group
    UPDATE public.categories SET phase = 'group' WHERE id = cat_id;
  END LOOP;
END $$;

-- 7. Start 6 matches simultaneously on 6 courts (one from each category spread)
DO $$
DECLARE
  tid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  m_id uuid;
  court int := 1;
  cat_ids uuid[] := ARRAY[
    'c1111111-1111-1111-1111-111111111111',
    'c2222222-2222-2222-2222-222222222222',
    'c3333333-3333-3333-3333-333333333333',
    'c4444444-4444-4444-4444-444444444444',
    'c1111111-1111-1111-1111-111111111111',
    'c2222222-2222-2222-2222-222222222222'
  ];
  cat_id uuid;
  started_offsets int[] := ARRAY[0, 0, 0, 0, -2, -2]; -- some started 2 min ago for variety
BEGIN
  FOREACH cat_id IN ARRAY cat_ids LOOP
    SELECT id INTO m_id FROM public.matches
    WHERE tournament_id = tid AND category_id = cat_id AND status = 'pending'
    ORDER BY slot_idx LIMIT 1;

    IF m_id IS NOT NULL THEN
      UPDATE public.matches SET
        status = 'live',
        started_at = NOW() + (started_offsets[court] || ' minutes')::interval,
        court_number = court,
        score_a = floor(random() * 15)::int,
        score_b = floor(random() * 15)::int
      WHERE id = m_id;
      court := court + 1;
    END IF;
  END LOOP;
END $$;

-- 8. Complete a few matches with scores to populate scoreboard
DO $$
DECLARE
  tid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  rec RECORD;
  cnt int := 0;
BEGIN
  FOR rec IN
    SELECT id, team_a_id, team_b_id FROM public.matches
    WHERE tournament_id = tid AND status = 'pending' AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL
    ORDER BY slot_idx
    LIMIT 12
  LOOP
    UPDATE public.matches SET
      status = 'completed',
      confirmed = true,
      score_a = 15 + floor(random() * 10)::int,
      score_b = 8 + floor(random() * 10)::int,
      winner_id = CASE WHEN random() > 0.5 THEN rec.team_a_id ELSE rec.team_b_id END,
      confirmed_at = NOW() - (cnt || ' minutes')::interval
    WHERE id = rec.id;
    cnt := cnt + 1;
  END LOOP;
END $$;

-- Summary
SELECT 'STRESS TEST DATA CREATED' AS status,
  (SELECT count(*) FROM public.players WHERE tournament_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') AS players,
  (SELECT count(*) FROM public.categories WHERE tournament_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') AS categories,
  (SELECT count(*) FROM public.teams WHERE tournament_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') AS teams,
  (SELECT count(*) FROM public.matches WHERE tournament_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') AS matches,
  (SELECT count(*) FROM public.matches WHERE tournament_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' AND status = 'live') AS live_matches,
  (SELECT count(*) FROM public.matches WHERE tournament_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' AND confirmed = true) AS completed_matches,
  (SELECT count(*) FROM public.player_categories pc JOIN public.players p ON pc.player_id = p.id WHERE p.tournament_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') AS player_category_assignments;
