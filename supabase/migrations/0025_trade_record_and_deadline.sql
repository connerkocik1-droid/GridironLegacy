-- Trades leave a mark, and they stop at the deadline.
--
-- Two gaps that turned out to be the same function.
--
-- The transactions table has said since 0007 that it holds "every roster
-- change, so 'where did he go?' has an answer", and its `kind` has always
-- allowed 'trade'. Nothing ever wrote one. Adds, drops and waiver claims are
-- recorded; the largest roster change of all was not, so the one table that
-- exists to answer that question could not answer it about a trade.
--
-- And a trade could be accepted in week seventeen. Every real league has a
-- deadline, for the obvious reason: a franchise with nothing to play for can
-- otherwise hand its season to a friend in the middle of somebody else's
-- playoff race. There was no guard at all.
--
-- The draft is deliberately NOT written here. Every pick is already on the
-- board, permanently and in order, and 288 rows of draft night would bury the
-- season's actual comings and goings in the feed that reads this table.

/**
 * The week the league is playing.
 *
 * The first week still to be settled, or the last one on the schedule when
 * they are all done. The same rule the home page uses, stated once here so
 * that a deadline and a scoreboard cannot disagree about what week it is.
 */
create or replace function current_week(p_league_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select min(week) from matchups where league_id = p_league_id and not final),
    (select max(week) from matchups where league_id = p_league_id),
    1
  );
$$;

revoke all on function current_week(uuid) from public;
grant execute on function current_week(uuid) to authenticated;

/**
 * The last week a trade may go through.
 *
 * Defaults to two weeks before the regular season ends, which is roughly where
 * the NFL puts its own and leaves the run-in to be played by the teams that
 * earned it. A league that wants no deadline sets tradeDeadlineWeek to 0.
 */
create or replace function trade_deadline_week(p_league_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (settings ->> 'tradeDeadlineWeek')::int,
    greatest(1, coalesce((settings ->> 'regularWeeks')::int, 13) - 2)
  )
  from leagues where id = p_league_id;
$$;

revoke all on function trade_deadline_week(uuid) from public;
grant execute on function trade_deadline_week(uuid) to authenticated;

/**
 * Refuses an offer that could never be executed.
 *
 * The deadline is enforced in execute_trade, which is what actually matters.
 * This is so that nobody spends an evening negotiating a deal the database
 * was always going to refuse — a trap is worse than a rule.
 *
 * Keyed on the ROLE like guard_trade_acceptance, and for the same reason: a
 * definer function runs as its owner, so anything arriving other than as a
 * browser session is past this deliberately.
 */
create or replace function guard_trade_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_deadline int;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;

  v_deadline := trade_deadline_week(new.league_id);
  if v_deadline > 0 and current_week(new.league_id) > v_deadline then
    raise exception 'The trade deadline passed in week %', v_deadline
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists trades_deadline on trades;
create trigger trades_deadline
  before insert on trades
  for each row execute function guard_trade_deadline();

/**
 * Trade execution, re-emitted from 0021 for the deadline and the record.
 *
 * Everything about who may execute, what must still be held, and what moves
 * is unchanged. What is new is the refusal past the deadline, and a row in
 * transactions for every player and every pick that changed hands.
 *
 * The transaction rows are written against the manager who RECEIVED each
 * asset, because that is the question the log is asked: not "what did this
 * trade contain" — the trade itself says that — but "how did he end up on
 * that roster". The franchise on the other side is stored by name as well as
 * by id, so the answer survives a franchise being renamed or released.
 */
