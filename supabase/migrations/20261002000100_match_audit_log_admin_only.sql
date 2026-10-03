-- Match change history is an admin tool (the 📜 LOG button only renders for admins),
-- but its policy allowed anyone to read it, and changed_by holds the admin's email.
-- Restrict reads to admins. Rows are written by the SECURITY DEFINER trigger
-- log_match_change(), so the API roles need no write privileges.

drop policy if exists "match_audit_read" on public.match_audit_log;
create policy "match_audit_read" on public.match_audit_log
  for select to authenticated using (public.is_admin());

revoke all on public.match_audit_log from anon, authenticated;
grant select on public.match_audit_log to authenticated;
revoke all on public.match_audit_log_id_seq from anon, authenticated;
