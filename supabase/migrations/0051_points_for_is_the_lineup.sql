-- Points for is what a lineup scored, not what a roster did.

-- The standings table has always had this right: it sums the graded matchups,
-- and a graded matchup holds what the best-ball lineup actually scored. Two
-- other places added it up for themselves and both counted the whole roster —
-- every player a manager holds, bench included — which on an eighteen-man
-- roster in a league that fields eleven is roughly a third too much, and worse
-- than merely wrong: it rewards hoarding. A manager who never starts a player
-- all season still banks his points, and the ordering before any week is
-- graded is a ranking of who has the deepest bench.
--
-- So it is answered once, here, where best_ball_lineup already decides who
-- started.

/**
 * Every manager's season, as their lineups actually scored it.
 *
 * Two halves, because a season has two kinds of week in it. A graded week is
 * settled: the matchup holds the number that decided it, and recomputing it
 * against today's roster would quietly rewrite history every time somebody
 * made a trade. A week still being played has no matchup number yet, so it is
 * worked out from the scores as they stand — which is what makes a table move
 * on a Sunday afternoon rather than only on the Tuesday.
 *
 * A manager with nothing scored is still a row, at nought. Missing from the
 * answer would mean missing from the table.
 */
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
     where m.league_id = p_league_id and m.final
    union all
    select m.away_manager, m.away_points, m.week
      from matchups m
     where m.league_id = p_league_id and m.final
  ),
  -- Any week this league has scored anybody in and has not yet graded.
  open_weeks as (
    select distinct s.week
      from player_scores s
     where s.league_id = p_league_id
       and not exists (
         select 1 from matchups m
          where m.league_id = p_league_id and m.week = s.week and m.final
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
