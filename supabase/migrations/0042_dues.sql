-- League dues, and the one line on the home page that chases them.
--
-- Every league has the same problem in September and it is never the software:
-- three people have not paid, the commissioner does not want to be the person
-- who keeps asking, and so the asking happens in a group text where it is
-- either ignored or resented. A line at the top of the app is a better place
-- for it — it is seen by the person who owes and by nobody else, it says the
-- amount and where to send it, and it goes away the moment they are marked
-- paid rather than needing anybody to say so.
--
-- Two pieces, and the split matters:
--
--   * leagues.settings.duesNote, free text, written through the office. It is
--     both the message and the switch: no note, no notice, for anybody, ever.
--     A league that does not collect dues never sees a word about them, and a
--     brand-new league does not greet eleven people with a bill nobody set.
--     Deliberately not a column — it is a setting like every other setting.
--
--   * managers.dues_paid, here, because it is a fact about a franchise rather
--     than a preference, it is read on every page load, and the commissioner
--     has to be able to see the whole table at a glance.
--
-- Default false: unpaid until somebody says otherwise, which is the honest
-- default for money. It shows nobody anything until a note is set.

alter table managers
  add column if not exists dues_paid boolean not null default false;

/**
 * Marks a franchise paid or unpaid. Commissioner only, checked here rather
 * than in the route, so it is true of the database and not just of the app.
 *
 * Takes a null manager to mean everybody, which is the button the office
 * actually needs: "they are all paid up, clear it" is one press, not twelve.
 */
create or replace function set_dues_paid(p_manager_id uuid, p_paid boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      managers;
  v_changed int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner then
    raise exception 'Only the commissioner can settle dues' using errcode = '42501';
  end if;

  if p_manager_id is null then
    update managers set dues_paid = p_paid where league_id = v_me.league_id;
  else
    update managers set dues_paid = p_paid
     where id = p_manager_id and league_id = v_me.league_id;

    if not found then
      raise exception 'No such manager in your league' using errcode = 'P0002';
    end if;
  end if;

  get diagnostics v_changed = row_count;

  insert into admin_log (league_id, actor, action, detail)
  values (v_me.league_id, v_me.id, 'dues',
          jsonb_build_object('manager_id', p_manager_id, 'paid', p_paid,
                             'franchises', v_changed));

  return jsonb_build_object('ok', true, 'changed', v_changed);
end;
$$;

revoke all on function set_dues_paid(uuid, boolean) from public;
grant execute on function set_dues_paid(uuid, boolean) to authenticated;

-- Read-only to everybody else. Who has paid is not a secret inside a league —
-- twelve people who put money in a pot may all see the pot — but it is the
-- commissioner's to change, so it is not in the columns a manager may update.
-- 0010 grants update on (name, franchise) only, so this needs nothing: a
-- column nobody was granted is a column nobody can write.
