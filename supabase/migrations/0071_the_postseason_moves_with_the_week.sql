-- The postseason moves when the week does.
--
-- advance_playoffs (0026) seeds the bracket when the regular season ends,
-- draws each round when the last one is done, and crowns the champion when one
-- team is left. Only the nightly scores job called it. That was enough when a
-- week closed itself, but since 0058 the commissioner closes the week with the
-- advance button, and a bracket that turned up hours after the last regular
-- week was locked, or a semi-final that sat undrawn until the next morning,
-- left every screen in between saying the season had simply run out.
--
-- So advance_week moves the postseason on in the same breath as it locks the
-- week: locking week 14 seeds the field and draws round one, locking a
-- playoff round draws the next, and locking the final names the champion.
-- The nightly job still calls it too, and both are safe to call any number of
-- times.
--
-- And a season with nothing left to close says why: the champion, if there is
-- one, rather than a bare "every week has been settled".

/** advance_week, as 0068 wrote it, and then the postseason. */
create or replace function advance_week(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        managers;
  v_week      int;
  v_scored    int;
  v_m         matchups;
  v_home      numeric;
  v_away      numeric;
  v_locked    int := 0;
  v_post      jsonb;
  v_champion  text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can advance the week' using errcode = '42501';
  end if;

  select min(week) into v_week
    from matchups
   where league_id = p_league_id and not final;

  if v_week is null then
    -- Nothing open. A regular season that ended without the bracket being
    -- drawn (the last week closed itself overnight, say) is owed one now.
    v_post := advance_playoffs(p_league_id);
    select min(week) into v_week
      from matchups where league_id = p_league_id and not final;

    if v_week is not null then
      return jsonb_build_object('ok', true, 'locked', null, 'week', v_week, 'postseason', v_post);
    end if;

    select c.franchise into v_champion
      from league_champions c join leagues l on l.id = c.league_id and l.season = c.season
     where c.league_id = p_league_id;

    return jsonb_build_object(
      'ok', false,
      'error', case when v_champion is not null
                    then format('The season is over — %s are the champions.', v_champion)
                    else 'Every week has been settled.' end);
  end if;

  select count(*) into v_scored
    from player_scores
   where league_id = p_league_id and week = v_week;

  if v_scored = 0 then
    return jsonb_build_object(
      'ok', false,
      'week', v_week,
      'error', format('Nobody has been scored in week %s yet.', v_week));
  end if;

  for v_m in
    select * from matchups
     where league_id = p_league_id and week = v_week and not final
  loop
    v_home := lineup_points(p_league_id, v_m.home_manager, v_week);
    v_away := lineup_points(p_league_id, v_m.away_manager, v_week);

    update matchups
       set home_points    = v_home,
           away_points    = v_away,
           home_starters  = best_ball_starters(p_league_id, v_m.home_manager, v_week),
           away_starters  = best_ball_starters(p_league_id, v_m.away_manager, v_week),
           winner = case
             when v_home > v_away then v_m.home_manager
             when v_away > v_home then v_m.away_manager
             -- A level playoff game still sends somebody through: the better
             -- seed, the rule playoff_survivors already plays by. Written down
             -- so the bracket can say who went through. (postseason_seed is
             -- 0072's, which also knows the consolation's seeds.)
             when v_m.playoff then (
               select case
                 when postseason_seed(p_league_id, l.season, v_m.home_manager)
                      <= postseason_seed(p_league_id, l.season, v_m.away_manager)
                   then v_m.home_manager else v_m.away_manager end
                 from leagues l where l.id = p_league_id)
             else null
           end,
           is_tie   = v_home = v_away,
           final    = true,
           graded_at = now()
     where id = v_m.id;

    v_locked := v_locked + 1;
  end loop;

  -- The claim window has just opened; its order is this week, worst first.
  perform seed_waiver_priority(p_league_id, v_week);

  -- And the postseason: seeded after the last regular week, the next round
  -- drawn after each one, the champion named after the final.
  v_post := advance_playoffs(p_league_id);

  return jsonb_build_object(
    'ok', true,
    'locked', v_week,
    'week', (select min(week) from matchups
              where league_id = p_league_id and not final),
    'games', v_locked,
    'postseason', v_post);
end;
$$;

revoke all on function advance_week(uuid) from public;
grant execute on function advance_week(uuid) to authenticated;
