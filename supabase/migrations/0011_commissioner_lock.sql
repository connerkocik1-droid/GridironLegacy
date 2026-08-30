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
