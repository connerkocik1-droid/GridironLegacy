-- A clock that shortens as the draft goes on, a queue you can actually set,
-- and a switch that drafts for you.
--
-- Three things that belong together, because they are the same evening. Ninety
-- seconds is right for the first round and absurd for the fourteenth, by which
-- point the room is picking kickers and waiting on a clock nobody is using.
-- The queue has existed since 0003 and no screen has ever written to it, so the
-- autodraft it was built to feed has never had anything to read. And a manager
-- who cannot be there ought to be able to say so, rather than leaving eleven
-- people to sit out their clock every round.

-- ------------------------------------------------------------ the clock ---

/**
 * How long the pick in a given round gets.
 *
 * The tiers live in settings.pickClock as an ordered array — the first tier
 * whose throughRound covers the round wins, and a tier with a null
 * throughRound covers everything after it:
 *
 *   [{"throughRound": 4, "seconds": 90},
 *    {"throughRound": 10, "seconds": 75},
 *    {"throughRound": null, "seconds": 60}]
 *
 * A league from before this migration has only settings.pickSeconds, a single
 * number for the whole draft, so that is the fallback — and ninety seconds
 * behind that, because a draft with no clock at all is a draft that never
 * advances past the first person who walks away from their laptop.
 *
 * Malformed entries are skipped rather than raised on. This is read on the
 * path that makes a pick, and a typo in a settings blob must not be able to
 * stop a draft.
 */
create or replace function pick_seconds_for(p_settings jsonb, p_round int)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  v_round    int := greatest(1, coalesce(p_round, 1));
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_tier     jsonb;
  v_through  text;
  v_seconds  text;
  v_legacy   text;
begin
  if jsonb_typeof(v_settings -> 'pickClock') = 'array' then
    for v_tier in select * from jsonb_array_elements(v_settings -> 'pickClock') loop
      if jsonb_typeof(v_tier) <> 'object' then continue; end if;

      -- A nought is a typo, not a clock, so the tier is skipped rather than
      -- clamped up to five seconds. draft-clock.ts skips it for the same
      -- reason, and the two have to agree: one draws the countdown and the
      -- other decides when the pick is taken.
      v_seconds := v_tier ->> 'seconds';
      if v_seconds is null or v_seconds !~ '^[0-9]+$' or v_seconds::int <= 0 then
        continue;
      end if;

      v_through := v_tier ->> 'throughRound';
      if v_through is null then
        return least(600, greatest(5, v_seconds::int));
      end if;
      if v_through ~ '^[0-9]+$' and v_through::int >= v_round then
        return least(600, greatest(5, v_seconds::int));
      end if;
    end loop;
  end if;

  v_legacy := v_settings ->> 'pickSeconds';
  if v_legacy is not null and v_legacy ~ '^[0-9]+$' and v_legacy::int > 0 then
    return least(600, greatest(5, v_legacy::int));
  end if;

  return 90;
end;
$$;

grant execute on function pick_seconds_for(jsonb, int) to authenticated, anon;

-- Every league that has not been told otherwise gets the tiers the league
-- asked for. A league already carrying a pickClock is left alone; one carrying
-- only the old single pickSeconds is moved onto the tiers, which is the point
-- of the change rather than a side effect of it.
update leagues
   set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
         'pickClock', jsonb_build_array(
           jsonb_build_object('throughRound', 4,  'seconds', 90),
           jsonb_build_object('throughRound', 10, 'seconds', 75),
           jsonb_build_object('throughRound', null, 'seconds', 60)
         ))
 where jsonb_typeof(coalesce(settings, '{}'::jsonb) -> 'pickClock') is distinct from 'array';

/**
 * Gives the manager on the clock more time, or less.
 *
 * Re-emitted from 0018 for one reason: the limit it works against is now the
 * round's, not the league's. Everything else is as it was — moving
 * pick_started_at is still the only honest way to add time, because the
 * countdown twelve browsers are drawing is that instant plus the clock.
 */
