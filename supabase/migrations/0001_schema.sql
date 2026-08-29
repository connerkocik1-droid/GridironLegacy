-- Gridiron Legacy — shared league state.
--
-- Everything here replaces what the prototype kept in localStorage, where each
-- manager got a private copy of the league. One row per league, and every other
-- table hangs off it.

create extension if not exists pgcrypto;

create table leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season int not null default 2026,
  commissioner_slot text,
  settings jsonb not null default '{}'::jsonb,
  lottery_order text[],
  draft_at timestamptz,
  -- The server's clock for the draft. Every client counts down from this
  -- rather than its own, so twelve clocks cannot drift apart.
  pick_started_at timestamptz,
  created_at timestamptz not null default now()
);

-- One row per manager. slot is the franchise code: STL, BLZ, HELX…
create table managers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  slot text not null,
  name text not null,
  franchise text not null,
  -- null means the manager must set a PIN on next sign-in. The commissioner
  -- clears this; they never set one, so they cannot sign in as another team.
  pin_hash text,
  is_commissioner boolean not null default false,
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  unique (league_id, slot)
);

create table roster_slots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  player_name text not null,
  acquired text not null default 'draft' check (acquired in ('draft','trade','waiver')),
  overall_pick int,
  lineup_slot text not null default 'BENCH',
  -- A player belongs to exactly one roster in a league. This is what makes two
  -- managers clicking the same player in the same second resolve cleanly.
  unique (league_id, player_name)
);

create index roster_slots_manager_idx on roster_slots (manager_id);

create table draft_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  overall int not null,
  round int not null,
  manager_id uuid references managers(id) on delete set null,
  player_name text,
  picked_at timestamptz,
  unique (league_id, overall)
);

create table trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  from_manager uuid not null references managers(id) on delete cascade,
  to_manager uuid not null references managers(id) on delete cascade,
  offer jsonb not null,
  status text not null default 'open'
    check (status in ('open','countered','agreed','executed','declined')),
  from_accepted boolean not null default false,
  to_accepted boolean not null default false,
  thread jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

create table trade_block (
  league_id uuid not null references leagues(id) on delete cascade,
  player_name text not null,
  manager_id uuid not null references managers(id) on delete cascade,
  listed_at timestamptz not null default now(),
  primary key (league_id, player_name)
);

-- Live fantasy scoring, written by the ESPN ingestion job.
create table player_scores (
  league_id uuid not null references leagues(id) on delete cascade,
  week int not null,
  player_name text not null,
  points numeric not null default 0,
  stat_line text,
  updated_at timestamptz not null default now(),
  primary key (league_id, week, player_name)
);

-- ---------------------------------------------------------------------------
-- Weekly pick-'em
-- ---------------------------------------------------------------------------

-- The NFL schedule for a week, mirrored from ESPN's scoreboard so picks have a
-- stable set of games to reference and grading does not depend on ESPN being
-- reachable at that moment.
create table nfl_games (
  id text primary key,                       -- ESPN event id
  season int not null,
  week int not null,
  season_type int not null default 2,
  starts_at timestamptz not null,
  home_team text not null,
  away_team text not null,
  home_score int not null default 0,
  away_score int not null default 0,
  state text not null default 'pre' check (state in ('pre','in','post')),
  -- Null until the game is final; a tie stays null with completed = true.
  winner text,
  completed boolean not null default false,
  updated_at timestamptz not null default now()
);

create index nfl_games_week_idx on nfl_games (season, week);

create table pickem_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  game_id text not null references nfl_games(id) on delete cascade,
  -- The team abbreviation the manager took.
  pick text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One pick per manager per game; changing a pick updates this row.
  unique (manager_id, game_id)
);

create index pickem_picks_league_idx on pickem_picks (league_id, game_id);

-- Snapshots taken before a destructive commissioner action.
create table roster_backups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table admin_log (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  actor uuid references managers(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Without this, any manager can edit any roster from the browser console.
-- Reads are league-wide; writes are limited to the manager's own rows, and
-- destructive changes to the commissioner.
-- ---------------------------------------------------------------------------

alter table leagues        enable row level security;
alter table managers       enable row level security;
alter table roster_slots   enable row level security;
alter table draft_picks    enable row level security;
alter table trades         enable row level security;
alter table trade_block    enable row level security;
alter table player_scores  enable row level security;
alter table nfl_games      enable row level security;
alter table pickem_picks   enable row level security;
alter table roster_backups enable row level security;
alter table admin_log      enable row level security;

-- The signed-in manager's own row, used by every policy below.
create or replace function current_manager()
returns managers
language sql
stable
security definer
set search_path = public
as $$
  select * from managers where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_league()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select league_id from managers where auth_user_id = auth.uid() limit 1;
$$;

create or replace function is_commissioner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_commissioner from managers where auth_user_id = auth.uid() limit 1), false);
$$;

-- Read: anyone signed in sees their own league.
create policy leagues_read on leagues
  for select using (id = current_league());

create policy managers_read on managers
  for select using (league_id = current_league());

create policy roster_read on roster_slots
  for select using (league_id = current_league());

create policy picks_read on draft_picks
  for select using (league_id = current_league());

create policy trades_read on trades
  for select using (league_id = current_league());

create policy block_read on trade_block
  for select using (league_id = current_league());

create policy scores_read on player_scores
  for select using (league_id = current_league());

create policy pickem_read on pickem_picks
  for select using (league_id = current_league());

-- The NFL schedule is not league-specific and is safe for any signed-in user.
create policy games_read on nfl_games
  for select using (auth.uid() is not null);

-- Write: a manager owns their own roster, block entries, trades and picks.
create policy roster_write on roster_slots
  for update using (manager_id = (select id from current_manager()));

create policy block_write on trade_block
  for all using (manager_id = (select id from current_manager()))
  with check (manager_id = (select id from current_manager()));

create policy trades_write on trades
  for insert with check (from_manager = (select id from current_manager()));

create policy trades_respond on trades
  for update using (
    from_manager = (select id from current_manager())
    or to_manager = (select id from current_manager())
  );

-- A manager may only ever write their own pick, and only before kickoff.
create policy pickem_write on pickem_picks
  for all using (manager_id = (select id from current_manager()))
  with check (
    manager_id = (select id from current_manager())
    and league_id = current_league()
    and exists (
      select 1 from nfl_games g
      where g.id = game_id and g.starts_at > now()
    )
  );

-- A manager may set their own ready flag and franchise name, nothing else.
create policy managers_self_update on managers
  for update using (auth_user_id = auth.uid());

-- Commissioner-only surfaces.
create policy leagues_admin on leagues
  for update using (id = current_league() and is_commissioner());

create policy roster_admin on roster_slots
  for all using (league_id = current_league() and is_commissioner())
  with check (league_id = current_league() and is_commissioner());

create policy managers_admin on managers
  for update using (league_id = current_league() and is_commissioner());

create policy backups_admin on roster_backups
  for all using (league_id = current_league() and is_commissioner())
  with check (league_id = current_league() and is_commissioner());

create policy admin_log_read on admin_log
  for select using (league_id = current_league() and is_commissioner());

-- player_scores and nfl_games are written only by the ingestion job, which
-- uses the service key and bypasses RLS. No write policy is granted, so no
-- browser session can forge a score.
