-- ============================================================================
-- 0056 — a week is recapped once
--
-- The recap plays over the home screen the first time a manager opens the app
-- after the NFL week has ended. "The first time" is the whole feature: a
-- takeover that fires on every launch is not a recap, it is an obstacle.
--
-- So the app has to remember, per manager, which week they have already been
-- shown. One integer on the manager does it — there is exactly one recap per
-- week and they arrive in order, so the highest week seen is the whole state.
-- A table of rows would record the same thing at more cost and let the two
-- disagree.
-- ============================================================================

alter table managers
  add column if not exists recap_seen_week int;

comment on column managers.recap_seen_week is
  'The last week whose recap this manager has been shown. Null means none.';

/**
 * Mark this manager's recap as seen, up to and including a week.
 *
 * Only ever forward. Two tabs open on a Tuesday morning both dismiss the same
 * recap, and the second one must not be able to wind the marker back and make
 * the recap play again — and a manager reading back an old week (which the
 * app does not offer today, but might) must not un-see the current one.
 *
 * Returns what the marker now says, so the caller can settle its own state on
 * the answer rather than on what it asked for.
 */
create or replace function see_recap(p_week int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week int;
begin
  if p_week is null then
    raise exception 'see_recap needs a week';
  end if;

  update managers
     set recap_seen_week = greatest(coalesce(recap_seen_week, 0), p_week)
   where auth_user_id = auth.uid()
  returning recap_seen_week into v_week;

  return v_week;
end;
$$;

grant execute on function see_recap(int) to authenticated;
