-- The two draft settings that were readable and not settable, and the clock.
--
-- The room has always counted down from settings.pickSeconds and shown the
-- cinematic reveal for settings.cinematicRounds rounds. Nothing ever wrote
-- either: they were whatever the seed left behind, and changing them meant a
-- SQL console. Those two live in the settings blob, which a session may
-- already write, so they need no function here — only a place in the league
-- office.
--
-- These two do need one. The draft order lives in leagues.lottery_order and
-- the clock in leagues.pick_started_at, and 0011 took the leagues row away
-- from browser sessions except for settings and the draft date. That was the
-- right call and it stands; what follows is the narrow, checked way through.

/**
 * Sets the order franchises pick in, and redraws the board to match.
 *
 * Takes franchise slots rather than ids because that is what lottery_order
 * holds and what a commissioner reads on the screen. Every franchise must
 * appear exactly once — a list that quietly drops one would leave a board with
 * a seat missing and nobody would notice until draft night.
 */
create or replace function set_draft_order(p_league_id uuid, p_slots text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     managers;
  v_count  int;
  v_given  int;
  v_made   int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can set the draft order'
      using errcode = '42501';
  end if;

  select count(*) into v_made
    from draft_picks
   where league_id = p_league_id and player_name is not null;

  if v_made > 0 then
    raise exception 'The draft has already started — the order is fixed now'
      using errcode = '55000';
  end if;

  select count(*) into v_count from managers where league_id = p_league_id;
  v_given := coalesce(array_length(p_slots, 1), 0);

  if v_given <> v_count then
    raise exception 'The order must list all % franchises, not %', v_count, v_given
      using errcode = '22023';
  end if;

  -- Every slot named must exist here, and none of them twice. Checked by
  -- counting the matches rather than trusting the list.
  if (
    select count(distinct m.slot) from managers m
     where m.league_id = p_league_id and m.slot = any (p_slots)
  ) <> v_count then
    raise exception 'That order does not name this league''s franchises'
      using errcode = '22023';
  end if;

  update leagues set lottery_order = p_slots where id = p_league_id;

  -- The board is drawn from the order, so it is redrawn now rather than left
  -- for somebody to remember.
  perform rebuild_draft_board(p_league_id);

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'draft_order',
          jsonb_build_object('order', to_jsonb(p_slots)));

  return jsonb_build_object('ok', true, 'order', to_jsonb(p_slots));
end;
$$;

revoke all on function set_draft_order(uuid, text[]) from public;
grant execute on function set_draft_order(uuid, text[]) to authenticated;

/**
 * Gives the manager on the clock more time, or less.
 *
 * Moving pick_started_at forward is the same as adding time, because the
 * deadline is derived from it. It is the only honest way to do this: the
 * countdown every browser draws is that instant plus the clock, so anything
 * else would have twelve people watching a number that no longer decides
 * anything.
 *
 * Only while the draft is running — there is no clock to extend otherwise —
 * and never so far back that the pick expires the moment it is granted.
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

  v_limit := coalesce((v_league.settings ->> 'pickSeconds')::int, 90);
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
