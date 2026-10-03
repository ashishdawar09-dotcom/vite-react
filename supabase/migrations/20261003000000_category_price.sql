-- Registration price is set per category instead of the tournament-level
-- age band x membership grid (tournaments.fees, now unused by the app).
--   price        CAD; null = not set (the form shows no price)
--   price_basis  'per_player' or 'per_team'. Singles are always per player.

alter table public.categories
  add column price numeric(8, 2),
  add column price_basis text not null default 'per_player';

alter table public.categories
  add constraint categories_price_nonnegative check (price is null or price >= 0),
  add constraint categories_price_basis_check check (price_basis in ('per_player', 'per_team')),
  add constraint categories_singles_per_player check (team_size = 2 or price_basis = 'per_player');
