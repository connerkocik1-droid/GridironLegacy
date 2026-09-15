-- Saying nothing is not the same as saying nobody.

-- best_ball_lineup fills the starting slots from settings -> 'starters'. It
-- reads that key with coalesce(..., '{}'), and every slot lookup against an
-- empty object comes back null, which coalesces to nought. A league whose
-- settings blob does not name a starting lineup therefore fields no
-- quarterback, no running back, no flex — nobody at all.
--
-- Nobody scores nought. So every manager's week is nought, every matchup
-- grades 0–0, points for is nought for the whole league, and the standings are
-- twelve teams that have apparently never scored a point. Nothing anywhere
-- says why: the league looks like a league, the rosters look like rosters, and
-- the numbers are all zero.
--
-- The app has never had this problem, which is why it went unseen. readSettings
-- in src/data/league-settings.js lays the saved blob over a set of defaults, so
-- every screen has always had a starting lineup to draw whether the row named
-- one or not. Only the database took silence literally, and the database is
-- where the scoring happens.
--
-- roster_capacity reads the same key the same way, with a quieter but equally
-- wrong result: a league that names no starters has a capacity of its bench
-- alone — eight instead of eighteen — so every roster is over its limit and
-- every signing is refused.
--
-- Fixed in one place. A league that names some starters has made a statement
-- and keeps it exactly; a league that names none gets the lineup the rest of
-- the app has always assumed it had. Per-key merging is deliberately not done:
-- a league that says it fields one quarterback has said what it fields, and
-- quietly adding six more slots to it would be a different bug.

/**
 * The starting lineup a league fields.
 *
 * The defaults are the app's own, from src/data/league-settings.js. If they
 * change there they must change here — which is the cost of the database
 * needing to know the same thing, and cheaper than the database knowing
 * nothing.
 */
create or replace function league_starters(p_settings jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_settings -> 'starters', '{}'::jsonb) = '{}'::jsonb
      then '{"QB": 1, "RB": 2, "WR": 2, "TE": 1, "FLEX": 2, "D/ST": 1, "K": 1}'::jsonb
    else p_settings -> 'starters'
  end;
$$;

grant execute on function league_starters(jsonb) to authenticated;

/** Re-emitted from 0036. The only change is where the starters come from. */
create or replace function best_ball_lineup(
  p_league_id  uuid,
  p_manager_id uuid,
  p_week       int
)
returns table (player_name text, slot text, points numeric)
language plpgsql
stable
set search_path = public
as $$
declare
  v_starters jsonb;
begin
  select league_starters(settings)
    into v_starters
    from leagues
   where id = p_league_id;

  -- A league id that names no league at all. Better an empty lineup than the
  -- default one: there is no league here to have a lineup.
  if v_starters is null then
    return;
  end if;

  return query
  with held as (
    select r.player_name    as name,
           coalesce(r.position, '') as pos,
           coalesce(s.points, 0)    as pts
      from roster_slots r
      left join player_scores s
        on s.league_id = r.league_id
       and s.player_name = r.player_name
       and s.week = p_week
     where r.league_id = p_league_id
       and r.manager_id = p_manager_id
       -- Injured reserve is the one thing lineup_slot still says. A player
       -- stashed there does not count against the roster, so he must not be
       -- able to score for it either.
       and coalesce(r.lineup_slot, '') <> 'IR'
  ),
  ranked as (
    select h.*,
           row_number() over (partition by h.pos order by h.pts desc, h.name) as rank_at
      from held h
  ),
  dedicated as (
    select r.name, r.pos as in_slot, r.pts
      from ranked r
     where r.pos <> ''
       and r.rank_at <= coalesce((v_starters ->> r.pos)::int, 0)
  ),
  spare as (
    select r.name, r.pts
      from ranked r
     where r.pos in ('RB', 'WR', 'TE')
       and not exists (select 1 from dedicated d where d.name = r.name)
     order by r.pts desc, r.name
     limit coalesce((v_starters ->> 'FLEX')::int, 0)
  )
  select d.name, d.in_slot, d.pts from dedicated d
  union all
  select s.name, 'FLEX', s.pts from spare s;
end;
$$;

grant execute on function best_ball_lineup(uuid, uuid, int) to authenticated;

/** Re-emitted from 0007. Same change: silence means the default, not nothing. */
create or replace function roster_capacity(p_settings jsonb)
returns int
language sql
immutable
set search_path = public
as $$
  select coalesce(
           (select sum(value::int)::int
              from jsonb_each_text(league_starters(p_settings))),
           0
         )
       + coalesce((p_settings ->> 'bench')::int, 8);
$$;

/**
 * And the leagues this has already happened to.
 *
 * A week graded while the lineup was empty kept the nought it was graded with,
 * because a graded matchup is never recomputed — that rule is what stops a
 * trade in November rewriting a result in September, and it is right. But a
 * week that graded 0–0 for both sides did not record a result; it recorded the
 * absence of one. Those are re-graded, and only those: a week where anybody
 * scored anything is left exactly as it stands.
 */
do $__fix__$
declare
  v_row record;
begin
  for v_row in
    select distinct m.league_id, m.week
      from matchups m
     where m.final
       and coalesce(m.home_points, 0) = 0
       and coalesce(m.away_points, 0) = 0
       -- Only where there was something to score. A week nobody played is
       -- correctly nought and re-grading it would say the same thing.
       and exists (
         select 1 from player_scores s
          where s.league_id = m.league_id and s.week = m.week and s.points <> 0
       )
  loop
    update matchups
       set final = false, winner = null, is_tie = false
     where league_id = v_row.league_id and week = v_row.week;

    perform grade_week(v_row.league_id, v_row.week);

    raise notice 'regraded week % of league %', v_row.week, v_row.league_id;
  end loop;
end
$__fix__$;
