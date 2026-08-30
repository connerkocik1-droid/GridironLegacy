-- Two divisions, with divisional rivals met twice.
--
-- The season is built in two phases:
--   1. A full round robin — everyone plays everyone once.       (n-1 weeks)
--   2. A round robin inside each division, both running at the
--      same time, giving every divisional rival a second game.  (n/2-1 weeks)
--
-- So the shape of the league decides the length of the season, not the other
-- way round: twelve franchises means sixteen regular weeks. generate_schedule
-- writes that length back onto the league so playoffs and the rest of the app
-- agree with the schedule that actually exists.

alter table managers
  add column if not exists division text;

-- Split by slot for a league that has none, so divisions are defined from the
-- first schedule rather than being null.
update managers m
   set division = case when seq.rn * 2 <= seq.total then 'East' else 'West' end
  from (
    select id,
           row_number() over (partition by league_id order by slot) as rn,
           count(*) over (partition by league_id) as total
      from managers
  ) seq
 where seq.id = m.id and m.division is null;

alter table matchups
  add column if not exists divisional boolean not null default false;

/**
 * One round robin, by the circle method: the first entry is held still and the
 * rest rotate around it, so everyone meets everyone before anyone repeats. An
 * odd list is padded, and a pairing against the padding is a bye — returned as
 * no row rather than a broken fixture.
 *
 * Home and away alternate by round so a pairing is not always the same way
 * round when this is used twice.
 */
create or replace function round_robin(p_ids uuid[])
returns table (rnd int, home uuid, away uuid)
language plpgsql
immutable
as $$
declare
  v_ids uuid[] := p_ids;
  v_n   int;
  v_r   int;
  v_i   int;
  v_h   uuid;
  v_a   uuid;
begin
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 2 then return; end if;

  if v_n % 2 = 1 then
    v_ids := v_ids || null::uuid;
    v_n := v_n + 1;
  end if;

  for v_r in 1..(v_n - 1) loop
    for v_i in 1..(v_n / 2) loop
      if v_r % 2 = 1 then
        v_h := v_ids[v_i];
        v_a := v_ids[v_n + 1 - v_i];
      else
        v_h := v_ids[v_n + 1 - v_i];
        v_a := v_ids[v_i];
      end if;

      if v_h is not null and v_a is not null then
        rnd := v_r; home := v_h; away := v_a;
        return next;
      end if;
    end loop;

    -- Rotate everything but the first position.
    v_ids := array[v_ids[1]] || v_ids[v_n] || v_ids[2:v_n - 1];
  end loop;
end;
$$;

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

/** Moves a franchise to a division. Refused once a week has been played. */
create or replace function set_division(p_manager_id uuid, p_division text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner then
    raise exception 'Only the commissioner can set divisions' using errcode = '42501';
  end if;

  if exists (select 1 from matchups where league_id = v_me.league_id and final) then
    raise exception 'Weeks have already been played — divisions are fixed now'
      using errcode = '55000';
  end if;

  update managers set division = p_division
   where id = p_manager_id and league_id = v_me.league_id;

  if not found then
    raise exception 'No such manager in your league' using errcode = 'P0002';
  end if;

  insert into admin_log (league_id, actor, action, detail)
  values (v_me.league_id, v_me.id, 'division',
          jsonb_build_object('manager_id', p_manager_id, 'division', p_division));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function set_division(uuid, text) from public;
grant execute on function set_division(uuid, text) to authenticated;

/** Standings, now carrying the division and the record inside it. */
-- The shape of the result changes, so the old one is dropped first.
drop function if exists standings(uuid);

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
as $$
  with sides as (
    select home_manager as manager_id, home_points as pf, away_points as pa,
           winner, is_tie, final, divisional
      from matchups where league_id = p_league_id
    union all
    select away_manager, away_points, home_points, winner, is_tie, final, divisional
      from matchups where league_id = p_league_id
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


/**
 * A franchise added by a resize has no division, which would leave it out of
 * the divisional rematches. New slots join the smaller division, so the two
 * stay as even as the league allows.
 */
create or replace function assign_missing_divisions(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_divs  text[];
  v_small text;
begin
  select array_agg(distinct division order by division) into v_divs
    from managers where league_id = p_league_id and division is not null;

  -- A league with no divisions at all splits evenly by slot.
  if v_divs is null or array_length(v_divs, 1) < 2 then
    update managers m
       set division = case when seq.rn * 2 <= seq.total then 'East' else 'West' end
      from (
        select id,
               row_number() over (order by slot) as rn,
               count(*) over () as total
          from managers where league_id = p_league_id
      ) seq
     where seq.id = m.id;
    return;
  end if;

  for v_id in
    select id from managers
     where league_id = p_league_id and division is null
     order by slot
  loop
    select division into v_small
      from managers
     where league_id = p_league_id and division is not null
     group by division
     order by count(*), division
     limit 1;

    update managers set division = v_small where id = v_id;
  end loop;
end;
$$;

revoke all on function assign_missing_divisions(uuid) from public;

-- Any franchise created later — by a resize, or by the seed script — joins a
-- division automatically, so a league can never end up with a franchise that
-- sits outside the divisional rematches.
create or replace function assign_division_on_insert()
returns trigger
language plpgsql
as $$
declare
  v_divs  text[];
  v_small text;
begin
  if new.division is not null then return new; end if;

  select array_agg(distinct division order by division) into v_divs
    from managers where league_id = new.league_id and division is not null;

  -- A league that has not got two divisions yet is filling the first ones, so
  -- both names have to be candidates: picking the smallest of what exists
  -- would put everybody in whichever division was created first.
  if v_divs is null or array_length(v_divs, 1) < 2 then
    v_divs := array['East', 'West'];
  end if;

  select d into v_small
    from unnest(v_divs) as d
    left join managers m
      on m.league_id = new.league_id and m.division = d
   group by d
   order by count(m.id), d
   limit 1;

  new.division := coalesce(v_small, 'East');
  return new;
end;
$$;

drop trigger if exists managers_division on managers;
create trigger managers_division
  before insert on managers
  for each row execute function assign_division_on_insert();
