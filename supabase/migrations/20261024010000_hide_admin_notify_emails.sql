-- tournaments.admin_notify_emails (the directors' alert addresses) was
-- readable by anyone: through the table's public SELECT grant and through
-- live_snapshot, which returned the whole tournament row. Only the
-- registration-email Edge Function (service role) needs it.

-- Column grants only bite once the table-wide grant is gone.
revoke select on public.tournaments from anon, authenticated;
grant select (
  id, name, event_date, phase, created_at, created_by, rounds_per_pair, num_courts,
  venue_name, venue_address, venue_map_url, event_time, registration_deadline,
  contact_info, e_transfer_email, fees, registration_open, terms_text, slug,
  rules_url, waiver_url, waiver_text, waiver_version, youth_price, student_price,
  student_label, reply_to_email
) on public.tournaments to anon, authenticated;

create or replace function public.live_snapshot(p_tournament_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  SELECT jsonb_build_object(
    'tournament', (SELECT to_jsonb(t.*) - 'admin_notify_emails' FROM tournaments t WHERE t.id = p_tournament_id),
    'players',    (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', p.id,
                      'tournament_id', p.tournament_id,
                      'name', p.name,
                      'color', p.color,
                      'photo_url', p.photo_url,
                      'note', p.note,
                      'active', p.active,
                      'sort_order', p.sort_order,
                      'created_at', p.created_at,
                      'checked_in_at', p.checked_in_at
                  ) ORDER BY p.sort_order), '[]'::jsonb)
                   FROM players p WHERE p.tournament_id = p_tournament_id),
    'teams',      (SELECT coalesce(jsonb_agg(t ORDER BY t.sort_order), '[]'::jsonb)
                   FROM teams t WHERE t.tournament_id = p_tournament_id),
    'matches',    (SELECT coalesce(jsonb_agg(m ORDER BY m.slot_idx), '[]'::jsonb)
                   FROM matches m WHERE m.tournament_id = p_tournament_id),
    'categories', (SELECT coalesce(jsonb_agg(c ORDER BY c.sort_order), '[]'::jsonb)
                   FROM categories c WHERE c.tournament_id = p_tournament_id),
    'player_categories',
                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', pc.id, 'player_id', pc.player_id, 'category_id', pc.category_id
                  )), '[]'::jsonb)
                   FROM player_categories pc
                   JOIN players p ON p.id = pc.player_id
                   WHERE p.tournament_id = p_tournament_id),
    'generated_at', extract(epoch from now())
  );
$function$;
