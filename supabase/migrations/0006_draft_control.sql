-- Starting, pausing and resuming the draft.
--
-- The clock lives on the league row, so starting and resuming both have to
-- reset pick_started_at — otherwise a draft resumed after an hour's pause
-- would show every client a clock that expired long ago and autodraft the
-- manager who was on it.

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

  if p_state not in ('pending', 'running', 'paused', 'complete') then
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
           -- The clock restarts now. A paused draft must not resume onto an
           -- expired clock and autodraft whoever was on it.
           pick_started_at = now()
     where id = p_league_id;
  else
    update leagues
       set draft_state = p_state,
           pick_started_at = case when p_state = 'paused' then null else pick_started_at end
     where id = p_league_id;
  end if;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'draft_state', jsonb_build_object('to', p_state));

  return jsonb_build_object('ok', true, 'state', p_state);
end;
$$;

revoke all on function set_draft_state(uuid, text) from public;
grant execute on function set_draft_state(uuid, text) to authenticated;

-- autodraft_expired already refuses when pick_started_at is null, which is how
-- a paused draft is safe from it.
