-- Catch-up: the two migrations added after your database was set up.
--
-- Your database was built before all-migrations.sql grew its tracking table,
-- so re-running that whole file fails on "relation leagues already exists".
-- This is only what is missing — 0010 and 0011 — and nothing else.
--
-- Paste the whole thing into the Supabase SQL editor and run it once.
-- It is wrapped in a transaction: if anything fails, nothing is applied.
--
-- Safe to run twice. Everything here is revoke/grant/create-or-replace, and
-- the trigger is dropped before it is created.

begin;


-- ======================================================================
-- 0010_column_privileges.sql
-- ======================================================================

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


-- ======================================================================
-- 0011_commissioner_lock.sql
-- ======================================================================

-- The league office belongs to one franchise, and to no other.
--
-- leagues.commissioner_slot already records which franchise that is — the seed
-- writes it, and it defaults to STL. But nothing enforced it: is_commissioner
-- was an ordinary boolean that happened to be set correctly once. Migration
-- 0010 stopped a manager writing it from a browser, which closed the way in,
-- but left the rule itself unstated.
--
-- Here it becomes an invariant. is_commissioner is not a field anyone sets; it
-- is derived from the franchise the league names, on every insert and update,
-- by whoever is asking — a browser session, the service key, a future
-- migration written carelessly. There is no path that can put the office
-- somewhere else.

/**
 * Forces is_commissioner to match the league's commissioner_slot.
 *
 * It overwrites rather than refuses on purpose: a refusal would make ordinary
 * writes fail for reasons the caller did not intend and probably cannot see —
 * renaming a franchise should not error because the row also carried a stale
 * flag. Overwriting means the invariant simply always holds.
 */
create or replace function enforce_commissioner_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot text;
begin
  select commissioner_slot into v_slot from leagues where id = new.league_id;

  -- A league that names nobody keeps whatever it has, so an existing league
  -- is not stripped of its commissioner by a null.
  if v_slot is null then return new; end if;

  new.is_commissioner := (new.slot = v_slot);
  return new;
end;
$$;

drop trigger if exists managers_commissioner_slot on managers;
create trigger managers_commissioner_slot
  before insert or update on managers
  for each row execute function enforce_commissioner_slot();

-- Bring any league already in flight into line with its own record.
update managers m
   set is_commissioner = (m.slot = l.commissioner_slot)
  from leagues l
 where l.id = m.league_id
   and l.commissioner_slot is not null
   and m.is_commissioner is distinct from (m.slot = l.commissioner_slot);

-- --------------------------------------------------------------- leagues ---
-- Moving the office means changing commissioner_slot, so that column must not
-- be writable from a browser either — otherwise the commissioner could hand
-- the league to themselves by another name, and the trigger above would
-- faithfully follow.
--
-- The two columns the app does write through a manager's own session are the
-- settings blob and the draft date. Everything else on the league row goes
-- through a security-definer function that checks who is asking.

revoke update on leagues from authenticated, anon;
grant update (settings, draft_at) on leagues to authenticated;

-- Changing who holds the office is deliberate, and done with the service key:
--
--   update leagues set commissioner_slot = 'BLZ';
--
-- The trigger moves is_commissioner to match on the next write to each
-- manager, so run this afterwards to apply it at once:
--
--   update managers m set is_commissioner = (m.slot = l.commissioner_slot)
--     from leagues l where l.id = m.league_id;


commit;

-- Check it took:
--
--   select slot, franchise, is_commissioner from managers order by slot;
--
-- Exactly one row should be true, and it should be Steel Cartel.
