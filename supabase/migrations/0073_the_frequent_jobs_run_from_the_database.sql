-- The every-few-minutes jobs, scheduled from the database.
--
-- Vercel's Hobby plan only runs cron jobs once a day, and a sub-daily schedule
-- in vercel.json fails the deploy. So the four frequent schedules move here:
-- pg_cron fires them and pg_net calls the same routes Vercel Cron used to.
-- The daily and weekly runs stay in vercel.json.
--
-- Each call sends what Vercel Cron sent: the shared secret as a bearer token
-- and the schedule in x-vercel-cron-schedule, so lib/frequent-jobs.ts still
-- recognises a frequent run and the FREQUENT_JOBS switch still governs it.
--
-- The secret lives in Supabase Vault as 'pylon_cron_secret' and must equal the
-- CRON_SECRET in the Vercel environment. Until it is there, the call is skipped.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.call_cron_route(route text, schedule text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'pylon_cron_secret'
  limit 1;

  if secret is null then
    raise warning 'pylon_cron_secret is not in Vault; % skipped', route;
    return;
  end if;

  perform net.http_get(
    url := 'https://www.pylonn.app' || route,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || secret,
      'x-vercel-cron-schedule', schedule
    ),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function private.call_cron_route(text, text) from public, anon, authenticated;

select cron.schedule('pylon-push',      '*/10 * * * *', $$select private.call_cron_route('/api/cron/push', '*/10 * * * *')$$);
select cron.schedule('pylon-scores',    '*/5 * * * *',  $$select private.call_cron_route('/api/cron/scores', '*/5 * * * *')$$);
select cron.schedule('pylon-mail',      '*/5 * * * *',  $$select private.call_cron_route('/api/cron/mail', '*/5 * * * *')$$);
select cron.schedule('pylon-autodraft', '*/5 * * * *',  $$select private.call_cron_route('/api/cron/autodraft', '*/5 * * * *')$$);
