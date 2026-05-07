-- =============================================================================
-- schema_v6_fix_snapshot_order.sql
-- Bugfix: live_snapshot() ordered matches by slot_idx alone. When two
-- matches in the same category shared a slot_idx, Postgres' return order
-- between calls was non-deterministic — match cards visibly swapped
-- positions during editing because two consecutive 5s polls returned the
-- same matches in different order.
--
-- Fix: tiebreak on id so the order is fully deterministic.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION live_snapshot(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tournament', (SELECT to_jsonb(t.*) FROM tournaments t WHERE t.id = p_tournament_id),
    'players',    (SELECT coalesce(jsonb_agg(p ORDER BY p.sort_order, p.id), '[]'::jsonb)
                   FROM players p WHERE p.tournament_id = p_tournament_id),
    'teams',      (SELECT coalesce(jsonb_agg(t ORDER BY t.sort_order, t.id), '[]'::jsonb)
                   FROM teams t WHERE t.tournament_id = p_tournament_id),
    'matches',    (SELECT coalesce(jsonb_agg(m ORDER BY m.slot_idx, m.id), '[]'::jsonb)
                   FROM matches m WHERE m.tournament_id = p_tournament_id),
    'categories', (SELECT coalesce(jsonb_agg(c ORDER BY c.sort_order, c.id), '[]'::jsonb)
                   FROM categories c WHERE c.tournament_id = p_tournament_id),
    'player_categories',
                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', pc.id, 'player_id', pc.player_id, 'category_id', pc.category_id
                  ) ORDER BY pc.id), '[]'::jsonb)
                   FROM player_categories pc
                   JOIN players p ON p.id = pc.player_id
                   WHERE p.tournament_id = p_tournament_id),
    'generated_at', extract(epoch from now())
  );
$$;

GRANT EXECUTE ON FUNCTION live_snapshot(uuid) TO anon, authenticated;
