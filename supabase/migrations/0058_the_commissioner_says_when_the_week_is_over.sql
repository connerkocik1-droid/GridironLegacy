-- The week ends when the league says it does.

-- Until now a week closed itself: grade_week refuses to mark anything final
-- until every NFL game that week is complete, which is right when the fixture
-- mirror is up to date and useless when it is not. A league whose games never
-- arrived, or arrived incomplete, sat on week one forever — the scores were
-- there, the matchups were scored, and nothing would settle them, so the
-- standings stayed empty and every screen in the app kept saying week one.
--
-- So the commissioner gets a switch. It locks the current week with whatever
-- the lineups actually scored, decides the results, and the league moves on —
-- because the week the app is on is derived from the fixtures rather than
-- stored, every screen follows without being told.
--
-- It refuses on a week nobody has been scored in. Locking one of those would
-- write a tie into every fixture in the league and call it a result, and a
-- recorded result is the one thing this app will not recompute.

create or replace function advance_week(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      managers;
  v_week    int;
  v_scored  int;
  v_m       matchups;
  v_home    numeric;
  v_away    numeric;
  v_locked  int := 0;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can advance the week' using errcode = '42501';
  end if;

  -- The week the league is on: the first fixture still to be settled. The same
  -- rule currentWeek() uses in the app, so the button closes the week every
  -- screen is showing rather than one of its own choosing.
  select min(week) into v_week
    from matchups
   where league_id = p_league_id and not final;

  if v_week is null then
    return jsonb_build_object('ok', false, 'error', 'Every week has been settled.');
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
           -- The same photograph grade_week takes, and for the same reason:
           -- once the week is closed the arrangement is never recomputed, so a
           -- trade in November cannot change who won in September.
           home_starters  = best_ball_starters(p_league_id, v_m.home_manager, v_week),
           away_starters  = best_ball_starters(p_league_id, v_m.away_manager, v_week),
           winner = case
             when v_home > v_away then v_m.home_manager
             when v_away > v_home then v_m.away_manager
             else null
           end,
           is_tie   = v_home = v_away,
           final    = true,
           graded_at = now()
     where id = v_m.id;

    v_locked := v_locked + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'locked', v_week,
    -- What the league is on now. Null once the last week has been settled,
    -- which is a season that is over rather than a week nobody can find.
    'week', (select min(week) from matchups
              where league_id = p_league_id and not final),
    'games', v_locked);
end;
$$;

revoke all on function advance_week(uuid) from public;
grant execute on function advance_week(uuid) to authenticated;
