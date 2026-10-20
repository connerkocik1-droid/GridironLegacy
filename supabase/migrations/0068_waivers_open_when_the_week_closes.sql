-- The claim window opens when the week closes, not on a Tuesday.
--
-- 0061 made Tuesday the claim day: all day, on the league's clock, every
-- free agent was claim-only and the claims settled together at midnight. But
-- this league's weeks do not end on a calendar — the commissioner closes one
-- with the advance button (0058), and that is the moment the wire matters. A
-- week closed on a Wednesday had no claim day until the following Tuesday, and
-- one closed late on a Monday had its Tuesday cut short.
--
-- So the window now follows the week: from the moment a week is locked, for
-- 24 hours, every free agent is on waivers — adds are refused, claims are
-- collected, and they settle together when the window closes. The order is the
-- week just played, lowest score first, and it is set the moment the week is
-- advanced rather than on the next waiver run, so the priority a manager sees
-- while placing a claim is the one it will be judged by.
--
-- `waiverDay: -1` still turns the window off entirely; `claimWindowHours`
-- (default 24) is how long it stays open.

/** When the league last closed a week: the newest graded fixture. */
create or replace function week_closed_at(p_league_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(graded_at) from matchups where league_id = p_league_id and final;
$$;

/** How long the claim window stays open after a week closes. */
create or replace function claim_window_hours(p_league_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, coalesce((settings ->> 'claimWindowHours')::int, 24))
    from leagues where id = p_league_id;
$$;

/**
 * Is the claim window open right now: within claim_window_hours of the last
 * week being closed. Same name and shape as 0061's, so everything that asks
 * — the add route, the players board, the claim trigger — follows without
 * being changed.
 */
create or replace function waiver_day(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when waiver_dow(p_league_id) < 0 then false
    else coalesce(
      now() >= week_closed_at(p_league_id)
        and now() < week_closed_at(p_league_id) + make_interval(hours => claim_window_hours(p_league_id)),
      false)
  end;
$$;

/**
 * When the open window's claims are judged: the moment it closes. Null when
 * no window is open. stamp_claim_window (0061) puts this on every claim.
 */
create or replace function waiver_window_close(p_league_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case when waiver_day(p_league_id) then
    week_closed_at(p_league_id) + make_interval(hours => claim_window_hours(p_league_id))
  end;
$$;

grant execute on function week_closed_at(uuid) to authenticated;
grant execute on function claim_window_hours(uuid) to authenticated;
grant execute on function waiver_day(uuid) to authenticated;
grant execute on function waiver_window_close(uuid) to authenticated;

/**
 * advance_week, as 0058 wrote it, and then the waiver order: the week just
 * locked, lowest score first. seed_waiver_priority records the week it seeded
 * from, so the next waiver run does not seed it again over the top of any
 * claims it has already settled.
 */
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

  -- The claim window has just opened; its order is this week, worst first.
  perform seed_waiver_priority(p_league_id, v_week);

  return jsonb_build_object(
    'ok', true,
    'locked', v_week,
    'week', (select min(week) from matchups
              where league_id = p_league_id and not final),
    'games', v_locked);
end;
$$;

revoke all on function advance_week(uuid) from public;
grant execute on function advance_week(uuid) to authenticated;
