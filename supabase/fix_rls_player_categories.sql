-- Fix: player_categories write policy was wide open (public write access)
-- Replace with admin-only write, keep public read
DROP POLICY IF EXISTS "player_categories_write" ON public.player_categories;
CREATE POLICY "player_categories_write" ON public.player_categories
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
