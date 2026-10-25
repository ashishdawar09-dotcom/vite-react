-- Race-day-sized synthetic tournament for load tests (U9) and UI checks.
-- SCRATCH PROJECT ONLY. Never run this against production.
--
-- Creates tournament "Load Cup" (slug `loadtest`) beside the smaller
-- "Rehearsal Cup" fixture: 10 categories, 70 teams, 120 synthetic players
-- (116 on teams, 4 registered but unpaired), 102 matches (90 group in two
-- groups per category, 12 knockout), 4 live, 2 allocated to a court but not
-- started. Re-running deletes the old Load Cup first (FKs cascade).
-- Synthetic names only: no real player data.

do $$
declare
  tid uuid;
  cat_names text[] := array[
    'Men''s Singles', 'Men''s Doubles 18–34', 'Men''s Doubles 35+',
    'Women''s Doubles 18–34', 'Women''s Doubles 35+', 'Mixed Doubles 18–34',
    'Mixed Doubles 35+', 'Super Doubles 50+', 'Youth Boys'' Singles',
    'Youth Girls'' Singles'];
  cat_size int[]  := array[1, 2, 2, 2, 2, 2, 2, 2, 1, 1];
  cat_teams int[] := array[8, 8, 8, 6, 6, 6, 6, 6, 8, 8];
  first_names text[] := array['Avery','Blake','Casey','Devon','Emery','Finley','Gray','Harper',
    'Indy','Jordan','Kai','Logan','Morgan','Noel','Oakley','Parker','Quinn','Reese','Sage',
    'Taylor','Umi','Vale','Wren','Xen','Yael','Zion','Ari','Bay','Cruz','Dale','Eden','Fox',
    'Gale','Hollis','Iris','Jules','Kit','Lane','Milan','Nico'];
  last_names text[] := array['Alder','Birch','Cedar','Dune','Elm','Fern'];
  pal text[] := array['#E63946','#457B9D','#2A9D8F','#E9C46A','#F4A261','#264653','#6A4C93','#1982C4'];
  c int; k int; g int; i int; j int; gsize int; slot int := 0; pidx int := 0;
  court int := 0; warm int := 0;
  cid uuid; p1 uuid; p2 uuid; tm uuid; team_ids uuid[]; status text; sa int; sb int;
  start_at timestamptz := date_trunc('day', now()) + interval '17 hours 30 minutes';
