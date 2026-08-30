-- Sign-in attempt log, so a four-digit PIN cannot be walked in a loop.
--
-- A four-digit PIN is 10,000 possibilities: fine for a league of friends,
-- trivial to brute-force without this.

create table pin_attempts (
  id bigserial primary key,
  league_id uuid not null references leagues(id) on delete cascade,
  slot text not null,
  succeeded boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index pin_attempts_recent_idx on pin_attempts (league_id, slot, attempted_at desc);

alter table pin_attempts enable row level security;
-- Written only by the sign-in route, which holds the service key. No browser
-- session may read or forge an attempt record.

/**
 * How many failed attempts a slot has made since the last success, within the
 * window. The sign-in route locks the slot out once this passes the limit.
 */
create or replace function recent_pin_failures(
  p_league_id uuid,
  p_slot text,
  p_window interval default interval '15 minutes'
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from pin_attempts
   where league_id = p_league_id
     and slot = p_slot
     and not succeeded
     and attempted_at > now() - p_window
     and attempted_at > coalesce(
       (select max(attempted_at) from pin_attempts
         where league_id = p_league_id and slot = p_slot and succeeded),
       '-infinity'::timestamptz
     );
$$;

/**
 * Clears a manager's PIN. The commissioner calls this; it does not set a new
 * PIN, it forces the manager to choose one on next sign-in.
 *
 * This shape matters: if a commissioner could set another manager's PIN, they
 * could sign in as any team in the league.
 */
create or replace function clear_pin(p_manager_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner then
    raise exception 'Only the commissioner can reset a PIN' using errcode = '42501';
  end if;

  update managers
     set pin_hash = null
   where id = p_manager_id
     and league_id = v_me.league_id;

  if not found then
    raise exception 'No such manager in your league' using errcode = 'P0002';
  end if;

  insert into admin_log (league_id, actor, action, detail)
  values (v_me.league_id, v_me.id, 'pin_cleared',
          jsonb_build_object('manager_id', p_manager_id));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function clear_pin(uuid) from public;
grant execute on function clear_pin(uuid) to authenticated;
