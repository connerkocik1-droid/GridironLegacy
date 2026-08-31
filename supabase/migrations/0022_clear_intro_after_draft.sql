-- The intro film has done its job once the draft is over.
--
-- It is the largest thing this league will ever store — a minute of video is
-- comfortably more than every roster, score and trade put together — and after
-- draft night nobody will watch it again. Leaving it there costs the
-- commissioner storage for a film that has already played.
--
-- Deleting the file itself is a Storage call, which SQL cannot make. So this
-- does the half that has to be atomic: it decides, once, that the film is
-- finished with, clears the league's reference to it, and hands the path back
-- to the caller to delete. Twelve browsers polling the draft board at the same
-- instant will produce exactly one claim, because the row is locked and the
-- second caller finds the reference already gone.

create or replace function claim_intro_video_cleanup(p_league_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_league   leagues;
  v_settings jsonb;
  v_path     text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    return null;
  end if;

  -- Only once the draft has actually finished. A paused or abandoned draft is
  -- one somebody may still come back to, and the film has to be there when
  -- they do.
  if v_league.draft_state is distinct from 'complete' then
    return null;
  end if;

  v_settings := coalesce(v_league.settings, '{}'::jsonb);
  v_path := v_settings ->> 'introVideoPath';

  -- Nothing to do, which is the normal answer on all but one poll. A film the
  -- commissioner linked to rather than uploaded has no path here: it costs
  -- this project no storage and is not ours to delete.
  if v_path is null then
    return null;
  end if;

  update leagues
     set settings = v_settings - 'introVideo' - 'introVideoPath'
   where id = p_league_id;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'intro_video_cleared',
          jsonb_build_object('path', v_path, 'reason', 'draft complete'));

  return v_path;
end;
$$;

-- Any manager in the league may trigger it. There is nothing here they could
-- want that they should not have: it acts only on a draft that is over, and
-- the outcome is the one the league asked for.
revoke all on function claim_intro_video_cleanup(uuid) from public;
grant execute on function claim_intro_video_cleanup(uuid) to authenticated;
