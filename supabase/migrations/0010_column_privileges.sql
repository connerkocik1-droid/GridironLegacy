-- Closing three privilege escalations.
--
-- Row-level security says which ROWS you may touch. It says nothing about
-- which COLUMNS. Every policy here was correct about the row and silent about
-- the rest, which left a signed-in manager able to rewrite fields the app
-- never exposes — straight from a browser console with the anon key, since
-- that is all a Supabase client needs.
--
--   1. managers      — set is_commissioner on your own row and you are the
--                      commissioner. Also waiver_priority, and pin_hash.
--   2. roster_slots  — rewrite player_name on a row you own and you have
--                      signed any free agent, no waiver claim needed.
--   3. trades        — set both acceptance flags on a trade you are party to
--                      and execute_trade() will move the players, though the
--                      other manager never agreed.
--
-- The fix for the first two is column-level grants: Postgres can restrict
-- UPDATE to named columns, which is exactly the missing half. The third needs
-- to compare old and new, so it is a trigger.

-- --------------------------------------------------------------- managers ---
-- A manager owns their display name and their franchise name. Everything else
-- about them — who is commissioner, waiver order, the PIN hash, which auth
-- user they are — is set by the signup route or a commissioner function, both
-- of which hold the service key and are unaffected by these grants.

revoke update on managers from authenticated, anon;
grant update (name, franchise) on managers to authenticated;

-- ----------------------------------------------------------- roster_slots ---
-- A manager sets who starts. Which players are on the roster is decided by the
-- draft, a trade or a waiver claim — never by editing the row.

revoke update on roster_slots from authenticated, anon;
grant update (lineup_slot) on roster_slots to authenticated;

-- ----------------------------------------------------------------- trades ---
/**
 * Nobody accepts on somebody else's behalf.
 *
 * Both managers in a trade can update the row — that is how countering and
 * accepting work — so the row policy cannot tell a legitimate acceptance from
 * forging the other side's. Comparing old to new can.
 *
 * The guard keys on the ROLE, not on auth.uid(). A SECURITY DEFINER function
 * runs as its owner while auth.uid() still reports the caller, so keying on
 * the identity would fire inside execute_trade() and block the very update it
 * exists to make. current_user cannot be changed by a client.
 */
-- Deliberately NOT security definer: a definer function would run as its own
-- owner, so current_user inside it would never be the caller's role and the
-- check below could never fire. As an invoker trigger it runs as whoever is
-- updating, which is the whole point.
create or replace function guard_trade_acceptance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me uuid;
begin
  -- Anything not arriving as a browser session — the service key, or a
  -- definer function such as execute_trade — is past this.
  if current_user not in ('authenticated', 'anon') then return new; end if;

  select id into v_me from managers where auth_user_id = auth.uid();
  if v_me is null then return new; end if;

  if v_me = new.from_manager and new.to_accepted is distinct from old.to_accepted then
    raise exception 'You cannot accept on the other manager''s behalf'
      using errcode = '42501';
  end if;

  if v_me = new.to_manager and new.from_accepted is distinct from old.from_accepted then
    raise exception 'You cannot accept on the other manager''s behalf'
      using errcode = '42501';
  end if;

  -- Only execute_trade() marks a trade executed, and it checks both
  -- acceptances first. Letting a party set it directly would either fake a
  -- completed deal or block a real one from ever running.
  if new.status = 'executed' and old.status is distinct from 'executed' then
    raise exception 'A trade is executed by accepting it, not by setting its status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trades_guard_acceptance on trades;
create trigger trades_guard_acceptance
  before update on trades
  for each row execute function guard_trade_acceptance();

-- execute_trade() runs as its definer and sets the status itself, so it must
-- not trip the guard above. It is the only path that may.
create or replace function execute_trade(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade   trades;
  v_give    text[];
  v_get     text[];
  v_player  text;
begin
  select * into v_trade from trades where id = p_trade_id for update;
  if v_trade.id is null then
    raise exception 'No such trade' using errcode = 'P0002';
  end if;

  if v_trade.status = 'executed' then
    raise exception 'This trade has already been executed' using errcode = '55000';
  end if;

  if not (v_trade.from_accepted and v_trade.to_accepted) then
    raise exception 'Both managers must accept first' using errcode = '55000';
  end if;

  v_give := array(select jsonb_array_elements_text(v_trade.offer -> 'give'));
  v_get  := array(select jsonb_array_elements_text(v_trade.offer -> 'get'));

  -- Every player must still be where the offer says, or nothing moves.
  foreach v_player in array v_give loop
    if not exists (
      select 1 from roster_slots
       where league_id = v_trade.league_id
         and manager_id = v_trade.from_manager
         and player_name = v_player
    ) then
      raise exception 'A player in this offer is no longer on the proposing roster'
        using errcode = '55000';
    end if;
  end loop;

  foreach v_player in array v_get loop
    if not exists (
      select 1 from roster_slots
       where league_id = v_trade.league_id
         and manager_id = v_trade.to_manager
         and player_name = v_player
    ) then
      raise exception 'A player in this offer is no longer on the receiving roster'
        using errcode = '55000';
    end if;
  end loop;

  update roster_slots
     set manager_id = v_trade.to_manager, acquired = 'trade', lineup_slot = 'BENCH'
   where league_id = v_trade.league_id
     and manager_id = v_trade.from_manager
     and player_name = any (v_give);

  update roster_slots
     set manager_id = v_trade.from_manager, acquired = 'trade', lineup_slot = 'BENCH'
   where league_id = v_trade.league_id
     and manager_id = v_trade.to_manager
     and player_name = any (v_get);

  -- The guard lets this through: this runs as the function owner, not as the
  -- authenticated role.
  update trades
     set status = 'executed', executed_at = now()
   where id = p_trade_id;

  delete from trade_block
   where league_id = v_trade.league_id
     and player_name = any (v_give || v_get);

  return jsonb_build_object(
    'ok', true, 'trade_id', p_trade_id, 'give', v_give, 'get', v_get
  );
end;
$$;

revoke all on function execute_trade(uuid) from public;
grant execute on function execute_trade(uuid) to authenticated;
