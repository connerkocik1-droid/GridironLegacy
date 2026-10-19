-- The Pylon Report's third board: the rookie draft big board.
--
-- Same shape as pylon_reports and the same reasons for it — the commissioner's
-- own ranking, pasted in whole rather than derived from anything, one row per
-- league per week holding the board as published. A top fifty with whatever
-- ran past it kept as an honourable mention, the same split the college and
-- NFL boards already use.
--
-- Its own table rather than a third column on pylon_reports: a big board does
-- not move on the same clock a weekly poll does, and giving it a week number
-- of its own lets it go unpublished some weeks without leaving a hole in the
-- report, or carry a week where the polls did not run.

create table if not exists pylon_draft_boards (
  league_id     uuid not null references leagues(id) on delete cascade,
  week          int  not null,
  -- { ranked: [{rank, player, position, college, note}], honorable: [...] }
  board         jsonb not null default '{"ranked": [], "honorable": []}'::jsonb,
  published_at  timestamptz not null default now(),
  published_by  uuid references managers(id) on delete set null,
  primary key (league_id, week)
);

alter table pylon_draft_boards enable row level security;

create policy pylon_draft_boards_read on pylon_draft_boards for select to authenticated
  using (league_id in (select league_id from managers where auth_user_id = auth.uid()));

revoke insert, update, delete on pylon_draft_boards from authenticated;

/** Publish, or replace, a week's big board. See publish_pylon_report. */
create or replace function publish_pylon_draft_board(
  p_week  int,
  p_board jsonb
)
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
    raise exception 'Only the commissioner can publish the big board' using errcode = '42501';
  end if;

  if p_week is null or p_week < 1 then
    raise exception 'The big board needs a week';
  end if;

  if coalesce(jsonb_array_length(p_board -> 'ranked'), 0) = 0 then
    raise exception 'That big board has nothing ranked in it';
  end if;

  insert into pylon_draft_boards (league_id, week, board, published_at, published_by)
  values (v_me.league_id, p_week,
          coalesce(p_board, '{"ranked": [], "honorable": []}'::jsonb),
          now(), v_me.id)
  on conflict (league_id, week) do update
    set board        = excluded.board,
        published_at = now(),
        published_by = excluded.published_by;

  return jsonb_build_object('ok', true, 'week', p_week);
end;
$$;

revoke all on function publish_pylon_draft_board(int, jsonb) from public;
grant execute on function publish_pylon_draft_board(int, jsonb) to authenticated;

/** Take a week's big board down, for one pasted against the wrong week. */
create or replace function unpublish_pylon_draft_board(p_week int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me managers;
  v_gone int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner then
    raise exception 'Only the commissioner can take the big board down' using errcode = '42501';
  end if;

  delete from pylon_draft_boards
   where league_id = v_me.league_id and week = p_week;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', v_gone > 0, 'week', p_week);
end;
$$;

revoke all on function unpublish_pylon_draft_board(int) from public;
grant execute on function unpublish_pylon_draft_board(int) to authenticated;