create or replace function nudge_clock(p_league_id uuid, p_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      managers;
  v_league  leagues;
  v_round   int;
  v_limit   int;
  v_started timestamptz;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can change the clock' using errcode = '42501';
  end if;

  if p_seconds < -600 or p_seconds > 600 then
    raise exception 'Ten minutes either way is the most the clock moves'
      using errcode = '22003';
  end if;

  select * into v_league from leagues where id = p_league_id for update;

  if v_league.draft_state <> 'running' or v_league.pick_started_at is null then
    raise exception 'Nobody is on the clock' using errcode = '55000';
  end if;

  select round into v_round
    from draft_picks
   where league_id = p_league_id and overall = v_league.current_pick;

  v_limit := pick_seconds_for(v_league.settings, v_round);
  v_started := v_league.pick_started_at + make_interval(secs => p_seconds);

  -- Taking time away must not hand somebody an already-dead clock: the worst
  -- it can do is leave five seconds, which is a warning rather than a verdict.
  if v_started + make_interval(secs => v_limit) < now() + interval '5 seconds' then
    v_started := now() + interval '5 seconds' - make_interval(secs => v_limit);
  end if;

  update leagues set pick_started_at = v_started where id = p_league_id;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'clock_nudged', jsonb_build_object('seconds', p_seconds));

  return jsonb_build_object(
    'ok', true,
    'pickStartedAt', v_started,
    'remaining', extract(epoch from (v_started + make_interval(secs => v_limit) - now()))::int
  );
end;
$$;

revoke all on function nudge_clock(uuid, int) from public;
grant execute on function nudge_clock(uuid, int) to authenticated;

-- ------------------------------------------------------------ the queue ---

/**
 * Replaces a manager's draft queue with the list they just arranged.
 *
 * A whole-list write rather than add-one and remove-one, because a queue is
 * an order and every edit to it — dragging the fourth name to the top,
 * dropping the second — renumbers most of the rows anyway. One call, one
 * transaction, and the row policy on draft_queue is never asked to reason
 * about a half-applied reorder.
 *
 * Blank names are dropped and duplicates collapse to their first place in the
 * list, so the queue that comes back is always one that can be drafted from
 * top to bottom.
 */
create or replace function set_draft_queue(p_league_id uuid, p_players text[])
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

  delete from draft_queue
   where league_id = p_league_id and manager_id = v_me.id;

  if v_given > 0 then
    insert into draft_queue (league_id, manager_id, player_name, rank)
    select p_league_id, v_me.id, u.name, u.ord
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

revoke all on function set_draft_queue(uuid, text[]) from public;
grant execute on function set_draft_queue(uuid, text[]) to authenticated;

-- --------------------------------------------------------- the autodraft ---

-- A manager who will not be at the draft, saying so. Their own to set, like
-- ready is, and nobody else's: the column grant is the whole of what is needed
-- because managers_self_update already limits a session to its own row.
alter table managers
  add column if not exists autodraft boolean not null default false;

grant update (autodraft) on managers to authenticated;

/**
 * Picks for a manager who is not going to pick for themselves.
 *
 * Re-emitted from 0003, which fired on one condition — the clock has run out —
 * and worked against one league-wide clock. Two changes:
 *
 *   The clock is the round's now, so a fourteenth-round pick expires after a
 *   minute rather than after the ninety seconds the first round gets.
 *
 *   A manager who has switched autodraft on does not wait for a clock at all.
 *   That is the difference between "nobody is home" and "I told you I would
 *   not be": the second should not cost the other eleven a minute a round.
 *
 * The order of preference is unchanged and is the whole point of the queue:
 * the manager's own list first, skipping anyone already taken, and only then
 * the fallback the caller worked out. The fallback is passed in rather than
 * computed here because the player pool lives in the app, not the database.
 */
create or replace function autodraft_expired(p_league_id uuid, p_fallback text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league leagues;
  v_pick   draft_picks;
  v_name   text;
  v_auto   boolean;
  v_limit  int;
  v_reason text;
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
  select q.player_name into v_name
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
          jsonb_build_object('overall', v_pick.overall, 'player_name', v_name,
                             'reason', v_reason));

  return jsonb_build_object('ok', true, 'overall', v_pick.overall,
                            'player_name', v_name, 'reason', v_reason);
end;
$$;

revoke all on function autodraft_expired(uuid, text) from public;
