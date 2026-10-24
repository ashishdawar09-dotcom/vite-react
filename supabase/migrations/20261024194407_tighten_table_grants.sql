-- Defence in depth: RLS already blocks these, but the roles no longer hold
-- the privileges either. Visitors (anon) only read; signed-in users write
-- only the tables that have admin write policies. Everything else goes
-- through Edge Functions (service role) or SECURITY DEFINER RPCs.

-- Visitors never write.
revoke insert, update, delete, truncate, references, trigger, maintain
  on all tables in schema public from anon;

-- Admin-only tables: visitors don't read them either.
revoke select on public.pending_registrations, public.notification_log,
  public.push_subscriptions, public.tournament_admins
  from anon;

-- Nobody truncates or adds triggers/foreign keys through the API.
revoke truncate, references, trigger, maintain
  on all tables in schema public from authenticated;

-- Tables with no write policy: written only by functions and triggers.
revoke insert, update, delete on public.pending_registrations,
  public.notification_log, public.push_subscriptions, public.match_audit_log,
  public.waiver_consents, public.rate_limit_events, public.player_delete_codes
  from authenticated;
