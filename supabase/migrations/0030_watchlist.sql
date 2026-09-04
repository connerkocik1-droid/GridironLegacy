-- Players a manager is keeping an eye on.
--
-- Player news has always been the wire filtered to your own roster, which
-- answers half the question. The other half is the player you do not own yet
-- and are deciding about — the one whose hamstring you want to hear about
-- before you spend a waiver claim on him. A roster cannot express that.
--
-- Deliberately not a roster: no capacity, no positions, no effect on anything.
-- Watching a player is a note to yourself, and the only thing that reads it is
-- the news filter.
--
-- Keyed on the manager rather than the league because a manager belongs to one
-- league anyway, and it makes "is this mine" a primary-key lookup rather than
-- a policy that has to think about it.

create table if not exists watchlist (
  manager_id  uuid not null references managers(id) on delete cascade,
  player_name text not null,
  league_id   uuid not null references leagues(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (manager_id, player_name)
);

create index if not exists watchlist_league_idx on watchlist (league_id);

alter table watchlist enable row level security;

-- Yours alone, in every direction. Who else is watching a player is exactly
-- the sort of thing a league would rather not broadcast before a waiver run.
drop policy if exists watchlist_own on watchlist;
create policy watchlist_own on watchlist
  for all using (manager_id = (select id from current_manager()))
  with check (
    manager_id = (select id from current_manager())
    and league_id = (select league_id from current_manager())
  );

grant select, insert, delete on watchlist to authenticated;

-- A full league reset unmakes the season, and a watchlist is a note about
-- players in it. A season ROLLOVER deliberately does not clear it: in a
-- dynasty the player you were tracking in December is the player you are
-- drafting in August.
create or replace function purge_league_season(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from roster_slots     where league_id = p_league_id;
  delete from matchups         where league_id = p_league_id;
  delete from player_scores    where league_id = p_league_id;
  delete from transactions     where league_id = p_league_id;
  delete from waiver_claims    where league_id = p_league_id;
  delete from waiver_wire      where league_id = p_league_id;
  delete from trades           where league_id = p_league_id;
  delete from trade_block      where league_id = p_league_id;
  delete from draft_queue      where league_id = p_league_id;
  delete from pickem_picks     where league_id = p_league_id;
  delete from playoff_seeds    where league_id = p_league_id;
  delete from league_champions where league_id = p_league_id;
  delete from notices          where league_id = p_league_id;
  delete from watchlist        where league_id = p_league_id;
end;
$$;

revoke all on function purge_league_season(uuid) from public;
