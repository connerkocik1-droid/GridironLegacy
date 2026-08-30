-- Somewhere to put the intro film.
--
-- Crests are kilobytes and live in a table. A video is megabytes and cannot:
-- it would sit in a row that other queries read, and it would not survive the
-- request-body limit on the way in either. So it goes to Supabase Storage, and
-- what the league keeps is the address.
--
-- The bucket is public. What is in it is a title sequence the whole league is
-- about to watch together, and a public bucket means the browser fetches it
-- straight from the CDN with no token to mint and nothing to expire halfway
-- through draft night. Writing to it is another matter — that happens only
-- through a short-lived upload URL the server mints for the commissioner.
--
-- Guarded, because the storage schema is a Supabase thing. A plain Postgres —
-- the one the tests run against — has no storage.buckets, and this migration
-- must not fail there.

do $media$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'no storage schema here — skipping the league-media bucket';
    return;
  end if;

  -- Only id, name and public are touched. The other columns on this table have
  -- come and gone across Supabase versions, and naming one that is not there
  -- would fail the whole migration for the sake of a default.
  insert into storage.buckets (id, name, public)
  values ('league-media', 'league-media', true)
  on conflict (id) do update set public = true;

  raise notice 'league-media bucket ready';
end
$media$;
