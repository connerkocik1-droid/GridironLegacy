-- An unclaimed franchise is "Open Team", and a claimed one is somebody's.
--
-- Open seats were called "Franchise 4", which reads like a database row rather
-- than a thing anyone wants. They are "Open Team" now, and claiming one names
-- it after the person who took it — "Dana's Team" — until they choose
-- something better from their own profile.

-- What an unclaimed seat is called, in one place, because three of them agree
-- on it: the seed, set_team_count, and release_franchise below.
create or replace function open_team_name() returns text
language sql immutable as $$ select 'Open Team' $$;

/**
 * Whether a franchise name is one this app made up rather than one a person
 * chose.
 *
 * Used when somebody leaves: a seat called "Dana's Team" should not still be
 * called that once Dana has gone, but a franchise a manager deliberately named
 * "Steel Cartel" is part of the league and outlives whoever was running it.
 */
create or replace function is_default_franchise_name(p_name text)
returns boolean
language sql
immutable
as $$
  select p_name is null
      or p_name = open_team_name()
      or p_name like '%''s Team'
      -- What open seats were called before this migration.
      or p_name ~ '^Franchise \d+$'
$$;

-- Every seat nobody holds, renamed. Claimed franchises are left alone, whatever
-- they are called.
update managers
   set franchise = open_team_name()
 where pin_hash is null
   and auth_user_id is null
   and franchise ~ '^Franchise \d+$';

-- ------------------------------------------------------- growing a league ---
-- set_team_count adds open seats, and they were the source of "Franchise 4".

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

  if exists (select 1 from matchups where league_id = p_league_id and final) then
    raise exception 'Weeks have already been played — the league size is fixed now'
      using errcode = '55000';
  end if;

  select count(*) into v_current from managers where league_id = p_league_id;

  if p_count < v_current then
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

    -- Named by slot as well as franchise. Open seats are all called the same
    -- thing now, and "these franchises are claimed: Open Team, Open Team" tells
    -- the commissioner nothing about which ones.
    select array_agg(distinct m.slot || ' · ' || m.franchise)
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
      values (p_league_id, v_slot, 'Open', open_team_name(), null, false);
    end loop;
  end if;

  perform assign_missing_divisions(p_league_id);
  perform rebalance_divisions(p_league_id);
  perform rebuild_draft_board(p_league_id);

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

-- ---------------------------------------------------- letting somebody go ---
-- A seat called "Dana's Team" must not still be called that once Dana has gone.
-- One a manager deliberately named is part of the league and stays.

create or replace function release_franchise(p_manager_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   managers;
  v_them managers;
  v_name text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner then
    raise exception 'Only the commissioner can release a franchise'
      using errcode = '42501';
  end if;

  select * into v_them
    from managers
   where id = p_manager_id and league_id = v_me.league_id;

  if v_them.id is null then
    raise exception 'No such franchise in your league' using errcode = 'P0002';
  end if;

  if v_them.is_commissioner then
    raise exception 'The commissioner cannot release their own franchise'
      using errcode = '55000';
  end if;

  if v_them.pin_hash is null and v_them.auth_user_id is null then
    raise exception 'Nobody holds that franchise' using errcode = '55000';
  end if;

  v_name := case
    when is_default_franchise_name(v_them.franchise) then open_team_name()
    else v_them.franchise
  end;

  update managers
     set pin_hash = null,
         auth_user_id = null,
         name = 'Open',
         franchise = v_name,
         ready = false
   where id = p_manager_id;

  insert into admin_log (league_id, actor, action, detail)
  values (v_me.league_id, v_me.id, 'franchise_released',
          jsonb_build_object('manager_id', p_manager_id,
                             'slot', v_them.slot,
                             'franchise', v_them.franchise,
                             'was', v_them.name));

  return jsonb_build_object(
    'ok', true,
    'slot', v_them.slot,
    'franchise', v_name,
    'was', v_them.name,
    'authUserId', v_them.auth_user_id
  );
end;
$$;

revoke all on function release_franchise(uuid) from public;
grant execute on function release_franchise(uuid) to authenticated;
