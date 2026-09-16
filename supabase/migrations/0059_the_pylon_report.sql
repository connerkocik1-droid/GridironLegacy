-- The Pylon Report.

-- A weekly column the commissioner writes elsewhere and pastes in: a fifteen
-- deep college ranking and a fifteen deep NFL power ranking, five honourable
-- mentions apiece, and a paragraph on each team. It is the one thing in this
-- app that is somebody's opinion rather than something derived, so it is
-- stored as written rather than computed from anything.
--
-- One row per league per week, holding both boards. Not a row per team: the
-- report is published whole and read whole, and a table of three hundred rows
-- a season would be a normalisation nobody ever queries across.
--
-- The arrows are not stored. Where a team sat last week is already written
-- down in last week's row, so storing the movement too would be storing the
-- same fact twice and letting the two disagree the moment a week is edited.

create table if not exists pylon_reports (
  league_id     uuid not null references leagues(id) on delete cascade,
  week          int  not null,
  -- { ranked: [{rank, team, record, note}], honorable: [...] }
  college       jsonb not null default '{"ranked": [], "honorable": []}'::jsonb,
  nfl           jsonb not null default '{"ranked": [], "honorable": []}'::jsonb,
  published_at  timestamptz not null default now(),
  published_by  uuid references managers(id) on delete set null,
  primary key (league_id, week)
);

alter table pylon_reports enable row level security;

-- Everybody in the league reads it. That is the whole point of it.
create policy pylon_reports_read on pylon_reports for select to authenticated
  using (league_id in (select league_id from managers where auth_user_id = auth.uid()));

-- Written only through publish_pylon_report, which checks who is asking.
revoke insert, update, delete on pylon_reports from authenticated;

/**
 * Publish, or replace, a week's report.
 *
 * Replacing rather than refusing: the commissioner will paste a week, notice a
 * team missing its write-up, and paste it again. A publish that had to be
 * deleted first would be a publish nobody corrects.
 */
create or replace function publish_pylon_report(
  p_week    int,
  p_college jsonb,
  p_nfl     jsonb
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
    raise exception 'Only the commissioner can publish the report' using errcode = '42501';
  end if;

  if p_week is null or p_week < 1 then
    raise exception 'The report needs a week';
  end if;

  -- An empty report is a paste that did not work. Storing it would replace a
  -- good week with a blank one, which is the one way this can lose writing.
  if coalesce(jsonb_array_length(p_college -> 'ranked'), 0) = 0
     and coalesce(jsonb_array_length(p_nfl -> 'ranked'), 0) = 0 then
    raise exception 'That report has nothing ranked in it';
  end if;

  insert into pylon_reports (league_id, week, college, nfl, published_at, published_by)
  values (v_me.league_id, p_week,
          coalesce(p_college, '{"ranked": [], "honorable": []}'::jsonb),
          coalesce(p_nfl, '{"ranked": [], "honorable": []}'::jsonb),
          now(), v_me.id)
  on conflict (league_id, week) do update
    set college      = excluded.college,
        nfl          = excluded.nfl,
        published_at = now(),
        published_by = excluded.published_by;

  return jsonb_build_object('ok', true, 'week', p_week);
end;
$$;

revoke all on function publish_pylon_report(int, jsonb, jsonb) from public;
grant execute on function publish_pylon_report(int, jsonb, jsonb) to authenticated;

/** Take a week's report down, for one pasted against the wrong week. */
create or replace function unpublish_pylon_report(p_week int)
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
    raise exception 'Only the commissioner can take the report down' using errcode = '42501';
  end if;

  delete from pylon_reports
   where league_id = v_me.league_id and week = p_week;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', v_gone > 0, 'week', p_week);
end;
$$;

revoke all on function unpublish_pylon_report(int) from public;
grant execute on function unpublish_pylon_report(int) to authenticated;
