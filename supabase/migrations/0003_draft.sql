-- The live draft.
--
-- Twelve people, one board, one clock. Two things must hold no matter how many
-- browsers are open: a player can be taken exactly once, and every client
-- agrees on whose turn it is. Both are settled here rather than in any client.

-- Each manager's own queue, used by autodraft when their clock runs out.
create table draft_queue (
  league_id uuid not null references leagues(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  player_name text not null,
  rank int not null,
  primary key (manager_id, player_name)
);

create index draft_queue_order_idx on draft_queue (manager_id, rank);

alter table draft_queue enable row level security;

create policy queue_read on draft_queue
  for select using (manager_id = (select id from current_manager()));

create policy queue_write on draft_queue
  for all using (manager_id = (select id from current_manager()))
  with check (manager_id = (select id from current_manager()));

-- Draft state lives on the league row. pick_started_at already exists; this
-- adds where the draft has reached and whether it is running.
alter table leagues
  add column if not exists draft_state text not null default 'pending'
    check (draft_state in ('pending', 'running', 'paused', 'complete')),
  add column if not exists current_pick int not null default 1;

/**
 * Makes one pick. Everything that could go wrong with twelve people clicking
 * at once is checked here, inside one transaction:
 *   - the draft is actually running
 *   - it is this manager's turn (or the commissioner is acting for them)
 *   - the player is not already on someone's roster
 * The unique constraint on roster_slots is the final backstop: if two calls
 * race past the check, the second fails rather than duplicating the player.
 */
create or replace function make_pick(
  p_league_id uuid,
  p_player_name text,
  p_manager_id uuid default null
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
  v_teams    int;
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

  insert into roster_slots (league_id, manager_id, player_name, acquired, overall_pick, lineup_slot)
  values (p_league_id, v_actor, p_player_name, 'draft', v_pick.overall, 'BENCH');

  update draft_picks
     set player_name = p_player_name,
         picked_at = now()
   where id = v_pick.id;

  -- A drafted player is off everyone's queue, not just the picker's.
  delete from draft_queue
   where league_id = p_league_id and player_name = p_player_name;

  select count(*) into v_rounds from draft_picks where league_id = p_league_id;
  select count(*) into v_teams from managers where league_id = p_league_id;

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

revoke all on function make_pick(uuid, text, uuid) from public;
grant execute on function make_pick(uuid, text, uuid) to authenticated;

/**
 * Autodraft. A browser that closed cannot pick for itself, so when a clock
 * expires this takes the top of that manager's queue, or the best available
 * by ADP rank if the queue is empty. Called by the draft cron, which runs
 * with the service key.
 */
create or replace function autodraft_expired(p_league_id uuid, p_fallback text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league  leagues;
  v_pick    draft_picks;
  v_name    text;
begin
  select * into v_league from leagues where id = p_league_id for update;

  if v_league.id is null or v_league.draft_state <> 'running' then
    return jsonb_build_object('ok', false, 'reason', 'not running');
  end if;

  -- Still on the clock, nothing to do.
  if v_league.pick_started_at is null
     or now() < v_league.pick_started_at
              + make_interval(secs => coalesce((v_league.settings ->> 'pickSeconds')::int, 90)) then
    return jsonb_build_object('ok', false, 'reason', 'on the clock');
  end if;

  select * into v_pick
    from draft_picks
   where league_id = p_league_id and overall = v_league.current_pick;

  if v_pick.id is null or v_pick.player_name is not null then
    return jsonb_build_object('ok', false, 'reason', 'no open pick');
  end if;

  -- The manager's own queue first, skipping anyone already taken.
  select q.player_name into v_name
    from draft_queue q
   where q.manager_id = v_pick.manager_id
     and not exists (
       select 1 from roster_slots r
        where r.league_id = p_league_id and r.player_name = q.player_name
     )
   order by q.rank
   limit 1;

  if v_name is null then v_name := p_fallback; end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing to pick');
  end if;

  insert into roster_slots (league_id, manager_id, player_name, acquired, overall_pick, lineup_slot)
  values (p_league_id, v_pick.manager_id, v_name, 'draft', v_pick.overall, 'BENCH');

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
          jsonb_build_object('overall', v_pick.overall, 'player_name', v_name));

  return jsonb_build_object('ok', true, 'overall', v_pick.overall, 'player_name', v_name);
end;
$$;

revoke all on function autodraft_expired(uuid, text) from public;

-- Realtime: clients subscribe to picks landing rather than polling the board.
alter publication supabase_realtime add table draft_picks;
alter publication supabase_realtime add table leagues;
