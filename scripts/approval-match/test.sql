-- Checks for approve_registration's player matching (migration
-- 20261105050000_approve_match_name_and_email.sql). Run on the SCRATCH
-- project only, after the migration:
--   python3 scratchq.py -f scripts/approval-match/test.sql
-- Everything happens in one transaction that ends with an exception, so
-- nothing is kept; the exception message is the PASS/FAIL list.
do $$
declare
  t uuid; c_wd uuid; c_ygs uuid; c_ygs2 uuid; c_md uuid; c_md2 uuid; c_mx uuid;
  r jsonb; reg uuid; out text := ''; fails int := 0;
  parent uuid; alex uuid; child uuid; jagan uuid;
  ok boolean;
begin
  perform set_config('request.jwt.claims', '{"email":"admin@scratch.test","role":"authenticated"}', true);
  if not public.is_admin() then raise exception 'admin@scratch.test is not in tournament_admins'; end if;

  insert into tournaments (name) values ('Approval match test (rolled back)') returning id into t;
  insert into categories (tournament_id, name, team_size) values (t, 'Women''s Doubles', 2) returning id into c_wd;
  insert into categories (tournament_id, name, team_size) values (t, 'Youth Girls'' Singles', 1) returning id into c_ygs;
  insert into categories (tournament_id, name, team_size) values (t, 'Youth Girls'' Singles B', 1) returning id into c_ygs2;
  insert into categories (tournament_id, name, team_size) values (t, 'Men''s Doubles', 2) returning id into c_md;
  insert into categories (tournament_id, name, team_size) values (t, 'Men''s Doubles B', 2) returning id into c_md2;
  insert into categories (tournament_id, name, team_size) values (t, 'Mixed Doubles', 2) returning id into c_mx;

  -- 1. Mother enters herself with a partner.
  insert into pending_registrations (payment_reference, tournament_id, category_id, player_name, player_email, player_age, partner_name, partner_email, partner_age)
  values ('TEST-REF', t, c_wd, 'Parvathy Tingu', 'parent@example.test', 39, 'Alexandra Wijaya', 'alex@example.test', 28) returning id into reg;
  r := public.approve_registration(reg);
  parent := (r->>'player_id')::uuid; alex := (r->>'partner_id')::uuid;
  ok := parent is not null and alex is not null and r->>'team_id' is not null and r->>'warning' is null;
  out := out || format(E'%s 1 parent + partner approved, team made\n', case when ok then 'PASS' else 'FAIL' end); fails := fails + (not ok)::int;

  -- 2. Mother enters her daughter with the same email: a new player, not the mother.
  insert into pending_registrations (payment_reference, tournament_id, category_id, player_name, player_email, player_age)
  values ('TEST-REF', t, c_ygs, 'Vaishanvi Krishna', 'PARENT@example.test', 12) returning id into reg;
  r := public.approve_registration(reg);
  child := (r->>'player_id')::uuid;
  ok := child is not null and child <> parent
    and coalesce(r->>'warning', '') like '%Vaishanvi Krishna was added as a new player because their email also belongs to Parvathy Tingu%';
  out := out || format(E'%s 2 child on parent''s email gets her own player + a warning (%s)\n', case when ok then 'PASS' else 'FAIL' end, coalesce(r->>'warning', 'no warning')); fails := fails + (not ok)::int;
  ok := (select age from players where id = parent) = 39 and (select age from players where id = child) = 12
    and not exists (select 1 from player_categories where player_id = parent and category_id = c_ygs)
    and exists (select 1 from player_categories where player_id = child and category_id = c_ygs)
    and (select approved_player_id from pending_registrations where id = reg) = child;
  out := out || format(E'%s 3 mother keeps age 39 and her events; the child has age 12 and the event\n', case when ok then 'PASS' else 'FAIL' end); fails := fails + (not ok)::int;

  -- 3. The same child entered in a second event: same player, no warning.
  insert into pending_registrations (payment_reference, tournament_id, category_id, player_name, player_email, player_age)
  values ('TEST-REF', t, c_ygs2, 'vaishanvi  krishna', 'parent@example.test', 12) returning id into reg;
  r := public.approve_registration(reg);
  ok := (r->>'player_id')::uuid = child and r->>'warning' is null;
  out := out || format(E'%s 4 child''s second event finds her own player\n', case when ok then 'PASS' else 'FAIL' end); fails := fails + (not ok)::int;

  -- 4. Partner's own entry, naming the mother by first name only: links the team.
  insert into pending_registrations (payment_reference, tournament_id, category_id, player_name, player_email, player_age, partner_name, partner_email)
  values ('TEST-REF', t, c_wd, 'Alexandra Wijaya', 'alex@example.test', 28, 'Parvathy', 'parent@example.test') returning id into reg;
  r := public.approve_registration(reg);
  ok := (r->>'player_id')::uuid = alex and (r->>'partner_id')::uuid = parent and (r->>'linked_existing_team')::boolean and r->>'warning' is null;
  out := out || format(E'%s 5 pair''s second entry (partner by first name) links to the mother, not the child\n', case when ok then 'PASS' else 'FAIL' end); fails := fails + (not ok)::int;

  -- 5. Same person, shorter name on a later entry: same player.
  insert into pending_registrations (payment_reference, tournament_id, category_id, player_name, player_email, player_age)
  values ('TEST-REF', t, c_md, 'Jagan Krishnaraj', 'jagan@example.test', 43) returning id into reg;
  r := public.approve_registration(reg);
  jagan := (r->>'player_id')::uuid;
  insert into pending_registrations (payment_reference, tournament_id, category_id, player_name, player_email, player_age)
  values ('TEST-REF', t, c_md2, 'Jagan', 'jagan@example.test', 43) returning id into reg;
  r := public.approve_registration(reg);
  ok := (r->>'player_id')::uuid = jagan and r->>'warning' is null;
  out := out || format(E'%s 6 "Jagan" finds "Jagan Krishnaraj" (same email, same first name)\n', case when ok then 'PASS' else 'FAIL' end); fails := fails + (not ok)::int;

  -- 6. Partner named by a nickname: kept apart, with a warning for the director.
  insert into pending_registrations (payment_reference, tournament_id, category_id, player_name, player_email, player_age, partner_name, partner_email)
  values ('TEST-REF', t, c_mx, 'Arif', 'arif@example.test', 35, 'Jag', 'jagan@example.test') returning id into reg;
  r := public.approve_registration(reg);
  ok := (r->>'partner_id')::uuid <> jagan
    and coalesce(r->>'warning', '') like 'Partner Jag was added as a new player because their email also belongs to Jagan Krishnaraj%';
  out := out || format(E'%s 7 nickname partner is a new player + warning (%s)\n', case when ok then 'PASS' else 'FAIL' end, coalesce(r->>'warning', 'no warning')); fails := fails + (not ok)::int;

  -- 7. Partner with an email but no name: email alone, as before.
  insert into pending_registrations (payment_reference, tournament_id, category_id, player_name, player_email, player_age, partner_name, partner_email)
  values ('TEST-REF', t, c_md, 'Ravi Kumar', 'ravi@example.test', 40, '  ', 'jagan@example.test') returning id into reg;
  begin
    r := public.approve_registration(reg);
    ok := (r->>'partner_id')::uuid = jagan;
  exception when others then
    ok := false; r := jsonb_build_object('error', sqlerrm);
  end;
  out := out || format(E'%s 8 blank partner name still matches on email (%s)\n', case when ok then 'PASS' else 'FAIL' end, coalesce(r->>'error', 'ok')); fails := fails + (not ok)::int;

  -- 8. A different adult on a shared family email: kept apart, with a warning.
  insert into pending_registrations (payment_reference, tournament_id, category_id, player_name, player_email, player_age)
  values ('TEST-REF', t, c_md2, 'Krishna Tingu', 'parent@example.test', 41) returning id into reg;
  r := public.approve_registration(reg);
  ok := (r->>'player_id')::uuid not in (parent, child) and coalesce(r->>'warning', '') like '%also belongs to Parvathy Tingu%';
  out := out || format(E'%s 9 spouse on the family email is a separate player + warning\n', case when ok then 'PASS' else 'FAIL' end); fails := fails + (not ok)::int;

  raise exception E'APPROVAL MATCH TESTS: % failed\n%', fails, out;
end $$;
