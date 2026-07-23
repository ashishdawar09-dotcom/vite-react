-- =============================================================================
-- schema_v17_my_player.sql
--
-- Adds a self-identity lookup so the voice agent can auto-identify a logged-in
-- user without exposing anyone's email. Idempotent — safe to re-run. Run in
-- Supabase Dashboard → SQL Editor.
--
-- Why this exists:
--   players has no user_id/auth link, and schema_v16 REVOKE'd SELECT(email) from
--   anon AND authenticated. So the browser cannot map a logged-in user to their
--   player row. This SECURITY DEFINER RPC matches players.email against the
--   caller's verified JWT email server-side and returns ONLY the caller's own
--   player id/name + their team ids. It never returns anyone else's data, and
--   never returns an email. Mirrors the admin_players()/live_snapshot() pattern.
--
-- Consumed by the badminton web app's voice widget (useVoiceIdentity) — the
-- returned player id is passed to the Cloudflare voice agent as `playerId`.
-- =============================================================================

CREATE OR REPLACE FUNCTION my_player(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'player', (
      SELECT jsonb_build_object('id', p.id, 'name', p.name)
      FROM players p
      WHERE p.tournament_id = p_tournament_id
        AND p.email IS NOT NULL
        AND lower(p.email) = lower(auth.jwt() ->> 'email')
      LIMIT 1
    ),
    'team_ids', (
      SELECT coalesce(jsonb_agg(t.id), '[]'::jsonb)
      FROM teams t
      JOIN players p ON (p.id = t.p1_id OR p.id = t.p2_id)
      WHERE t.tournament_id = p_tournament_id
        AND p.email IS NOT NULL
        AND lower(p.email) = lower(auth.jwt() ->> 'email')
    )
  );
$$;

-- Only signed-in users may call it; the JWT email is the match key. Not granted
-- to anon (an anonymous caller has no jwt email, so it would return nulls anyway).
REVOKE ALL ON FUNCTION my_player(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_player(uuid) TO authenticated;

-- Refresh PostgREST's schema cache so the RPC is callable immediately.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification (run manually; read-only):
--   -- As an authenticated user whose email matches a player, this returns
--   -- { "player": { "id": ..., "name": ... }, "team_ids": [ ... ] }.
--   -- As anon or a non-participant, "player" is null and "team_ids" is [].
--   SELECT my_player('<tournament-uuid>');
-- ---------------------------------------------------------------------------
