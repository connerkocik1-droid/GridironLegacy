-- Making live scoring actually live.
--
-- Until now the only thing that wrote player_scores was a scheduler: five
-- minutes on game days from GitHub Actions, once a day from vercel.json. That
-- is three things a league has to get right before a score moves — the
-- workflow's secrets set, the right days listed, GitHub not running late —
-- and it is still five minutes behind at its best. A Saturday game in
-- December is not on its list at all.
--
-- Now a page that shows a score also fetches one. The obvious objection to
-- that is the right one: there is no "the page". Every serverless instance is
-- its own process with its own memory, so an in-process cache bounds nothing,
-- and twelve managers refreshing during a Sunday slate would put an unbounded
-- number of requests through an undocumented API that owes us nothing. The
-- first thing that happens when you do that is you stop getting answers.
--
-- So the throttle lives here, where every instance can see it. Postgres is the
-- one thing they all share. The schedulers stay exactly as they are: they are
-- what keeps a league correct on a Tuesday when nobody has opened the site.

create table if not exists score_refresh (
  league_id    uuid not null references leagues(id) on delete cascade,
  week         int  not null,
  -- Deliberately in the past by default, so the very first look refreshes.
  refreshed_at timestamptz not null default 'epoch',
  primary key (league_id, week)
);

-- No policies, on purpose. Nothing but the ingestion has any business reading
-- or writing this, and the ingestion holds the service key, which is not
-- subject to RLS. A table with RLS enabled and no policy denies everyone else
-- by default, which is exactly the intent.
alter table score_refresh enable row level security;

-- ---------------------------------------------------------------------------
-- Claiming a refresh
-- ---------------------------------------------------------------------------

-- Returns true to exactly one caller per window, and false to everyone else.
--
-- The claim is the timestamp bump itself, in one statement, so two instances
-- arriving in the same millisecond cannot both win: the second one's ON
-- CONFLICT sees the row the first one already moved and its WHERE fails.
--
-- There is no separate "in progress" flag and no lock held across the ESPN
-- request, because a lock held across a network call to somebody else's server
-- is a lock you will one day have to break by hand. Claiming optimistically
-- means a refresh that dies mid-flight costs one window's delay — twenty-odd
-- seconds — and then the next caller tries again. That is the right trade for
-- a fantasy score.
create or replace function claim_score_refresh(
  p_league_id uuid,
  p_week int,
  p_stale_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  -- Never let a caller pass a window so small it becomes a way to hammer
  -- ESPN through us.
  if p_stale_seconds < 10 then
    p_stale_seconds := 10;
  end if;

  insert into score_refresh (league_id, week, refreshed_at)
  values (p_league_id, p_week, now())
  on conflict (league_id, week) do update
    set refreshed_at = now()
    where score_refresh.refreshed_at < now() - make_interval(secs => p_stale_seconds)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function claim_score_refresh(uuid, int, int) from public;

-- How long ago the week's scores were last pulled, so a page can say so and a
-- caller can decide whether it is worth asking.
create or replace function score_freshness(p_league_id uuid, p_week int)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select refreshed_at from score_refresh
   where league_id = p_league_id and week = p_week;
$$;

revoke all on function score_freshness(uuid, int) from public;

-- ---------------------------------------------------------------------------
-- Resetting
-- ---------------------------------------------------------------------------

-- A reset unmakes the scores, so it has to unmake the record of when they were
-- last fetched too — otherwise the new season's week one would sit behind a
-- throttle set by the old one's.
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
  delete from score_refresh    where league_id = p_league_id;
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

-- ---------------------------------------------------------------------------
-- Grading a week, and knowing which week
-- ---------------------------------------------------------------------------

-- The week a league is grading is week N of *its* season. The old test asked
-- whether every nfl_games row numbered N was complete, across every season and
-- every part of every season the mirror had ever seen.
--
-- That is one dynasty rollover away from being wrong in the worst direction:
-- last season's week 3 is complete for ever, so a league in its second season
-- could have week 3 declared over — records written, playoff seeding moved —
-- on the strength of games played a year earlier. It also lets a preseason
-- fixture, which no fantasy team plays, hold a week open.
--
-- Everything else about this function is unchanged.
create or replace function grade_week(p_league_id uuid, p_week int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m        matchups;
  v_complete boolean;
  v_graded   int := 0;
  v_home     numeric;
  v_away     numeric;
  v_season   int;
begin
  select season into v_season from leagues where id = p_league_id;
  if v_season is null then
    return jsonb_build_object('ok', false, 'error', 'no such league');
  end if;

  -- A week with no games mirrored yet cannot be closed.
  select count(*) > 0 and bool_and(completed)
    into v_complete
    from nfl_games
   where week = p_week
     and season = v_season
     and season_type = 2;

  for v_m in
    select * from matchups
     where league_id = p_league_id and week = p_week and not final
  loop
    v_home := lineup_points(p_league_id, v_m.home_manager, p_week);
    v_away := lineup_points(p_league_id, v_m.away_manager, p_week);

    update matchups
       set home_points = v_home,
           away_points = v_away,
           home_starters = (
             select coalesce(jsonb_agg(jsonb_build_object('name', player_name, 'slot', lineup_slot)), '[]'::jsonb)
               from roster_slots
              where manager_id = v_m.home_manager and lineup_slot not in ('BENCH', 'IR')
           ),
           away_starters = (
             select coalesce(jsonb_agg(jsonb_build_object('name', player_name, 'slot', lineup_slot)), '[]'::jsonb)
               from roster_slots
              where manager_id = v_m.away_manager and lineup_slot not in ('BENCH', 'IR')
           ),
           winner = case
             when not coalesce(v_complete, false) then null
             when v_home > v_away then v_m.home_manager
             when v_away > v_home then v_m.away_manager
             else null
           end,
           is_tie = coalesce(v_complete, false) and v_home = v_away,
           final = coalesce(v_complete, false),
           graded_at = now()
     where id = v_m.id;

    v_graded := v_graded + 1;
  end loop;

  return jsonb_build_object('ok', true, 'week', p_week, 'graded', v_graded, 'final', coalesce(v_complete, false));
end;
$$;

revoke all on function grade_week(uuid, int) from public;

-- Reading the mirror by season and week is now the hot path for both grading
-- and the home page's "is this week being played" question.
create index if not exists nfl_games_season_week_idx
  on nfl_games (season, season_type, week);
