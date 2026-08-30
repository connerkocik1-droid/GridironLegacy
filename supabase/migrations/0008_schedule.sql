-- The season schedule, and the standings that come from it.
--
-- Matchup used to pair managers by slot order, which meant there were no real
-- opponents and no records. This generates a round-robin, grades each week
-- from what the starters actually scored, and freezes a week once its games
-- are over — otherwise a lineup change in week 6 would silently rewrite the
-- result of week 5.

create table matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  week int not null,
  home_manager uuid references managers(id) on delete cascade,
  away_manager uuid references managers(id) on delete cascade,
  home_points numeric not null default 0,
  away_points numeric not null default 0,
  -- Who started, as they stood when the week was graded. Without this a later
  -- lineup change would make a finished week unexplainable.
  home_starters jsonb not null default '[]'::jsonb,
  away_starters jsonb not null default '[]'::jsonb,
  winner uuid references managers(id) on delete set null,
  is_tie boolean not null default false,
  final boolean not null default false,
  playoff boolean not null default false,
  graded_at timestamptz,
  unique (league_id, week, home_manager)
);

create index matchups_week_idx on matchups (league_id, week);

alter table matchups enable row level security;

create policy matchups_read on matchups
  for select using (league_id = (select league_id from current_manager()));

/**
 * Builds the regular season as a round robin.
 *
 * The circle method: one franchise is held still and the rest rotate around
 * it, so every manager meets every other before anyone is met twice. An odd
 * league pads with a phantom, and whoever draws it has a bye that week.
 *
 * Home and away alternate by week so the same pairing is not always the same
 * way round when the schedule wraps.
 *
 * Refuses once any week has been graded final — regenerating then would throw
 * away results that already stand.
 */
create or replace function generate_schedule(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league  leagues;
  v_ids     uuid[];
  v_n       int;
  v_weeks   int;
  v_week    int;
  v_i       int;
  v_home    uuid;
  v_away    uuid;
  v_rot     uuid[];
  v_made    int := 0;
  v_byes    int := 0;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  if exists (select 1 from matchups where league_id = p_league_id and final) then
    raise exception 'Weeks have already been played — the schedule is fixed now'
      using errcode = '55000';
  end if;

  select array_agg(id order by slot) into v_ids
    from managers where league_id = p_league_id;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 2 then
    raise exception 'A schedule needs at least two franchises' using errcode = '55000';
  end if;

  -- An odd league gets a phantom opponent; drawing it is a bye.
  if v_n % 2 = 1 then
    v_ids := v_ids || null::uuid;
    v_n := v_n + 1;
  end if;

  v_weeks := coalesce((v_league.settings ->> 'regularWeeks')::int, 13);

  delete from matchups where league_id = p_league_id and not final;

  v_rot := v_ids;

  for v_week in 1..v_weeks loop
    for v_i in 1..(v_n / 2) loop
      -- Alternate which side is home as the weeks go by.
      if v_week % 2 = 1 then
        v_home := v_rot[v_i];
        v_away := v_rot[v_n + 1 - v_i];
      else
        v_home := v_rot[v_n + 1 - v_i];
        v_away := v_rot[v_i];
      end if;

      if v_home is null or v_away is null then
        v_byes := v_byes + 1;
        continue;
      end if;

      insert into matchups (league_id, week, home_manager, away_manager)
      values (p_league_id, v_week, v_home, v_away);
      v_made := v_made + 1;
    end loop;

    -- Rotate every position but the first.
    v_rot := array[v_rot[1]] || v_rot[v_n] || v_rot[2:v_n - 1];
  end loop;

  return jsonb_build_object('ok', true, 'weeks', v_weeks, 'matchups', v_made, 'byes', v_byes);
end;
$$;

revoke all on function generate_schedule(uuid) from public;

/** The commissioner's way in. */
create or replace function commissioner_generate_schedule(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can build the schedule' using errcode = '42501';
  end if;

  return generate_schedule(p_league_id);
end;
$$;

revoke all on function commissioner_generate_schedule(uuid) from public;
grant execute on function commissioner_generate_schedule(uuid) to authenticated;

/** What a manager's starters scored in a week. */
create or replace function lineup_points(p_league_id uuid, p_manager_id uuid, p_week int)
returns numeric
language sql
stable
as $$
  select coalesce(sum(s.points), 0)
    from roster_slots r
    join player_scores s
      on s.league_id = r.league_id
     and s.player_name = r.player_name
     and s.week = p_week
   where r.league_id = p_league_id
     and r.manager_id = p_manager_id
     and r.lineup_slot not in ('BENCH', 'IR');
$$;

/**
 * Scores a week and, once its games are over, freezes the result.
 *
 * A week stays open while games are still to be played, so live scores move
 * during the day. It goes final only when every game that week is complete,
 * and a final week is never regraded — a manager changing their lineup in a
 * later week must not rewrite a result that already stands.
 */
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
begin
  -- A week with no games mirrored yet cannot be closed.
  select count(*) > 0 and bool_and(completed)
    into v_complete
    from nfl_games where week = p_week;

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

/**
 * The table. Only final weeks count toward a record — a week still being
 * played shows in the live matchup, not in the standings.
 */
create or replace function standings(p_league_id uuid)
returns table (
  manager_id uuid,
  slot text,
  franchise text,
  wins int,
  losses int,
  ties int,
  points_for numeric,
  points_against numeric
)
language sql
stable
as $$
  with sides as (
    select home_manager as manager_id, home_points as pf, away_points as pa,
           winner, is_tie, final
      from matchups where league_id = p_league_id
    union all
    select away_manager, away_points, home_points, winner, is_tie, final
      from matchups where league_id = p_league_id
  )
  select m.id,
         m.slot,
         m.franchise,
         count(*) filter (where s.final and s.winner = m.id)::int,
         count(*) filter (where s.final and s.winner is not null and s.winner <> m.id)::int,
         count(*) filter (where s.final and s.is_tie)::int,
         coalesce(sum(s.pf) filter (where s.final), 0),
         coalesce(sum(s.pa) filter (where s.final), 0)
    from managers m
    left join sides s on s.manager_id = m.id
   where m.league_id = p_league_id
   group by m.id, m.slot, m.franchise
   order by 4 desc, 7 desc;
$$;
