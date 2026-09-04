-- Draft night, in the order it actually happens.
--
-- The bug this fixes is the whole reason for it. Opening the room set
-- draft_state to 'running', and 'running' does two things at once: it tells
-- every browser the draft has begun, and it starts the pick clock. The room
-- plays the intro film on the same signal — so the clock and the film started
-- together, and by the time the film ended the first manager's ninety seconds
-- were gone and the autodraft had taken his pick. The commissioner's opening
-- act cost somebody their first-round selection.
--
-- The fix is to stop overloading one state with two meanings. Draft night now
-- has four:
--
--   pending   nothing has happened; the countdown is running
--   lobby     the room is open, the film plays, and then everybody waits
--   lottery   the order is being drawn on screen, last pick to first
--   running   round one, and only now the pick clock
--
-- Only 'running' carries a clock. Every guard in the draft — make_pick,
-- autodraft_expired, nudge_clock — already refuses unless the state is
-- 'running', so the two new states are safe by construction rather than by
-- anybody remembering to check them.

alter table leagues
  add column if not exists lottery_at timestamptz;

comment on column leagues.lottery_at is
  'When the draft lottery began. Every browser animates the reveal from this '
  'instant rather than from when its own page opened, so twelve managers watch '
  'the same spin land at the same moment — and a refresh halfway through '
  'rejoins where everyone else is rather than starting again.';

-- The set of states is now worth writing down. It has been a bare text column
-- since 0001, guarded only by the whitelist inside set_draft_state, and this
-- migration doubles the number of values it can hold.
alter table leagues
  drop constraint if exists leagues_draft_state_check;

alter table leagues
  add constraint leagues_draft_state_check
  check (draft_state in ('pending', 'lobby', 'lottery', 'running', 'paused', 'complete'));

/**
 * Starting, pausing and resuming the draft.
 *
 * Re-emitted from 0006 with the two new states, and with one change that is
 * the point of the whole migration: the clock is cleared for every state that
 * is not 'running'. It used to be cleared only on 'paused', which left a
 * live clock ticking behind the lobby and the lottery.
 */
create or replace function set_draft_state(p_league_id uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      managers;
  v_league  leagues;
  v_open    int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can control the draft' using errcode = '42501';
  end if;

  if p_state not in ('pending', 'lobby', 'lottery', 'running', 'paused', 'complete') then
    raise exception 'Unknown draft state %', p_state using errcode = '22023';
  end if;

  select * into v_league from leagues where id = p_league_id for update;

  if p_state = 'running' then
    select count(*) into v_open
      from draft_picks
     where league_id = p_league_id and player_name is null;

    if v_open = 0 then
      raise exception 'Every pick has been made' using errcode = '55000';
    end if;

    -- Resume from the first pick still open, so a board that was rebuilt or a
    -- draft that was paused mid-round picks up in the right place.
    update leagues
       set draft_state = 'running',
           current_pick = (
             select min(overall) from draft_picks
              where league_id = p_league_id and player_name is null
           ),
           -- The clock starts here and nowhere else. A paused draft must not
           -- resume onto an expired clock and autodraft whoever was on it,
           -- and a room that is merely open must not be running one at all.
           pick_started_at = now()
     where id = p_league_id;
  else
    update leagues
       set draft_state = p_state,
           -- Cleared for every state but 'running'. A clock that keeps time
           -- behind a screen nobody can pick from is the bug this migration
           -- exists to remove.
           pick_started_at = null
     where id = p_league_id;
  end if;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'draft_state', jsonb_build_object('to', p_state));

  return jsonb_build_object('ok', true, 'state', p_state);
end;
$$;

revoke all on function set_draft_state(uuid, text) from public;
grant execute on function set_draft_state(uuid, text) to authenticated;

/**
 * Draws the draft order, and starts the reveal.
 *
 * Drawn here rather than in a browser, which is where the league office has
 * always drawn it. That was fine for a commissioner setting an order in
 * advance; it is no use at all for a ceremony twelve people watch at once,
 * because twelve browsers shuffling independently would each land on a
 * different answer. One draw, on the server, written down before anybody sees
 * a thing.
 *
 * lottery_at is the starting gun. The animation is a function of how long ago
 * it was fired, so every screen is at the same point in the reveal and a
 * manager who refreshes mid-spin rejoins the others rather than starting over.
 *
 * The order itself is stored first pick first, as lottery_order always has
 * been. That the reveal runs backwards — last pick up to first, because the
 * first overall is the only one worth saving until the end — is the screen's
 * business, not the database's.
 */
create or replace function start_lottery(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     managers;
  v_league leagues;
  v_made   int;
  v_order  text[];
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can draw the lottery' using errcode = '42501';
  end if;

  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  -- Before the draft, and only before it. Redrawing while picks are on the
  -- board would renumber selections people have already made.
  select count(*) into v_made
    from draft_picks
   where league_id = p_league_id and player_name is not null;

  if v_made > 0 then
    raise exception 'The draft has already started — the order is fixed now'
      using errcode = '55000';
  end if;

  if v_league.draft_state not in ('pending', 'lobby', 'lottery') then
    raise exception 'The lottery is drawn before the draft, not during it'
      using errcode = '55000';
  end if;

  -- Unbiased: the sort key is drawn once per row, so every ordering is as
  -- likely as every other.
  select array_agg(slot order by random())
    into v_order
    from managers
   where league_id = p_league_id;

  if coalesce(array_length(v_order, 1), 0) = 0 then
    raise exception 'This league has no franchises to draw' using errcode = '55000';
  end if;

  update leagues
     set lottery_order   = v_order,
         draft_state     = 'lottery',
         lottery_at      = now(),
         -- Nothing is on the clock during a lottery.
         pick_started_at = null
   where id = p_league_id;

  -- The board is drawn from the order, so it is redrawn now rather than left
  -- for somebody to remember. rebuild_draft_board refuses once a pick has been
  -- made, which the check above has already ruled out.
  perform rebuild_draft_board(p_league_id);

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'draft_lottery',
          jsonb_build_object('order', to_jsonb(v_order)));

  return jsonb_build_object('ok', true, 'order', to_jsonb(v_order), 'at', now());
end;
$$;

revoke all on function start_lottery(uuid) from public;
grant execute on function start_lottery(uuid) to authenticated;
