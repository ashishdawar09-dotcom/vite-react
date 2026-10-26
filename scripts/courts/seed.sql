-- "Courts Cup" (slug `courts`): Shuttle-Storm-shaped fixture for the
-- court-lock, standings and cancel rehearsal (same seed as scripts/blockers/seed.sql). SCRATCH PROJECT ONLY (aabsbcvzknsdbirrmlfr).
-- 10 real category names plus a 2-player singles one, 4 courts, categories at phase 'none' with doubles
-- teams already formed, so group stage, knockout etc. are driven in the UI.
-- Synthetic names only. Re-running deletes the old Courts Cup first.
do $$
declare
  tid uuid; cid uuid; p uuid; q uuid;
  -- name, team_size, entrants, match_minutes, bronze
  cats text[][] := array[
    ['Men''s Singles','1','9','12','t'],
    ['Men''s Doubles 18–34','2','5','12','f'],
    ['Men''s Doubles 35+','2','4','1','f'],
    ['Women''s Doubles 18–34','2','3','12','f'],
    ['Women''s Doubles 35+','2','2','12','f'],
    ['Mixed Doubles 18–34','2','8','12','t'],
    ['Mixed Doubles 35+','2','4','12','f'],
    ['Super Doubles 50+','2','3','12','f'],
    ['Youth Boys'' Singles','1','5','1','f'],
    ['Youth Girls'' Singles','1','3','12','f'],
    -- Production has a singles category with exactly 2 players (blocker 5).
    ['Two Singles','1','2','12','f']];
  abbr text[] := array['MS','MD','MV','WD','WV','XD','XV','SD','YB','YG','TS'];
  c int; k int; n int; sz int;
  ms_ids uuid[] := array[]::uuid[];
begin
  -- Refuse to run anywhere the real tournament exists (i.e. production).
  if exists (select 1 from tournaments where slug = 'shuttle-storm') then
    raise exception 'Refusing to seed: tournament "shuttle-storm" exists, so this is not the scratch project.';
  end if;
  delete from tournaments where slug = 'courts';
  insert into tournaments (name, slug, event_date, phase, num_courts, registration_open, waiver_version)
  values ('Courts Cup', 'courts', date '2026-11-21', 'none', 4, false, 'v1')
  returning id into tid;

  for c in 1..11 loop
    sz := cats[c][2]::int; n := cats[c][3]::int;
    insert into categories (tournament_id, name, team_size, match_minutes, phase, sort_order, has_bronze_match,
      age_band, price, price_basis)
    values (tid, cats[c][1], sz, cats[c][4]::int, 'none', c, cats[c][5] = 't',
      case when c >= 9 then 'teen' else 'adult' end, 40,
      case when sz = 2 then 'per_team' else 'per_player' end)
    returning id into cid;
    for k in 1..n loop
      -- Overlap: MD 18–34 team 1 and XD 18–34 team 1 reuse Men's Singles players
      -- 1 and 2, so the same person can be booked on two courts.
      if c = 2 and k = 1 then p := ms_ids[1];
      elsif c = 6 and k = 1 then p := ms_ids[2];
      else
        insert into players (tournament_id, name, color, active, sort_order, checked_in_at)
        values (tid, abbr[c] || ' P' || k || 'a', '#457B9D', true, c * 100 + k, now())
        returning id into p;
      end if;
      insert into player_categories (player_id, category_id) values (p, cid) on conflict do nothing;
      if c = 1 then ms_ids := ms_ids || p; end if;
      if sz = 2 then
        insert into players (tournament_id, name, color, active, sort_order, checked_in_at)
        values (tid, abbr[c] || ' P' || k || 'b', '#E63946', true, c * 100 + 50 + k, now())
        returning id into q;
        insert into player_categories (player_id, category_id) values (q, cid);
        insert into teams (tournament_id, name, p1_id, p2_id, sort_order, category_id)
        values (tid, abbr[c] || ' T' || k, p, q, k, cid);
      end if;
    end loop;
  end loop;
end $$;
select t.id,
  (select count(*) from categories where tournament_id=t.id) cats,
  (select count(*) from players where tournament_id=t.id) players,
  (select count(*) from teams where tournament_id=t.id) teams
from tournaments t where slug='courts';
