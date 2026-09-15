-- A title is not three more wins.

-- Playoff games are written into the same table as the regular season, with a
-- flag saying which they are. regular_season_weeks() reads the flag. standings()
-- was written before the postseason existed and never learned to — so from the
-- day the bracket was drawn, a champion's record on the League page picked up
-- a win for every round they won and their points for picked up every point
-- they scored winning it.
--
-- It is worse than a wrong number on a page. set_draft_pick_order reads the
-- same table, and it orders the draft by reverse standings: the team that won
-- the title came out with more wins than it had, and so drafted later than it
-- should — or, having lost in the first round, earlier. Every pick in the
-- rookie draft was off by however far the bracket moved people.
--
-- season_points_for, written last week, inherited the same hole from the same
-- table on its first day.

create or replace function standings(p_league_id uuid)
returns table (
  manager_id uuid,
  slot text,
  franchise text,
  division text,
  wins int,
  losses int,
  ties int,
  div_wins int,
  div_losses int,
  points_for numeric,
  points_against numeric
)
language sql
stable
set search_path = public
as $$
  with sides as (
    select home_manager as manager_id, home_points as pf, away_points as pa,
           winner, is_tie, final, divisional
      from matchups where league_id = p_league_id and not playoff
    union all
    select away_manager, away_points, home_points, winner, is_tie, final, divisional
      from matchups where league_id = p_league_id and not playoff
  )
  select m.id,
         m.slot,
         m.franchise,
         m.division,
         count(*) filter (where s.final and s.winner = m.id)::int,
         count(*) filter (where s.final and s.winner is not null and s.winner <> m.id)::int,
         count(*) filter (where s.final and s.is_tie)::int,
         count(*) filter (where s.final and s.divisional and s.winner = m.id)::int,
         count(*) filter (where s.final and s.divisional and s.winner is not null and s.winner <> m.id)::int,
         coalesce(sum(s.pf) filter (where s.final), 0),
         coalesce(sum(s.pa) filter (where s.final), 0)
    from managers m
    left join sides s on s.manager_id = m.id
   where m.league_id = p_league_id
   group by m.id, m.slot, m.franchise, m.division
   order by m.division, 5 desc, 10 desc;
$$;

/** The same correction, in the function that adds the season up. */
create or replace function season_points_for(p_league_id uuid)
returns table (manager_id uuid, points_for numeric, weeks int)
language sql
stable
security definer
set search_path = public
as $$
  with settled as (
    select m.home_manager as manager_id, m.home_points as points, m.week
      from matchups m
     where m.league_id = p_league_id and m.final and not m.playoff
    union all
    select m.away_manager, m.away_points, m.week
      from matchups m
     where m.league_id = p_league_id and m.final and not m.playoff
  ),
  -- Any week this league has scored anybody in and has not yet graded. A week
  -- whose only fixture is a playoff tie is not a week of the season.
  open_weeks as (
    select distinct s.week
      from player_scores s
     where s.league_id = p_league_id
       and not exists (
         select 1 from matchups m
          where m.league_id = p_league_id and m.week = s.week and m.final and not m.playoff
       )
       and not exists (
         select 1 from matchups m
          where m.league_id = p_league_id and m.week = s.week and m.playoff
       )
  ),
  live as (
    select mg.id as manager_id,
           lineup_points(p_league_id, mg.id, w.week) as points,
           w.week
      from managers mg
      cross join open_weeks w
     where mg.league_id = p_league_id
  ),
  everything as (
    select * from settled
    union all
    select * from live
  )
  select mg.id,
         round(coalesce(sum(e.points), 0), 1),
         count(distinct e.week) filter (where e.points is not null)::int
    from managers mg
    left join everything e on e.manager_id = mg.id
   where mg.league_id = p_league_id
   group by mg.id;
$$;

grant execute on function season_points_for(uuid) to authenticated;
