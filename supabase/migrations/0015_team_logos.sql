-- A franchise gets a face.
--
-- Managers could rename their franchise from the first day, but it has always
-- been a word on a list. This gives them a crest to go with it, and somewhere
-- for it to appear: the profile button in the corner of every page.
--
-- The image lives in its own table rather than on managers, deliberately. The
-- managers row is read constantly — the draft room polls it four times a
-- minute — and a picture on it would be dragged through every one of those
-- reads whether anyone was going to draw it or not. Here it is fetched when it
-- is wanted and not otherwise.
--
-- It is stored inline as a data URI rather than in object storage. Twelve
-- small crests do not need a bucket, a policy, and a second thing to configure
-- before the league can start; the size limit below is what keeps that honest.

create table if not exists team_logos (
  manager_id  uuid primary key references managers(id) on delete cascade,
  league_id   uuid not null references leagues(id) on delete cascade,
  -- A data URI: 'data:image/webp;base64,...'. The browser squares and shrinks
  -- the picture before it is sent, so what arrives is already small.
  image       text not null,
  updated_at  timestamptz not null default now(),

  -- Roughly 200KB of base64, which is a generous 256-pixel crest and nowhere
  -- near a phone photograph. Without this a manager could put a ten-megabyte
  -- picture in a row everyone else has to read.
  constraint team_logos_image_size check (length(image) <= 300000),
  constraint team_logos_image_kind check (image like 'data:image/%')
);

create index if not exists team_logos_league_idx on team_logos (league_id);

alter table team_logos enable row level security;

-- Everyone in the league sees every crest: that is the point of having one.
drop policy if exists logos_read on team_logos;
create policy logos_read on team_logos
  for select using (league_id = (select league_id from current_manager()));

-- A manager sets their own, and only their own.
drop policy if exists logos_write on team_logos;
create policy logos_write on team_logos
  for all
  using (manager_id = (select id from current_manager()))
  with check (
    manager_id = (select id from current_manager())
    and league_id = (select league_id from current_manager())
  );

grant select, insert, update, delete on team_logos to authenticated;
