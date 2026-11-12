-- Nobody sits out the divisional rematches.
--
-- generate_schedule (0009) plays everyone once, then plays each division's
-- own round robin again. A division of five can't pair off: its round robin
-- leaves one franchise idle every round. With two divisions of five, that
-- was two franchises on a bye in every rematch week — weeks 10 to 14 of a
-- ten-team season had four games, not five.
--
-- The two left over are in different divisions and both free, so they play
-- each other. pair_idle_franchises does that for any week that is not yet
-- played: whoever has no game that week is paired off in slot order, and in
-- a league with an odd number of franchises the last one still gets the bye
-- that cannot be avoided. generate_schedule runs it over the weeks it has
-- just made, and this migration runs it once over every league's unplayed
-- regular-season weeks, so this season's schedule is mended without being
-- redrawn.

/**
 * Pairs off every franchise without a game in each unplayed regular-season
 * week from p_from to p_to. A week with a final game is left alone, and so is
 * the postseason and a week with no games at all. Returns how many games it
 * added.
 */
create or replace function pair_idle_franchises(p_league_id uuid, p_from int, p_to int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week  int;
  v_idle  uuid[];
  v_i     int;
  v_home  uuid;
  v_away  uuid;
  v_made  int := 0;
begin
  for v_week in p_from..p_to loop
    -- Only a week that is on the schedule: this mends one, it never draws one.
    continue when not exists (
      select 1 from matchups where league_id = p_league_id and week = v_week);
    continue when exists (
      select 1 from matchups
       where league_id = p_league_id and week = v_week and (final or playoff));

    select array_agg(m.id order by m.slot) into v_idle
      from managers m
     where m.league_id = p_league_id
       and not exists (
         select 1 from matchups x
          where x.league_id = p_league_id and x.week = v_week
            and m.id in (x.home_manager, x.away_manager));

    v_i := 1;
    while v_i + 1 <= coalesce(array_length(v_idle, 1), 0) loop
      -- Alternate who is at home, so a pair added in consecutive weeks
      -- doesn't always send the same franchise on the road.
      if v_week % 2 = 0 then
        v_home := v_idle[v_i]; v_away := v_idle[v_i + 1];
      else
        v_home := v_idle[v_i + 1]; v_away := v_idle[v_i];
      end if;

      insert into matchups (league_id, week, home_manager, away_manager, divisional)
      values (
        p_league_id, v_week, v_home, v_away,
        (select division from managers where id = v_home)
          is not distinct from
        (select division from managers where id = v_away)
      );
      v_made := v_made + 1;
      v_i := v_i + 2;
    end loop;
  end loop;

  return v_made;
end;
$$;

revoke all on function pair_idle_franchises(uuid, int, int) from public;

/** generate_schedule, as 0009 wrote it, and then the idle paired off. */
create or replace function generate_schedule(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league    leagues;
  v_all       uuid[];
  v_divs      text[];
  v_div       text;
  v_ids       uuid[];
  v_n         int;
  v_phase1    int := 0;
  v_phase2    int := 0;
  v_rows      record;
  v_made      int := 0;
  v_byes      int := 0;
  v_divisional int := 0;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  if exists (select 1 from matchups where league_id = p_league_id and final) then
    raise exception 'Weeks have already been played — the schedule is fixed now'
      using errcode = '55000';
  end if;

  select array_agg(id order by slot) into v_all
    from managers where league_id = p_league_id;

  v_n := coalesce(array_length(v_all, 1), 0);
  if v_n < 2 then
    raise exception 'A schedule needs at least two franchises' using errcode = '55000';
  end if;

  delete from matchups where league_id = p_league_id and not final;

  -- Phase one: everyone plays everyone once.
  for v_rows in select * from round_robin(v_all) loop
    insert into matchups (league_id, week, home_manager, away_manager, divisional)
    values (
      p_league_id, v_rows.rnd, v_rows.home, v_rows.away,
      (select m1.division from managers m1 where m1.id = v_rows.home)
        is not distinct from
      (select m2.division from managers m2 where m2.id = v_rows.away)
    );
    v_made := v_made + 1;
    v_phase1 := greatest(v_phase1, v_rows.rnd);
  end loop;

  -- A padded round robin has as many rounds as the padded size minus one, so
  -- an odd league still spans that many weeks even where a row is a bye.
  v_phase1 := case when v_n % 2 = 1 then v_n else v_n - 1 end;

  -- Phase two: the divisional rematches. Both divisions run at the same time,
  -- because they share no franchises.
  select array_agg(distinct division order by division) into v_divs
    from managers where league_id = p_league_id and division is not null;

  if v_divs is not null then
    foreach v_div in array v_divs loop
      select array_agg(id order by slot) into v_ids
        from managers where league_id = p_league_id and division = v_div;

      for v_rows in select * from round_robin(v_ids) loop
        insert into matchups (league_id, week, home_manager, away_manager, divisional)
        values (p_league_id, v_phase1 + v_rows.rnd, v_rows.home, v_rows.away, true);
        v_made := v_made + 1;
        v_phase2 := greatest(v_phase2, v_rows.rnd);
      end loop;
    end loop;

    -- An odd division leaves somebody idle in every rematch week; the idle
    -- from each division play one another instead of both sitting out.
    v_made := v_made + pair_idle_franchises(p_league_id, v_phase1 + 1, v_phase1 + v_phase2);
  end if;

  select count(*) into v_divisional
    from matchups where league_id = p_league_id and divisional;

  -- Somebody sits out any week where the pairing fell against the padding.
  select (v_phase1 + v_phase2) * (v_n / 2) - v_made into v_byes;

  -- The schedule decides the season length, so the setting follows it rather
  -- than silently disagreeing with the fixtures that exist.
  update leagues
     set settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{regularWeeks}',
           to_jsonb(v_phase1 + v_phase2)
         )
   where id = p_league_id;

  return jsonb_build_object(
    'ok', true,
    'weeks', v_phase1 + v_phase2,
    'matchups', v_made,
    'divisional', v_divisional,
    'byes', greatest(v_byes, 0)
  );
end;
$$;

revoke all on function generate_schedule(uuid) from public;

/**
 * repair_schedule, as 0012 wrote it, counting the extra game a franchise in an
 * odd division now gets in the rematch weeks. It looks for franchises short of
 * their games; one with that extra game is not damage.
 */
create or replace function repair_schedule(p_league_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n  int;
  v_ok boolean;
begin
  -- A season under way is never touched, whatever shape it is in.
  if exists (select 1 from matchups where league_id = p_league_id and final) then
    return false;
  end if;

  -- Nothing to repair until a schedule exists.
  if not exists (select 1 from matchups where league_id = p_league_id) then
    return false;
  end if;

  perform rebalance_divisions(p_league_id);

  select count(*) into v_n from managers where league_id = p_league_id;
  if v_n < 2 then return false; end if;

  select bool_and(
           played - (v_n - 1 + case when m.division is null then 0 else sizes.d - 1 end)
             between 0 and case when m.division is null then 0 else sizes.d % 2 end
         )
    into v_ok
    from managers m
    join (
      select division, count(*) d from managers
       where league_id = p_league_id group by division
    ) sizes on sizes.division is not distinct from m.division
    cross join lateral (
      select count(*) as played from matchups x
       where x.league_id = p_league_id
         and (x.home_manager = m.id or x.away_manager = m.id)
    ) mine
   where m.league_id = p_league_id;

  if coalesce(v_ok, false) then return false; end if;

  perform generate_schedule(p_league_id);
  return true;
end;
$$;

revoke all on function repair_schedule(uuid) from public;

-- And the season already under way: every unplayed regular-season week.
do $mend$
declare
  v_league leagues;
  v_added  int;
begin
  for v_league in select * from leagues loop
    v_added := pair_idle_franchises(
      v_league.id,
      1,
      coalesce((v_league.settings ->> 'regularWeeks')::int,
               (select max(week) from matchups where league_id = v_league.id and not playoff), 0));
    if v_added > 0 then
      raise notice 'added % games to league %', v_added, v_league.id;
    end if;
  end loop;
end
$mend$;
