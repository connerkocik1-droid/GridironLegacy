-- Resizing a league must rebuild its schedule, not just its draft board.
--
-- set_team_count() rebuilt the board and stopped there. The schedule was left
-- as it was, and the franchises that went took their fixtures with them by
-- cascade — so a league resized from twelve to ten kept a twelve-team season:
-- sixteen weeks instead of fourteen, four games in most weeks instead of five,
-- and two franchises idle each week for no reason anyone could see.
--
-- The board and the season are both derived from the league. Changing the
-- league has to regenerate both, or one of them is quietly lying.
--
-- Divisions had the same shape of problem: franchises were only ever assigned
-- when they had none, never rebalanced. Removing two from one side left six
-- against four, and since a six-team division needs five rematch rounds while
-- a four-team one needs three, the small division sat out entirely for two
-- weeks of every season.

/**
 * Evens the divisions up, moving as few franchises as possible.
 *
 * Deliberate assignments are worth keeping, so this does not reshuffle: it
 * moves the fewest franchises from the larger division to the smaller, newest
 * slot first, and stops as soon as they are within one of each other.
 */
create or replace function rebalance_divisions(p_league_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_big    text;
  v_small  text;
  v_n_big  int;
  v_n_small int;
  v_moved  int := 0;
  v_id     uuid;
begin
  loop
    select division, n into v_big, v_n_big
      from (select division, count(*) n from managers
             where league_id = p_league_id and division is not null
             group by division) d
     order by n desc, division limit 1;

    select division, n into v_small, v_n_small
      from (select division, count(*) n from managers
             where league_id = p_league_id and division is not null
             group by division) d
     order by n, division limit 1;

    exit when v_big is null or v_small is null or v_big = v_small;
    exit when v_n_big - v_n_small <= 1;

    select id into v_id
      from managers
     where league_id = p_league_id and division = v_big
     order by slot desc
     limit 1;

    exit when v_id is null;

    update managers set division = v_small where id = v_id;
    v_moved := v_moved + 1;

    -- Bounded: every pass moves one franchise across, so the gap always
    -- shrinks. The guard is only here so a surprise cannot spin forever.
    exit when v_moved > 32;
  end loop;

  return v_moved;
end;
$$;

revoke all on function rebalance_divisions(uuid) from public;

create or replace function set_team_count(p_league_id uuid, p_count int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_current  int;
  v_blocked  text[];
  v_removing uuid[];
  v_slot     text;
  v_i        int;
  v_made     int;
  v_sched    jsonb;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can change the league size'
      using errcode = '42501';
  end if;

  if p_count < 2 or p_count > 16 then
    raise exception 'A league runs from 2 to 16 franchises' using errcode = '22003';
  end if;

  select count(*) into v_made
    from draft_picks
   where league_id = p_league_id and player_name is not null;

  if v_made > 0 then
    raise exception 'The draft has already started — the league size is fixed now'
      using errcode = '55000';
  end if;

  -- A played week fixes the league's shape just as firmly as a made pick:
  -- generate_schedule would refuse below anyway, but failing here says why.
  if exists (select 1 from matchups where league_id = p_league_id and final) then
    raise exception 'Weeks have already been played — the league size is fixed now'
      using errcode = '55000';
  end if;

  select count(*) into v_current from managers where league_id = p_league_id;

  if p_count < v_current then
    -- Removal runs from the end of the alphabet, and the commissioner's slot
    -- has no reason to be safe there — STL sorts near the back. Deleting the
    -- office holder would leave a league nobody can administer, so the
    -- commissioner is never a candidate.
    select array_agg(id order by slot desc)
      into v_removing
      from (
        select id, slot from managers
         where league_id = p_league_id
           and not is_commissioner
         order by slot desc
         limit (v_current - p_count)
      ) doomed;

    if coalesce(array_length(v_removing, 1), 0) < v_current - p_count then
      raise exception
        'Cannot shrink to % — only the commissioner''s franchise would be left to remove',
        p_count using errcode = '55000';
    end if;

    select array_agg(distinct m.franchise)
      into v_blocked
      from managers m
     where m.id = any (v_removing)
       and (
         m.pin_hash is not null
         or exists (select 1 from roster_slots r where r.manager_id = m.id)
       );

    if v_blocked is not null then
      raise exception 'These franchises are claimed or hold players: %',
        array_to_string(v_blocked, ', ')
        using errcode = '55000';
    end if;

    delete from managers where id = any (v_removing);

  elsif p_count > v_current then
    for v_i in (v_current + 1)..p_count loop
      v_slot := 'T' || lpad(v_i::text, 2, '0');
      while exists (select 1 from managers where league_id = p_league_id and slot = v_slot) loop
        v_slot := v_slot || 'X';
      end loop;

      insert into managers (league_id, slot, name, franchise, pin_hash, is_commissioner)
      values (p_league_id, v_slot, 'Open', 'Franchise ' || v_i, null, false);
    end loop;
  end if;

  perform assign_missing_divisions(p_league_id);
  -- Without this a resize leaves the divisions lopsided, and the smaller one
  -- sits out whole weeks of the rematch phase.
  perform rebalance_divisions(p_league_id);
  perform rebuild_draft_board(p_league_id);

  -- The season is derived from the league too. Without this the old schedule
  -- survives with holes in it where the departed franchises used to be.
  v_sched := generate_schedule(p_league_id);

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'team_count_changed',
          jsonb_build_object('from', v_current, 'to', p_count,
                             'weeks', v_sched -> 'weeks'));

  return jsonb_build_object(
    'ok', true,
    'teams', p_count,
    'was', v_current,
    'weeks', v_sched -> 'weeks',
    'matchups', v_sched -> 'matchups'
  );
end;
$$;

revoke all on function set_team_count(uuid, int) from public;
grant execute on function set_team_count(uuid, int) to authenticated;

/**
 * Rebuilds a league's season if the one it has does not match the league.
 *
 * Returns true if it rebuilt. The test is the only honest one available:
 * work out how many games the current roster implies for each franchise —
 * everyone once, then divisional rivals a second time — and see whether the
 * fixtures on record agree. A schedule left over from a larger league shows
 * up as franchises short of their games, which is exactly the hole a resize
 * used to leave behind.
 *
 * Counting idle weeks would not do: a division with an odd number of
 * franchises leaves somebody out every rematch week quite legitimately, and
 * flagging that would reshuffle healthy leagues every time this ran.
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
           played = v_n - 1 + case when m.division is null then 0 else sizes.d - 1 end
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

-- Repair any league already carrying a schedule from a size it no longer is.
do $repair$
declare
  v_league uuid;
begin
  for v_league in select id from leagues loop
    if repair_schedule(v_league) then
      raise notice 'rebuilt the schedule for league %', v_league;
    end if;
  end loop;
end
$repair$;
