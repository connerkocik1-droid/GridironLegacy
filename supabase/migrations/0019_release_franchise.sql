-- When somebody quits.
--
-- Not the same as removing a franchise. Shrinking the league renumbers the
-- board and rewrites the schedule, which is a different league; a manager
-- walking away in September should change none of that. The franchise stays
-- exactly where it is — same name, same roster, same fixtures — and only the
-- person is let go, leaving a seat somebody else can take.
--
-- clear_pin already existed for the manager who has forgotten theirs. This is
-- not that, and the difference is the auth link. Clearing a PIN leaves
-- auth_user_id in place, so the browser the departing manager left signed in
-- still resolves to that franchise and can still make its picks. Letting
-- somebody go has to break that link, or they have not gone.

/**
 * Hands a franchise back: the person goes, the team stays.
 *
 * Kept: the franchise name, the roster, the division, the fixtures, and every
 * pick already made. A replacement inherits a team rather than an empty seat,
 * and can rename it from their own profile if they want to.
 *
 * Cleared: the PIN, the sign-in link, the manager's name, and the ready flag.
 *
 * Returns the auth user that was attached, because deleting it is the caller's
 * job — the address it was created under is derived from the franchise slot,
 * so leaving it behind would block whoever claims the franchise next.
 */
create or replace function release_franchise(p_manager_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   managers;
  v_them managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner then
    raise exception 'Only the commissioner can release a franchise'
      using errcode = '42501';
  end if;

  select * into v_them
    from managers
   where id = p_manager_id and league_id = v_me.league_id;

  if v_them.id is null then
    raise exception 'No such franchise in your league' using errcode = 'P0002';
  end if;

  -- The office is found by its holder's sign-in link. Breaking your own is
  -- how a league ends up with commissioner controls nobody can reach.
  if v_them.is_commissioner then
    raise exception 'The commissioner cannot release their own franchise'
      using errcode = '55000';
  end if;

  if v_them.pin_hash is null and v_them.auth_user_id is null then
    raise exception 'Nobody holds that franchise' using errcode = '55000';
  end if;

  update managers
     set pin_hash = null,
         auth_user_id = null,
         name = 'Open',
         ready = false
   where id = p_manager_id;

  insert into admin_log (league_id, actor, action, detail)
  values (v_me.league_id, v_me.id, 'franchise_released',
          jsonb_build_object('manager_id', p_manager_id,
                             'slot', v_them.slot,
                             'franchise', v_them.franchise,
                             'was', v_them.name));

  return jsonb_build_object(
    'ok', true,
    'slot', v_them.slot,
    'franchise', v_them.franchise,
    'was', v_them.name,
    'authUserId', v_them.auth_user_id
  );
end;
$$;

revoke all on function release_franchise(uuid) from public;
grant execute on function release_franchise(uuid) to authenticated;
