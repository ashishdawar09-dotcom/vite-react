-- SCRATCH ONLY. A tournament with a parent's entry and her child's entry on
-- the same email, both pending, for approving through the admin screen.
-- Re-runnable: removes the previous copy first (slug approval-check).
delete from tournaments where slug = 'approval-check';
with t as (
  insert into tournaments (name, slug, event_date, num_courts)
  values ('Approval Check (QA)', 'approval-check', '2026-11-21', 4)
  returning id
), c as (
  insert into categories (tournament_id, name, team_size, sort_order)
  select id, x.name, x.size, x.ord from t,
    (values ('Women''s Singles', 1, 0), ('Youth Girls'' Singles', 1, 1)) as x(name, size, ord)
  returning id, name, tournament_id
)
insert into pending_registrations (tournament_id, category_id, player_name, player_email, player_age, payment_reference, submitted_at)
select c.tournament_id, c.id,
       case when c.name like 'Youth%' then 'Meera Test' else 'Priya Test' end,
       'family@example.test',
       case when c.name like 'Youth%' then 12 else 40 end,
       'QA-REF',
       now() - case when c.name like 'Youth%' then interval '1 minute' else interval '2 minutes' end
from c;
select r.player_name, r.player_age, r.status, c.name as category
from pending_registrations r join categories c on c.id = r.category_id
join tournaments t on t.id = r.tournament_id where t.slug = 'approval-check' order by r.submitted_at;
