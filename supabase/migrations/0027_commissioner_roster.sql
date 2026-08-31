-- Fixing a roster without a database console.
--
-- Everything that moves a player checks that the person asking is entitled to
-- move him: add_player only touches your own roster, execute_trade needs both
-- managers, the waiver run needs a claim. That is right, and it leaves the
-- commissioner with no way to undo an honest mistake — a player awarded to the
-- wrong franchise by an autodraft, a drop somebody made by fat finger on a
-- phone, a trade executed against the wrong name.
--
-- Until now the answer was "open the SQL editor", which is the answer that
-- ends with somebody deleting the wrong row at midnight.
--
-- Two deliberate limits. It cannot invent a player onto a full roster, because
-- a roster over its own capacity breaks the lineup rules everywhere else; and
-- it writes to both transactions and admin_log every time, so a commissioner
-- correction is the most visible move in the league rather than the least. A
-- league where the commissioner can quietly move players is not a league.

/**
 * Moves a player to another franchise, or releases him, on the commissioner's
 * authority.
 *
 * p_to null releases him: to waivers like any other drop, so the correction
 * does not hand him to whoever is watching. Naming a franchise moves him there
 * whether he is currently held by somebody else or by nobody at all.
 */
create or replace function commissioner_move_player(
  p_league_id uuid,
  p_player text,
  p_to uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_league   leagues;
  v_from     uuid;
  v_from_name text;
  v_to_name  text;
  v_capacity int;
  v_clears   timestamptz;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can move a player' using errcode = '42501';
  end if;

  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  if p_to is not null and not exists (
    select 1 from managers where id = p_to and league_id = p_league_id
  ) then
    raise exception 'That franchise is not in this league' using errcode = '42501';
  end if;

  select manager_id into v_from
    from roster_slots where league_id = p_league_id and player_name = p_player;

  if v_from is null and p_to is null then
    raise exception '% is not on anybody''s roster', p_player using errcode = 'P0002';
  end if;

  if v_from is not null and v_from = p_to then
    raise exception '% is already there', p_player using errcode = '55000';
  end if;

  select franchise into v_from_name from managers where id = v_from;
  select franchise into v_to_name   from managers where id = p_to;

  -- Releasing him.
  if p_to is null then
    delete from roster_slots
     where league_id = p_league_id and player_name = p_player;

    v_clears := send_to_waivers(p_league_id, v_from, p_player);

    insert into transactions (league_id, manager_id, kind, player_name, detail)
    values (p_league_id, v_from, 'drop', p_player,
            jsonb_build_object('waivers', v_clears is not null, 'clearsAt', v_clears,
                               'commissioner', true, 'reason', p_reason));

    insert into admin_log (league_id, actor, action, detail)
    values (p_league_id, v_me.id, 'commissioner_release',
            jsonb_build_object('player', p_player, 'from', v_from_name, 'reason', p_reason));

    return jsonb_build_object('ok', true, 'released', p_player, 'from', v_from_name,
                              'clearsAt', v_clears);
  end if;

  -- Moving him. The receiving roster must have room by its own rules: a
  -- correction that leaves a franchise over capacity is a second mistake.
  v_capacity := roster_capacity(v_league.settings);
  if v_from is distinct from p_to and roster_count(p_to) >= v_capacity then
    raise exception '% is full at % — drop someone there first', v_to_name, v_capacity
      using errcode = '55000';
  end if;

  if v_from is null then
    insert into roster_slots (league_id, manager_id, player_name, acquired, lineup_slot)
    values (p_league_id, p_to, p_player, 'add', 'BENCH');
  else
    -- Onto the bench, the same as a trade: a lineup slot on one roster means
    -- nothing on another, and the new owner sets it.
    update roster_slots
       set manager_id = p_to, acquired = 'trade', lineup_slot = 'BENCH'
     where league_id = p_league_id and player_name = p_player;
  end if;

  -- He is owned; the wire has no further business with him.
  delete from waiver_wire where league_id = p_league_id and player_name = p_player;

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  values (p_league_id, p_to, 'trade', p_player,
          jsonb_build_object('fromManager', v_from, 'fromFranchise',
                             coalesce(v_from_name, 'free agency'),
                             'commissioner', true, 'reason', p_reason));

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'commissioner_move',
          jsonb_build_object('player', p_player, 'from', v_from_name,
                             'to', v_to_name, 'reason', p_reason));

  return jsonb_build_object('ok', true, 'moved', p_player,
                            'from', coalesce(v_from_name, 'free agency'), 'to', v_to_name);
end;
$$;

revoke all on function commissioner_move_player(uuid, text, uuid, text) from public;
grant execute on function commissioner_move_player(uuid, text, uuid, text) to authenticated;
