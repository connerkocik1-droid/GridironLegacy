-- Why is my league showing noughts?
--
-- Paste this into the Supabase SQL editor and run it. It reads and reports;
-- it changes nothing.
--
-- Every row it prints is a yes/no question about one of the things that can
-- make a whole league score nothing. The first one that says "no" is the
-- answer.


select
  l.name                                                as league,
  l.season,

  -- Does the settings blob name a starting lineup? A league that says nothing
  -- here fielded nobody before migration 0057, which zeroes every score, every
  -- matchup and every points-for in the league. After 0057 it takes the app's
  -- default lineup instead.
  coalesce(l.settings -> 'starters', '{}'::jsonb) <> '{}'::jsonb
                                                        as names_a_lineup,
  (select sum(value::int)::int
     from jsonb_each_text(league_starters(l.settings))) as slots_fielded,

  -- Do the players on the rosters have positions? A player with no position is
  -- in no slot, his own or the flex, and scores nothing for anybody.
  (select count(*)::int from roster_slots r
    where r.league_id = l.id
      and coalesce(r.position, '') = '')                as players_with_no_position,
  (select count(*)::int from roster_slots r
    where r.league_id = l.id)                           as players_on_rosters,

  -- Has anybody actually been scored? No scores is not a bug, it is a league
  -- that has not played.
  (select count(*)::int from player_scores s
    where s.league_id = l.id and s.points <> 0)         as scoring_rows,
  (select max(s.week) from player_scores s
    where s.league_id = l.id)                           as last_week_scored,

  -- Weeks that graded 0-0 for both sides while there was real scoring behind
  -- them. These recorded the absence of a result rather than a result;
  -- migration 0057 re-grades exactly these.
  (select count(*)::int from matchups m
    where m.league_id = l.id and m.final
      and coalesce(m.home_points, 0) = 0
      and coalesce(m.away_points, 0) = 0
      and exists (select 1 from player_scores s
                   where s.league_id = m.league_id and s.week = m.week
                     and s.points <> 0))                as weeks_graded_empty,

  -- What the league adds up to right now, both ways of asking.
  (select round(sum(points_for), 1) from season_points_for(l.id))
                                                        as points_for_all_in,
  (select round(sum(points_for), 1) from standings(l.id))
                                                        as standings_points_for

from leagues l
order by l.name;


select m.franchise,
       coalesce((select max(week) from player_scores where league_id = m.league_id), 0) as week,
       lineup_points(m.league_id, m.id,
         coalesce((select max(week) from player_scores where league_id = m.league_id), 0)) as scored,
       (select count(*)::int from best_ball_lineup(m.league_id, m.id,
          coalesce((select max(week) from player_scores where league_id = m.league_id), 0)))
         as men_fielded
  from managers m
 order by m.league_id, m.slot;
