-- League size, and the draft board derived from it.
--
-- The board is not data a commissioner types in — it is generated from the
-- number of franchises and the number of rounds. So changing the league size
-- has to regenerate it, and that is only ever safe before the draft starts.

/**
 * Rebuilds the snake draft board from the league's current franchises.
 *
 * Order is the lottery order if one has been drawn, otherwise slot order.
 * Odd rounds run in that order, even rounds reverse it — that is the snake.
 *
 * Refuses once any pick has been made. Regenerating a board mid-draft would
 * renumber picks that already have players against them.
 */
create or replace function rebuild_draft_board(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league   leagues;
  v_rounds   int;
  v_teams    int;
  v_made     int;
  v_order    uuid[];
  v_round    int;
  v_seat     int;
  v_overall  int := 0;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  select count(*) into v_made
    from draft_picks
   where league_id = p_league_id and player_name is not null;

  if v_made > 0 then
    raise exception 'The draft has already started — % picks are made', v_made
      using errcode = '55000';
  end if;

  v_rounds := coalesce((v_league.settings ->> 'rounds')::int, 24);

  -- Draft order: the lottery if it has been drawn, else by slot.
  if v_league.lottery_order is not null and array_length(v_league.lottery_order, 1) > 0 then
    select array_agg(m.id order by idx)
      into v_order
      from unnest(v_league.lottery_order) with ordinality as lo(slot, idx)
      join managers m on m.league_id = p_league_id and m.slot = lo.slot;
  else
    select array_agg(id order by slot) into v_order
      from managers where league_id = p_league_id;
  end if;

  v_teams := coalesce(array_length(v_order, 1), 0);
  if v_teams = 0 then
    raise exception 'The league has no franchises' using errcode = '55000';
  end if;

  delete from draft_picks where league_id = p_league_id;

  for v_round in 1..v_rounds loop
    for v_seat in 1..v_teams loop
      v_overall := v_overall + 1;
      insert into draft_picks (league_id, overall, round, manager_id)
      values (
        p_league_id,
        v_overall,
        v_round,
        -- Odd rounds run forward, even rounds back.
        v_order[case when v_round % 2 = 1 then v_seat else v_teams - v_seat + 1 end]
      );
    end loop;
  end loop;

  update leagues
     set current_pick = 1,
         pick_started_at = null,
         draft_state = case when draft_state = 'complete' then 'pending' else draft_state end
   where id = p_league_id;

  return jsonb_build_object('ok', true, 'teams', v_teams, 'rounds', v_rounds, 'picks', v_overall);
end;
$$;

revoke all on function rebuild_draft_board(uuid) from public;

/**
 * Sets how many franchises the league has.
 *
 * Growing adds open, unclaimed slots. Shrinking only ever removes slots that
 * nobody has claimed and that hold no players — a manager who has signed up
 * or drafted is never deleted out from under themselves; the call fails and
 * names them instead.
 *
 * The board is rebuilt either way, so the draft always matches the league.
 */
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

  select count(*) into v_current from managers where league_id = p_league_id;

  if p_count < v_current then
    -- The slots that would go: the highest-lettered ones, newest first.
    select array_agg(id order by slot desc)
      into v_removing
      from (
        select id, slot from managers
         where league_id = p_league_id
         order by slot desc
         limit (v_current - p_count)
      ) doomed;

    -- Anyone claimed or holding players blocks the change by name.
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
      -- Slots are T01, T02… only where the seeded names run out, so a league
      -- that shrinks and grows again does not collide with a surviving slot.
      v_slot := 'T' || lpad(v_i::text, 2, '0');
      while exists (select 1 from managers where league_id = p_league_id and slot = v_slot) loop
        v_slot := v_slot || 'X';
      end loop;

      insert into managers (league_id, slot, name, franchise, pin_hash, is_commissioner)
      values (p_league_id, v_slot, 'Open', 'Franchise ' || v_i, null, false);
    end loop;
  end if;

  perform rebuild_draft_board(p_league_id);

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'team_count_changed',
          jsonb_build_object('from', v_current, 'to', p_count));

  return jsonb_build_object('ok', true, 'teams', p_count, 'was', v_current);
end;
$$;

revoke all on function set_team_count(uuid, int) from public;
grant execute on function set_team_count(uuid, int) to authenticated;

-- The commissioner may also rebuild the board on its own, after redrawing the
-- lottery or changing the number of rounds.
create or replace function commissioner_rebuild_board(p_league_id uuid)
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
    raise exception 'Only the commissioner can rebuild the draft board'
      using errcode = '42501';
  end if;

  return rebuild_draft_board(p_league_id);
end;
$$;

revoke all on function commissioner_rebuild_board(uuid) from public;
grant execute on function commissioner_rebuild_board(uuid) to authenticated;
