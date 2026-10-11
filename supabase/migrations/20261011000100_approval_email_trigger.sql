-- Send the "You're in!" email from the database when an entry is approved,
-- instead of relying on the admin's browser (an admin tab opened before a
-- deploy runs old code; a closed laptop or dropped connection skips the call).
--
-- On approval, pg_net calls the registration-email Edge Function after the
-- transaction commits, authenticated by a shared secret kept in Vault (and
-- set as the function's REGISTRATION_EMAIL_SECRET). The function claims the
-- email in the row first, so the admin client's own call and this one never
-- both send.

create extension if not exists pg_net with schema extensions;

-- Generated here so the secret never appears in the repository.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'registration_email_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'registration_email_secret',
      'Shared secret: database -> registration-email Edge Function');
  end if;
end $$;

create or replace function public.queue_approval_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.approval_email_status is null then
    select decrypted_secret into secret from vault.decrypted_secrets where name = 'registration_email_secret';
    if secret is null then
      return new;
    end if;
    perform net.http_post(
      url := 'https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/registration-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', secret),
      body := jsonb_build_object('registration_id', new.id),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$$;

revoke all on function public.queue_approval_email() from public, anon, authenticated;

drop trigger if exists pending_registrations_approval_email on public.pending_registrations;
create trigger pending_registrations_approval_email
  after update of status on public.pending_registrations
  for each row execute function public.queue_approval_email();
