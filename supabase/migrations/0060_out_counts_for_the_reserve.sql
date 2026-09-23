-- Out counts for the reserve.

-- The reserve took a player on IR or under suspension and nobody else, which
-- left the commonest designation in football outside it: a man ruled OUT for
-- Sunday sat on the active roster taking a place, and the button that would
-- have moved him was not drawn because the database would have refused it.
--
-- So OUT joins the other two. One function decides this — ir_eligible — and
-- everything downstream reads it: set_injured_reserve refuses a stash that
-- fails it, add_player_to_ir refuses a signing that fails it, and roster_count
-- stops counting a stashed player the moment the report clears him. Widening
-- the one predicate widens all four behaviours at once, which is why it was
-- written as a function rather than as a predicate repeated in each.
--
-- Worth saying plainly, because it is a rules change and not only a button:
-- OUT is a week-to-week designation where IR and a suspension are not, so a
-- manager can now park a man who misses one Sunday and get the roster spot
-- back for that week. That is what was asked for. roster_count already handles
-- the other end of it — the week the report clears him he is back on the books
-- whether or not anybody moves him, so the spot is not free indefinitely.
--
-- The two functions below are reproduced from 0046 unchanged but for the
-- sentence each one raises when it refuses: a refusal that lists what is
-- allowed has to list all three.

-- The rule itself. Same shape as 0046's, one status longer.
create or replace function ir_eligible(p_player text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.injury_status in ('out', 'ir', 'suspended') from nfl_players p where p.name = p_player),
    false);
$$;

revoke all on function ir_eligible(text) from public;
grant execute on function ir_eligible(text) to authenticated;

create or replace function set_injured_reserve(p_player text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_settings jsonb;
  v_was_ir   boolean;
begin
  select * into v_me from current_manager();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select settings into v_settings from leagues where id = v_me.league_id;

  select lineup_slot = 'IR'
    into v_was_ir
    from roster_slots
   where manager_id = v_me.id and player_name = p_player;

  if v_was_ir is null then
    raise exception 'You do not hold %', p_player using errcode = 'P0002';
  end if;

  if p_on then
    if not ir_eligible(p_player) then
      raise exception 'The reserve is for players out, on IR or suspended — % is not'
        , p_player using errcode = '55000';
    end if;

    if ir_count(v_me.id) - (case when v_was_ir then 1 else 0 end)
       >= ir_capacity(v_settings) then
      raise exception 'Injured reserve holds %', ir_capacity(v_settings)
        using errcode = '55000';
    end if;

    update roster_slots
       set lineup_slot = 'IR'
     where manager_id = v_me.id and player_name = p_player;
  else
    if v_was_ir and ir_eligible(p_player)
       and roster_count(v_me.id) >= roster_capacity(v_settings) then
      raise exception 'Your roster is full at % — drop someone first',
        roster_capacity(v_settings) using errcode = '55000';
    end if;

    update roster_slots
       set lineup_slot = 'BENCH'
     where manager_id = v_me.id and player_name = p_player;
  end if;

  return jsonb_build_object('ok', true, 'player', p_player, 'ir', p_on);
end;
$$;

create or replace function add_player_to_ir(p_league_id uuid, p_player text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_settings jsonb;
  v_clears   timestamptz;
  v_block    text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  if not ir_eligible(p_player) then
    raise exception 'Only a player out, on IR or suspended can be signed to the reserve'
      using errcode = '55000';
  end if;

  v_block := move_block(p_league_id, p_player, 'picked up');
  if v_block is not null then
    raise exception '%', v_block using errcode = '55000';
  end if;

  if waiver_mode(p_league_id) = 'all' then
    raise exception 'Every pickup in this league goes through waivers — place a claim'
      using errcode = '55000';
  end if;

  select clears_at into v_clears
    from waiver_wire where league_id = p_league_id and player_name = p_player;
  if v_clears is not null then
    raise exception '% is on waivers — place a claim instead', p_player
      using errcode = '55000';
  end if;

  if exists (
    select 1 from roster_slots where league_id = p_league_id and player_name = p_player
  ) then
    raise exception 'That player is already rostered' using errcode = '23505';
  end if;

  select settings into v_settings from leagues where id = p_league_id for update;

  if ir_count(v_me.id) >= ir_capacity(v_settings) then
    raise exception 'Injured reserve holds %', ir_capacity(v_settings)
      using errcode = '55000';
  end if;

  insert into roster_slots (league_id, manager_id, player_name, acquired, lineup_slot)
  values (p_league_id, v_me.id, p_player, 'add', 'IR');

  delete from waiver_wire where league_id = p_league_id and player_name = p_player;

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  values (p_league_id, v_me.id, 'add', p_player, jsonb_build_object('ir', true));

  return jsonb_build_object('ok', true, 'added', p_player, 'ir', true);
end;
$$;
