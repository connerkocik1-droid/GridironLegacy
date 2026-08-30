-- Trade execution.
--
-- A trade moves players between two rosters. That has to be one atomic step:
-- if it half-applied, a player would be on both rosters or on neither. The
-- Supabase client cannot open a transaction, so execution lives here as a
-- single function and the API only ever calls this.

-- Who proposed, who received, and what each side sends. `offer` is
--   { "give": ["Player A", …], "get": ["Player B", …] }
-- where `give` leaves from_manager and `get` leaves to_manager.

create or replace function execute_trade(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade      trades;
  v_me         managers;
  v_give       text[];
  v_get        text[];
  v_moved      int;
  v_expected   int;
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

  v_give := coalesce(array(select jsonb_array_elements_text(v_trade.offer -> 'give')), '{}');
  v_get  := coalesce(array(select jsonb_array_elements_text(v_trade.offer -> 'get')),  '{}');

  if array_length(v_give, 1) is null and array_length(v_get, 1) is null then
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
    'get', to_jsonb(v_get)
  );
end;
$$;

revoke all on function execute_trade(uuid) from public;
grant execute on function execute_trade(uuid) to authenticated;

-- Accepting is the only field a counterparty may flip, and changing the terms
-- must void both acceptances. Doing that in a trigger means a client cannot
-- accept on one set of terms and have them swapped underneath.
create or replace function void_acceptance_on_change()
returns trigger
language plpgsql
as $$
begin
  if new.offer is distinct from old.offer then
    new.from_accepted := false;
    new.to_accepted := false;
    new.status := 'countered';
  end if;
  return new;
end;
$$;

create trigger trades_void_acceptance
  before update on trades
  for each row
  execute function void_acceptance_on_change();
