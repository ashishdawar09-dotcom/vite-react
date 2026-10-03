-- Schema v5: Player-category assignments (junction table)
-- Allows players to be assigned to multiple categories
-- Safe to run multiple times (idempotent)

CREATE TABLE IF NOT EXISTS public.player_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(player_id, category_id)
);

-- RLS
ALTER TABLE public.player_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_categories_read" ON public.player_categories;
CREATE POLICY "player_categories_read" ON public.player_categories FOR SELECT USING (true);
DROP POLICY IF EXISTS "player_categories_write" ON public.player_categories;
CREATE POLICY "player_categories_write" ON public.player_categories FOR ALL USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.player_categories;

-- Replica identity for realtime
ALTER TABLE public.player_categories REPLICA IDENTITY FULL;

-- Backfill: for each player who is on a team, auto-assign them to that team's category
INSERT INTO public.player_categories (player_id, category_id)
SELECT DISTINCT t.p1_id, t.category_id FROM public.teams t
WHERE t.p1_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.player_categories (player_id, category_id)
SELECT DISTINCT t.p2_id, t.category_id FROM public.teams t
WHERE t.p2_id IS NOT NULL
ON CONFLICT DO NOTHING;