create or replace function execute_trade(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade       trades;
  v_me          managers;
  v_give        text[];
  v_get         text[];
  v_give_picks  uuid[];
  v_get_picks   uuid[];
  v_untradeable text;
  v_moved       int;
  v_expected    int;
  v_deadline    int;
  v_from_name   text;
  v_to_name     text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  -- Lock the row for the duration, so two managers hitting accept at the same
  -- moment cannot both execute the same trade.
  select * into v_trade from trades where id = p_trade_id for update;
  if v_trade.id is null then
    raise exception 'No such trade' using errcode = 'P0002';
  end if;

  if v_me.id <> v_trade.from_manager and v_me.id <> v_trade.to_manager then
    raise exception 'Not your trade' using errcode = '42501';
  end if;

  if v_trade.status = 'executed' then
    raise exception 'This trade has already been executed' using errcode = '55000';
  end if;

  if not (v_trade.from_accepted and v_trade.to_accepted) then
    raise exception 'Both managers must accept first' using errcode = '55000';
  end if;

  -- Checked at execution rather than only at the offer, because an offer can
  -- sit unanswered for a fortnight and the deadline is about when the players
  -- actually move.
  v_deadline := trade_deadline_week(v_trade.league_id);
  if v_deadline > 0 and current_week(v_trade.league_id) > v_deadline then
    raise exception 'The trade deadline passed in week %', v_deadline
      using errcode = '55000';
  end if;

  v_give := coalesce(array(select jsonb_array_elements_text(v_trade.offer -> 'give')), '{}');
  v_get  := coalesce(array(select jsonb_array_elements_text(v_trade.offer -> 'get')),  '{}');

  v_give_picks := coalesce(
    array(select (jsonb_array_elements_text(v_trade.offer -> 'givePicks'))::uuid), '{}');
  v_get_picks := coalesce(
    array(select (jsonb_array_elements_text(v_trade.offer -> 'getPicks'))::uuid), '{}');

  if array_length(v_give, 1) is null and array_length(v_get, 1) is null
     and array_length(v_give_picks, 1) is null and array_length(v_get_picks, 1) is null then
    raise exception 'An empty trade cannot be executed' using errcode = '55000';
  end if;

  -- The rosters may have changed since the offer was made. Every player named
  -- must still be owned by the side that promised him, or the whole trade is
  -- void — never a partial move.
  v_expected := coalesce(array_length(v_give, 1), 0);
  select count(*) into v_moved
  from roster_slots
  where league_id = v_trade.league_id
    and manager_id = v_trade.from_manager
    and player_name = any (v_give);

  if v_moved <> v_expected then
    raise exception 'A player in this offer is no longer on the proposing roster'
      using errcode = '55000';
  end if;

  v_expected := coalesce(array_length(v_get, 1), 0);
  select count(*) into v_moved
  from roster_slots
  where league_id = v_trade.league_id
    and manager_id = v_trade.to_manager
    and player_name = any (v_get);

  if v_moved <> v_expected then
    raise exception 'A player in this offer is no longer on the receiving roster'
      using errcode = '55000';
  end if;

  -- The same test for picks, on both sides.
  v_expected := coalesce(array_length(v_give_picks, 1), 0);
  select count(*) into v_moved
  from draft_pick_assets
  where league_id = v_trade.league_id
    and manager_id = v_trade.from_manager
    and id = any (v_give_picks);

  if v_moved <> v_expected then
    raise exception 'A pick in this offer is no longer held by the proposing franchise'
      using errcode = '55000';
  end if;

  v_expected := coalesce(array_length(v_get_picks, 1), 0);
  select count(*) into v_moved
  from draft_pick_assets
  where league_id = v_trade.league_id
    and manager_id = v_trade.to_manager
    and id = any (v_get_picks);

  if v_moved <> v_expected then
    raise exception 'A pick in this offer is no longer held by the receiving franchise'
      using errcode = '55000';
  end if;

  -- The inaugural draft is not currency. Checked here as well as when the
  -- offer is made, because a season can only become untradeable, never the
  -- other way round, and the offer may be days old.
  select string_agg(distinct a.season::text, ', ' order by a.season::text)
    into v_untradeable
    from draft_pick_assets a
   where a.id = any (v_give_picks || v_get_picks)
     and not picks_are_tradeable(a.league_id, a.season);

  if v_untradeable is not null then
    raise exception 'Picks for the % draft cannot be traded', v_untradeable
      using errcode = '55000';
  end if;

  select franchise into v_from_name from managers where id = v_trade.from_manager;
  select franchise into v_to_name   from managers where id = v_trade.to_manager;

  -- The move itself. Players land on the bench: a lineup slot on one roster
  -- means nothing on another, and the new owner sets it.
  update roster_slots
     set manager_id = v_trade.to_manager,
         acquired = 'trade',
         lineup_slot = 'BENCH'
   where league_id = v_trade.league_id
     and manager_id = v_trade.from_manager
     and player_name = any (v_give);

  update roster_slots
     set manager_id = v_trade.from_manager,
         acquired = 'trade',
         lineup_slot = 'BENCH'
   where league_id = v_trade.league_id
     and manager_id = v_trade.to_manager
     and player_name = any (v_get);

  -- Only the holder changes. origin_manager stays put, so the pick keeps
  -- falling where the record that produced it says it should.
  update draft_pick_assets
     set manager_id = v_trade.to_manager
   where league_id = v_trade.league_id
     and id = any (v_give_picks);

  update draft_pick_assets
     set manager_id = v_trade.from_manager
   where league_id = v_trade.league_id
     and id = any (v_get_picks);

  -- One row per asset, filed under whoever received it.
  insert into transactions (league_id, manager_id, kind, player_name, detail)
  select v_trade.league_id, v_trade.to_manager, 'trade', p,
         jsonb_build_object('tradeId', p_trade_id, 'fromManager', v_trade.from_manager,
                            'fromFranchise', v_from_name)
    from unnest(v_give) p;

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  select v_trade.league_id, v_trade.from_manager, 'trade', p,
         jsonb_build_object('tradeId', p_trade_id, 'fromManager', v_trade.to_manager,
                            'fromFranchise', v_to_name)
    from unnest(v_get) p;

  -- Picks are named rather than identified, because a pick's id means nothing
  -- to a reader and the season and round mean everything. `pick` marks them so
  -- nothing downstream mistakes the name for a footballer.
  insert into transactions (league_id, manager_id, kind, player_name, detail)
  select v_trade.league_id, v_trade.to_manager, 'trade',
         a.season || ' round ' || a.round || ' pick',
         jsonb_build_object('tradeId', p_trade_id, 'pick', true,
                            'fromManager', v_trade.from_manager,
                            'fromFranchise', v_from_name)
    from draft_pick_assets a where a.id = any (v_give_picks);

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  select v_trade.league_id, v_trade.from_manager, 'trade',
         a.season || ' round ' || a.round || ' pick',
         jsonb_build_object('tradeId', p_trade_id, 'pick', true,
                            'fromManager', v_trade.to_manager,
                            'fromFranchise', v_to_name)
    from draft_pick_assets a where a.id = any (v_get_picks);

  update trades
     set status = 'executed',
         executed_at = now()
   where id = p_trade_id;

  -- A traded player is no longer on offer.
  delete from trade_block
   where league_id = v_trade.league_id
     and player_name = any (v_give || v_get);

  insert into admin_log (league_id, actor, action, detail)
  values (v_trade.league_id, v_me.id, 'trade_executed',
          jsonb_build_object('trade_id', p_trade_id, 'offer', v_trade.offer));

  return jsonb_build_object(
    'ok', true,
    'trade_id', p_trade_id,
    'give', to_jsonb(v_give),
    'get', to_jsonb(v_get),
    'givePicks', to_jsonb(v_give_picks),
    'getPicks', to_jsonb(v_get_picks)
  );
end;
$$;

revoke all on function execute_trade(uuid) from public;
grant execute on function execute_trade(uuid) to authenticated;
