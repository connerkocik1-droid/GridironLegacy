-- Team and school crests for the Pylon Report, the same way a franchise got
-- one in 0015: a small image inline as a data URI, not an object-storage
-- bucket — a few dozen crests do not need one, and this keeps the report
-- working the moment the migration runs rather than after a bucket is also
-- configured.
--
-- Keyed by (league_id, scope, abbr) rather than by team name, because a logo
-- is addressed the same way the report's own rows are: CFB and Pylon 50
-- share the 'cfb' scope, so uploading Georgia's crest once lights it up on
-- both boards, the way the design calls for. NFL is its own scope — thirty-
-- two clubs that never move between boards.
--
-- Write access is the commissioner's alone. A franchise crest is a manager's
-- own face and 0015 lets him set it; a team or school crest belongs to the
-- report, which is the commissioner's the same way the rankings are.

create table if not exists report_logos (
  league_id   uuid not null references leagues(id) on delete cascade,
  scope       text not null check (scope in ('cfb', 'nfl')),
  abbr        text not null,
  -- A data URI: 'data:image/webp;base64,...'. The browser squares and
  -- shrinks the picture before it is sent, so what arrives is already small.
  image       text not null,
  updated_at  timestamptz not null default now(),

  primary key (league_id, scope, abbr),
  constraint report_logos_image_size check (length(image) <= 300000),
  constraint report_logos_image_kind check (image like 'data:image/%')
);

alter table report_logos enable row level security;

-- Everyone in the league reads every crest. The public Pylon Report page
-- reads through the service client instead, the same way it reads the
-- rankings themselves, so a signed-out visitor sees them too.
drop policy if exists report_logos_read on report_logos;
create policy report_logos_read on report_logos
  for select using (league_id = (select league_id from current_manager()));

drop policy if exists report_logos_write on report_logos;
create policy report_logos_write on report_logos
  for all
  using (is_commissioner() and league_id = (select league_id from current_manager()))
  with check (is_commissioner() and league_id = (select league_id from current_manager()));

grant select, insert, update, delete on report_logos to authenticated;
