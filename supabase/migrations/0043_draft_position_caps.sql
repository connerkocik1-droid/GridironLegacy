-- How many of a position one roster may draft.
--
-- The draft nobody enjoys is the one where a manager takes six quarterbacks in
-- the middle rounds and the other eleven spend the season with the wire picked
-- clean of a position they each need one of. A cap is not about stopping a bad
-- team — it is about stopping one roster from emptying a shelf everybody
-- shares. Running backs, receivers and tight ends are deliberately uncapped:
-- there are hundreds of them, every roster starts several, and hoarding them
-- costs the hoarder as much as anybody.
--
-- The rule lives here rather than in the draft room because a rule enforced
-- only in a component is a rule that holds until somebody has a slow network
-- and presses twice. The room still shows it — being refused by the database
-- is the backstop, not the interface.
--
-- Three things had to change for the database to be able to enforce it at all,
-- because until now nothing in Postgres knew what anybody played:
--
--   * make_pick takes the position and writes it onto the roster row. That is
--     worth having on its own — roster_slots.position was filled in later, by
--     the score refresh, so a player drafted thirty seconds ago had no
--     position and could not be counted.
--   * draft_queue carries a position too, so a queue full of quarterbacks can
--     be skipped past at autodraft without leaving the lock to ask the app.
--   * the caps themselves are a league setting, like every other rule here, so
--     the rules page reads them rather than repeating them.
--
-- A league mid-draft when this lands will have older picks with no position
-- recorded; those are not counted until the next score refresh fills them in.
-- The alternative is refusing legal picks over a column the database has never
-- had, which is the worse of the two.

alter table draft_queue
  add column if not exists position text;

comment on column draft_queue.position is
  'What the queued player plays, in the league''s own vocabulary. Written by '
  'the app, which owns the pool. Null on rows queued before 0043.';

-- The rule this league is asking for. Written onto every league that has not
-- already said something, so an existing draft is governed the same as a new
-- one — and left alone where a commissioner has set their own.
update leagues
   set settings = jsonb_set(
         coalesce(settings, '{}'::jsonb),
         '{positionCaps}',
         '{"QB": 4, "D/ST": 2, "K": 2}'::jsonb,
         true)
 where settings -> 'positionCaps' is null;

/**
 * Why this manager may not draft another of this position, or null if they may.
 *
 * The sentence rather than a boolean, so the room, the button and the database
 * error all say the same thing in the same words.
 */
create or replace function draft_cap_block(
  p_league_id  uuid,
  p_manager_id uuid,
  p_position   text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cap  int;
  v_held int;
begin
  if p_position is null or p_position = '' then return null; end if;

  select (settings -> 'positionCaps' ->> p_position)::int into v_cap
    from leagues where id = p_league_id;

  if v_cap is null then return null; end if;

  select count(*) into v_held
    from roster_slots
   where league_id = p_league_id
     and manager_id = p_manager_id
     and position = p_position;

  if v_held < v_cap then return null; end if;

  if v_cap = 0 then
    return format('No %s may be drafted in this league.', p_position);
  end if;

  return format('You already have %s %s%s — the limit is %s.',
                v_held, p_position, case when v_held = 1 then '' else 's' end, v_cap);
end;
$$;

revoke all on function draft_cap_block(uuid, uuid, text) from public;
grant execute on function draft_cap_block(uuid, uuid, text) to authenticated;

-- The signature changes, so the old one goes rather than sitting beside it:
-- two make_picks differing only by a defaulted argument is a call nobody can
-- resolve.
drop function if exists make_pick(uuid, text, uuid);

/**
 * Makes a pick. Unchanged from 0003 but for the position, which is now
 * recorded on the roster row and checked against the league's caps.
 */
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
  v_block    text;
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

  -- The league's own limit on how many of a position one roster may hold.
  -- Checked inside the lock, so two browsers cannot both be told yes.
  v_block := draft_cap_block(p_league_id, v_actor, p_position);
  if v_block is not null then
    raise exception '%', v_block using errcode = '55000';
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

drop function if exists set_draft_queue(uuid, text[]);

/**
 * Replaces this manager's queue, now carrying what each player plays so the
 * autodraft can skip past a position the roster is already full at without
 * leaving the lock to ask the app.
 */
create or replace function set_draft_queue(
  p_league_id uuid,
  p_players   text[],
  p_positions text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    managers;
  v_given int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  v_given := coalesce(array_length(p_players, 1), 0);
  if v_given > 150 then
    raise exception 'A queue holds at most 150 players, not %', v_given
      using errcode = '22023';
  end if;

  if p_positions is not null
     and coalesce(array_length(p_positions, 1), 0) <> v_given then
    raise exception 'A position for each player, or none at all'
      using errcode = '22023';
  end if;

  delete from draft_queue
   where league_id = p_league_id and manager_id = v_me.id;

  if v_given > 0 then
    insert into draft_queue (league_id, manager_id, player_name, rank, position)
    select p_league_id, v_me.id, u.name, u.ord,
           case when p_positions is null then null
                else nullif(p_positions[u.ord], '') end
      from unnest(p_players) with ordinality as u(name, ord)
     where u.name is not null and length(btrim(u.name)) > 0
    on conflict (manager_id, player_name) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'count', (select count(*) from draft_queue
               where league_id = p_league_id and manager_id = v_me.id)
  );
end;
$$;

revoke all on function set_draft_queue(uuid, text[], text[]) from public;
grant execute on function set_draft_queue(uuid, text[], text[]) to authenticated;

/**
 * Autodraft, now refusing to breach a cap on either of its two answers.
 *
 * The queue is skipped past rather than stopped at: a manager who queued five
 * quarterbacks and went to bed asked for the best of them, and the fifth is
 * not a reason to fall through to a stranger — the first one that is legal is
 * still their own decision. A queued player whose position was never recorded
 * (queued before 0043) is taken as before rather than skipped, because
 * refusing somebody's queue over a column that did not exist when they filled
 * it is the worse failure.
 *
 * The fallback is worked out in the app, which already refuses to stack a
 * position past what a roster can use — but it is checked here too, because
 * "the caller is sensible" is not an enforcement.
 *
 * p_fallback_position is what that fallback plays, so the roster row records
 * it at once rather than waiting for the next score refresh.
 */
drop function if exists autodraft_expired(uuid, text);

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

  -- The manager's own queue first, skipping anyone already taken and anyone
  -- their roster has no room left for.
  select q.player_name, q.position into v_name, v_position
    from draft_queue q
   where q.manager_id = v_pick.manager_id
     and not exists (
       select 1 from roster_slots r
        where r.league_id = p_league_id and r.player_name = q.player_name
     )
     and draft_cap_block(p_league_id, v_pick.manager_id, q.position) is null
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

  -- And the cap, on whichever of the two answers this turned out to be. A
  -- background job that breaks a league rule is worse than one that reports
  -- having nothing legal to take.
  if draft_cap_block(p_league_id, v_pick.manager_id, v_position) is not null then
    return jsonb_build_object('ok', false, 'reason', 'position full');
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