begin
  delete from tournaments where slug = 'loadtest';

  -- Copy the rehearsal tournament's long text fields (waiver etc.) so the
  -- payload carries the same per-poll overhead production does.
  insert into tournaments (name, slug, event_date, phase, num_courts, venue_name, venue_address,
    event_time, contact_info, fees, registration_open, terms_text, waiver_text, waiver_version,
    rules_url, youth_price, student_price, student_label)
  select 'Load Cup', 'loadtest', current_date, 'group', 4, venue_name, venue_address,
    event_time, contact_info, fees, false, terms_text,
    coalesce(waiver_text, repeat('Synthetic waiver text for payload sizing. ', 80)),
    coalesce(waiver_version, 'v1'), rules_url, youth_price, student_price, student_label
  from tournaments where slug = 'rehearsal'
  returning id into tid;
  if tid is null then
    insert into tournaments (name, slug, event_date, phase, num_courts, registration_open, waiver_text, waiver_version)
    values ('Load Cup', 'loadtest', current_date, 'group', 4, false,
            repeat('Synthetic waiver text for payload sizing. ', 80), 'v1')
    returning id into tid;
  end if;

  for c in 1..10 loop
    insert into categories (tournament_id, name, team_size, match_minutes, starts_at, phase,
      rounds_per_pair, sort_order, groups_count, top_n_advance, age_band, has_bronze_match,
      price, price_basis)
    values (tid, cat_names[c], cat_size[c], 20, start_at + (c % 3) * interval '1 hour',
      case when c <= 3 then 'knockout' else 'group' end, 1, c, 2, 2,
      case when c >= 9 then 'teen' else 'adult' end, true, 40,
      case when cat_size[c] = 2 then 'per_team' else 'per_player' end)
    returning id into cid;

    team_ids := array[]::uuid[];
    for k in 1..cat_teams[c] loop
      pidx := pidx + 1;
      insert into players (tournament_id, name, color, active, sort_order, checked_in_at)
      values (tid, first_names[1 + (pidx - 1) % 40] || ' ' || last_names[1 + (pidx - 1) / 40 % 6],
              pal[1 + pidx % 8], true, pidx, now() - interval '1 hour')
      returning id into p1;
      insert into player_categories (player_id, category_id) values (p1, cid);
      p2 := null;
      if cat_size[c] = 2 then
        pidx := pidx + 1;
        insert into players (tournament_id, name, color, active, sort_order)
        values (tid, first_names[1 + (pidx - 1) % 40] || ' ' || last_names[1 + (pidx - 1) / 40 % 6],
                pal[1 + pidx % 8], true, pidx)
        returning id into p2;
        insert into player_categories (player_id, category_id) values (p2, cid);
      end if;
      insert into teams (tournament_id, name, p1_id, p2_id, sort_order, category_id)
      values (tid, 'Team ' || c || '-' || k, p1, p2, k, cid)
      returning id into tm;
      team_ids := team_ids || tm;
    end loop;

    -- Group stage: two groups per category, single round robin in each.
    gsize := cat_teams[c] / 2;
    for g in 0..1 loop
      for i in 1..gsize loop
        for j in (i + 1)..gsize loop
          slot := slot + 1;
          if c <= 3 or slot % 3 <> 0 then
            status := 'completed';
          elsif court < 4 then
            court := court + 1; status := 'live';
          else
            status := 'pending';
          end if;
          sa := case when status = 'pending' then null when status = 'live' then 8 + slot % 9 else 21 end;
          sb := case when status = 'pending' then null when status = 'live' then 5 + slot % 11 else 10 + slot % 10 end;
          insert into matches (tournament_id, category_id, stage, group_idx, round_idx, slot_idx,
            team_a_id, team_b_id, score_a, score_b, winner_id, confirmed, status, started_at,
            confirmed_at, court_number, court_allocated_at, queue_position)
          values (tid, cid, 'group', g, i, slot, team_ids[g * gsize + i], team_ids[g * gsize + j], sa, sb,
            case when status = 'completed' then team_ids[g * gsize + i] end, status = 'completed', status,
            case when status <> 'pending' then now() - interval '30 minutes' end,
            case when status = 'completed' then now() - interval '20 minutes' end,
            case when status = 'live' then court
                 when status = 'pending' and warm < 2 then warm + 1 end,
            case when status = 'live' then now() - interval '12 minutes'
                 when status = 'pending' and warm < 2 then now() - interval '1 minute' end,
            case when status = 'pending' then slot end);
          if status = 'pending' and warm < 2 then warm := warm + 1; end if;
        end loop;
      end loop;
    end loop;

    -- Knockout for the first three categories: semis done in two of them,
    -- final and bronze pending.
    if c <= 3 then
      for k in 1..4 loop
        slot := slot + 1;
        status := case when k <= 2 and c <= 2 then 'completed' else 'pending' end;
        insert into matches (tournament_id, category_id, stage, round_idx, slot_idx, team_a_id,
          team_b_id, score_a, score_b, winner_id, confirmed, status, is_bronze, queue_position)
        values (tid, cid, 'knockout', case when k <= 2 then 0 else 1 end, slot,
          case when k <= 2 or c <= 2 then team_ids[k] end,
          case when k <= 2 or c <= 2 then team_ids[cat_teams[c] + 1 - k] end,
          case when status = 'completed' then 21 end, case when status = 'completed' then 17 end,
          case when status = 'completed' then team_ids[k] end, status = 'completed', status,
          k = 4, case when status = 'pending' then slot end);
      end loop;
    end if;
  end loop;

  -- Registered but not yet on a team (solo doubles entries).
  for k in 1..4 loop
    pidx := pidx + 1;
    insert into players (tournament_id, name, color, active, sort_order)
    values (tid, first_names[1 + (pidx - 1) % 40] || ' ' || last_names[1 + (pidx - 1) / 40 % 6],
            pal[1 + pidx % 8], true, pidx);
  end loop;
end $$;

select t.id, t.slug,
  (select count(*) from categories where tournament_id = t.id) as categories,
  (select count(*) from players where tournament_id = t.id) as players,
  (select count(*) from teams where tournament_id = t.id) as teams,
  (select count(*) from matches where tournament_id = t.id) as matches,
  (select count(*) from matches where tournament_id = t.id and status = 'live') as live,
  (select count(*) from matches where tournament_id = t.id and status = 'pending' and court_allocated_at is not null) as allocated,
  length(public.live_snapshot(t.id)::text) as snapshot_bytes
from tournaments t where t.slug = 'loadtest';
