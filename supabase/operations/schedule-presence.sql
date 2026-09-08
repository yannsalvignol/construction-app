-- Run only against the explicitly selected deployment environment.
-- Prerequisites: deploy presence-dispatch, set its PRESENCE_DISPATCH_SECRET,
-- and create matching Vault secrets named presence_project_url and presence_dispatch_secret.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'presence_project_url' and decrypted_secret like 'https://%')
    or not exists (select 1 from vault.decrypted_secrets where name = 'presence_dispatch_secret' and length(decrypted_secret) >= 32) then
    raise exception 'Configure the presence_project_url and presence_dispatch_secret Vault secrets first';
  end if;
end $$;

-- Scheduling with the same name updates the existing job instead of duplicating it.
select cron.schedule(
  'casprod-presence-dispatch',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'presence_project_url') || '/functions/v1/presence-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'presence_dispatch_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $job$
);
commit;
