-- 0044: no position caps.
--
-- 0043 put a limit on how many quarterbacks, defences and kickers one roster
-- could draft, and the commissioner has since decided the league does not want
-- one. So it comes out — properly, rather than by setting every limit to a
-- number nobody reaches: a rule that is still enforced but never fires is a
-- rule somebody will trip over in three years with no idea why.
--
-- What stays is the half of 0043 that was never about caps. draft_queue.position
-- and roster_slots.position record what a man plays at the moment he is drafted
-- rather than waiting for the next score refresh, and the p_position arguments
-- that carry it are kept so no caller has to change.

create or replace function make_pick(
  p_league_id uuid,
  p_player_name text,
  p_manager_id uuid default null,
  p_position text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_league   leagues;
  v_pick     draft_picks;
  v_actor    uuid;
  v_rounds   int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  -- Lock the league row: this serialises every pick in the draft, so two
  -- managers cannot both believe it is their turn.
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  if v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  if v_league.draft_state <> 'running' then
    raise exception 'The draft is not running' using errcode = '55000';
  end if;

  -- The commissioner may pick on behalf of a manager who is not there.
  v_actor := coalesce(p_manager_id, v_me.id);
  if v_actor <> v_me.id and not v_me.is_commissioner then
    raise exception 'Only the commissioner can pick for another manager'
      using errcode = '42501';
  end if;

  select * into v_pick
    from draft_picks
   where league_id = p_league_id
     and overall = v_league.current_pick;

  if v_pick.id is null then
    raise exception 'The draft board has no pick % ', v_league.current_pick
      using errcode = 'P0002';
  end if;

  if v_pick.player_name is not null then
    raise exception 'That pick has already been made' using errcode = '55000';
  end if;

  if v_pick.manager_id <> v_actor then
    raise exception 'It is not your pick' using errcode = '55000';
  end if;

  -- A player already rostered cannot be drafted. The unique index on
  -- (league_id, player_name) enforces this even if two calls race here.
  if exists (
    select 1 from roster_slots
     where league_id = p_league_id and player_name = p_player_name
  ) then
    raise exception 'That player is already rostered' using errcode = '23505';
  end if;

  insert into roster_slots
    (league_id, manager_id, player_name, acquired, overall_pick, lineup_slot, position)
  values
    (p_league_id, v_actor, p_player_name, 'draft', v_pick.overall, 'BENCH',
     nullif(p_position, ''));

  update draft_picks
     set player_name = p_player_name,
         picked_at = now()
   where id = v_pick.id;

  -- A drafted player is off everyone's queue, not just the picker's.
  delete from draft_queue
   where league_id = p_league_id and player_name = p_player_name;

  select count(*) into v_rounds from draft_picks where league_id = p_league_id;

  -- Advance the board and restart the clock from the server, so every client
  -- counts down from the same instant rather than its own.
  update leagues
     set current_pick = v_league.current_pick + 1,
         pick_started_at = now(),
         draft_state = case
           when v_league.current_pick + 1 > v_rounds then 'complete'
           else 'running'
         end
   where id = p_league_id;

  return jsonb_build_object(
    'ok', true,
    'overall', v_pick.overall,
    'round', v_pick.round,
    'manager_id', v_actor,
    'player_name', p_player_name,
    'next_pick', v_league.current_pick + 1
  );
end;
$$;


revoke all on function make_pick(uuid, text, uuid, text) from public;
grant execute on function make_pick(uuid, text, uuid, text) to authenticated;

/**
 * Autodraft, as 0043 left it, less the two cap checks.
 *
 * The queue is read in order and the first player still available is taken,
 * which is what it did before caps existed.
 */
create or replace function autodraft_expired(
  p_league_id uuid,
  p_fallback text default null,
  p_fallback_position text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league   leagues;
  v_pick     draft_picks;
  v_name     text;
  v_position text;
  v_auto     boolean;
  v_limit    int;
  v_reason   text;
begin
  select * into v_league from leagues where id = p_league_id for update;

  if v_league.id is null or v_league.draft_state <> 'running' then
    return jsonb_build_object('ok', false, 'reason', 'not running');
  end if;

  select * into v_pick
    from draft_picks
   where league_id = p_league_id and overall = v_league.current_pick;

  if v_pick.id is null or v_pick.player_name is not null then
    return jsonb_build_object('ok', false, 'reason', 'no open pick');
  end if;

  select coalesce(autodraft, false) into v_auto
    from managers where id = v_pick.manager_id;

  v_limit := pick_seconds_for(v_league.settings, v_pick.round);

  if v_league.pick_started_at is not null
     and now() >= v_league.pick_started_at + make_interval(secs => v_limit) then
    v_reason := 'clock';
  elsif coalesce(v_auto, false) then
    v_reason := 'autodraft';
  else
    return jsonb_build_object('ok', false, 'reason', 'on the clock');
  end if;

  -- The manager's own queue first, skipping anyone already taken.
  select q.player_name, q.position into v_name, v_position
    from draft_queue q
   where q.manager_id = v_pick.manager_id
     and not exists (
       select 1 from roster_slots r
        where r.league_id = p_league_id and r.player_name = q.player_name
     )
   order by q.rank
   limit 1;

  if v_name is not null then
    v_reason := v_reason || '_queue';
  else
    v_name := p_fallback;
    v_position := p_fallback_position;
  end if;

  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing to pick');
  end if;

  -- The fallback was worked out before this row was locked, so it can name
  -- somebody who has since been taken. Better to say so and be called again
  -- than to raise a unique violation out of a background job.
  if exists (
    select 1 from roster_slots
     where league_id = p_league_id and player_name = v_name
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already rostered');
  end if;

  insert into roster_slots
    (league_id, manager_id, player_name, acquired, overall_pick, lineup_slot, position)
  values
    (p_league_id, v_pick.manager_id, v_name, 'draft', v_pick.overall, 'BENCH',
     nullif(v_position, ''));

  update draft_picks
     set player_name = v_name, picked_at = now()
   where id = v_pick.id;

  delete from draft_queue where league_id = p_league_id and player_name = v_name;

  update leagues
     set current_pick = v_league.current_pick + 1,
         pick_started_at = now(),
         draft_state = case
           when v_league.current_pick + 1
                > (select count(*) from draft_picks where league_id = p_league_id)
           then 'complete' else 'running' end
   where id = p_league_id;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_pick.manager_id, 'autodraft',
          jsonb_build_object('overall', v_pick.overall, 'player_name', v_name,
                             'reason', v_reason));

  return jsonb_build_object('ok', true, 'overall', v_pick.overall,
                            'player_name', v_name, 'reason', v_reason);
end;
$$;

revoke all on function autodraft_expired(uuid, text, text) from public;
grant execute on function autodraft_expired(uuid, text, text) to authenticated;

-- Nothing calls it now.
drop function if exists draft_cap_block(uuid, uuid, text);

-- And the stored map goes with it, so a league carrying one cannot have it
-- quietly honoured again by something written later.
update leagues
   set settings = settings - 'positionCaps'
 where settings ? 'positionCaps';
