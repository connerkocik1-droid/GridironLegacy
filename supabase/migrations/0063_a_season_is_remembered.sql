-- A season is remembered.
--
-- roll_season closed a season by deleting it. Every matchup and every player
-- score went, so the record book — computed from matchups — started again
-- from nothing each year, head-to-head history reset, and the only thing a
-- franchise carried out of a season was a title, if it won one. In a dynasty
-- league the seasons are the point; a league named for its legacy was keeping
-- none of it.
--
-- So the season is copied into two history tables on the way out, and
-- roll_season deletes only what it has just kept. Nothing about the live
-- tables changes: this season is read exactly as before, and last season is
-- there to be read for the first time.
--
-- Additive. Two new tables, one new function, and roll_season exactly as
-- 0055 left it with one call added before its deletions. roll_season cannot
-- run until a season has a champion, so applying this mid-season changes
-- nothing anybody can see until the title is decided.

-- ------------------------------------------------------------ the tables ---

/**
 * Every matchup of every closed season, as it stood when the season ended.
 *
 * The franchise names are written down beside the managers, for the same
 * reason league_champions keeps one: a franchise renamed or handed to
 * somebody else years later must not rewrite who played whom. The manager
 * columns carry no foreign key for the same reason — a history that cascades
 * away when a slot is deleted is not a history.
 */
create table if not exists matchup_history (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references leagues(id) on delete cascade,
  season         int  not null,
  week           int  not null,
  home_manager   uuid,
  away_manager   uuid,
  home_franchise text,
  away_franchise text,
  home_points    numeric not null default 0,
  away_points    numeric not null default 0,
  home_starters  jsonb not null default '[]'::jsonb,
  away_starters  jsonb not null default '[]'::jsonb,
  winner         uuid,
  is_tie         boolean not null default false,
  final          boolean not null default false,
  playoff        boolean not null default false,
  playoff_round  int,
  divisional     boolean not null default false,
  graded_at      timestamptz,
  archived_at    timestamptz not null default now(),
  -- One row per fixture, so archiving a season twice keeps it once.
  unique (league_id, season, week, home_manager)
);

create index if not exists matchup_history_season_idx
  on matchup_history (league_id, season, week);

/** Every player score of every closed season, with the stat line behind it. */
create table if not exists player_score_history (
  league_id   uuid not null references leagues(id) on delete cascade,
  season      int  not null,
  week        int  not null,
  player_name text not null,
  points      numeric not null default 0,
  stat_line   text,
  stats       jsonb,
  updated_at  timestamptz,
  archived_at timestamptz not null default now(),
  primary key (league_id, season, week, player_name)
);

alter table matchup_history      enable row level security;
alter table player_score_history enable row level security;

-- The league reads its own past, as it reads its present. Nobody else's.
drop policy if exists matchup_history_read on matchup_history;
create policy matchup_history_read on matchup_history for select to authenticated
  using (league_id in (select league_id from managers where auth_user_id = auth.uid()));

drop policy if exists player_score_history_read on player_score_history;
create policy player_score_history_read on player_score_history for select to authenticated
  using (league_id in (select league_id from managers where auth_user_id = auth.uid()));

-- Written only by archive_season, from inside roll_season. History that a
-- browser session could edit would be worth exactly as much as it cost.
revoke insert, update, delete on matchup_history      from authenticated, anon;
revoke insert, update, delete on player_score_history from authenticated, anon;

-- ------------------------------------------------------------- the copy ---

/**
 * Copies a league's live season into the history tables.
 *
 * Idempotent: a fixture or a score already kept for that season is left as it
 * was, so running it twice keeps each once. Returns what it kept this time.
 */
create or replace function archive_season(p_league_id uuid, p_season int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matchups int;
  v_scores   int;
begin
  insert into matchup_history (
    league_id, season, week, home_manager, away_manager, home_franchise, away_franchise,
    home_points, away_points, home_starters, away_starters, winner, is_tie, final,
    playoff, playoff_round, divisional, graded_at
  )
  select m.league_id, p_season, m.week, m.home_manager, m.away_manager,
         h.franchise, a.franchise,
         m.home_points, m.away_points, m.home_starters, m.away_starters, m.winner,
         m.is_tie, m.final, m.playoff, m.playoff_round, m.divisional, m.graded_at
    from matchups m
    left join managers h on h.id = m.home_manager
    left join managers a on a.id = m.away_manager
   where m.league_id = p_league_id
  on conflict (league_id, season, week, home_manager) do nothing;
  get diagnostics v_matchups = row_count;

  insert into player_score_history (
    league_id, season, week, player_name, points, stat_line, stats, updated_at
  )
  select s.league_id, p_season, s.week, s.player_name, s.points, s.stat_line, s.stats, s.updated_at
    from player_scores s
   where s.league_id = p_league_id
  on conflict (league_id, season, week, player_name) do nothing;
  get diagnostics v_scores = row_count;

  return jsonb_build_object('matchups', v_matchups, 'scores', v_scores);
end;
$$;

-- Granted to nobody. roll_season reaches it as the definer it runs as; a
-- browser session has no business copying a season on its own schedule.
revoke all on function archive_season(uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------- the rollover ---

/**
 * 0055's roll_season, with the season archived before anything is deleted.
 *
 * The one change is the archive_season call and the count it adds to the
 * admin log and the answer. Everything else is exactly as it was.
 */
create or replace function roll_season(p_league_id uuid, p_season int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_league   leagues;
  v_next     int;
  v_kept     int;
  v_weeks    int;
  v_saved    int;
  v_picks    jsonb;
  v_champ    text;
  v_archived jsonb;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can start the next season' using errcode = '42501';
  end if;

  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  v_next := coalesce(p_season, v_league.season + 1);
  if v_next <= v_league.season then
    raise exception 'The next season must come after % ', v_league.season
      using errcode = '22023';
  end if;

  -- A season is over when there is a champion. That is a stronger test than
  -- "every week is graded": it also rules out a league whose regular season
  -- finished last night and whose bracket has not been played.
  if not exists (
    select 1 from league_champions
     where league_id = p_league_id and season = v_league.season
  ) then
    raise exception 'The % season has no champion yet — it is not over', v_league.season
      using errcode = '55000';
  end if;

  select franchise into v_champ
    from league_champions where league_id = p_league_id and season = v_league.season;

  select count(*) into v_kept from roster_slots where league_id = p_league_id;
  select count(distinct week) into v_weeks from matchups where league_id = p_league_id;

  -- Photographed on the way past, like every other destructive thing in here.
  -- The rosters survive this, but a rollover run by mistake is still the sort
  -- of thing somebody wants back.
  -- Before anything is deleted. award_draft_picks calls set_draft_pick_order,
  -- which reads the table, the seeds and how far each franchise got in the
  -- bracket — all three about the season being closed, and in a moment none of
  -- it will be here. It ran three statements too late, so every input was
  -- empty and the order fell through to its last tiebreaker, the franchise
  -- slot: an alphabetical rookie draft, overwriting the reverse standings the
  -- nightly job had kept all season.
  v_picks := award_draft_picks(p_league_id, v_next);

  v_saved := snapshot_rosters(p_league_id, 'season_roll');

  -- The season, kept, before the deletions below take it out of the live
  -- tables. Every fixture and every score, filed against the season they
  -- belong to, so the record book and the head-to-head history outlive it.
  v_archived := archive_season(p_league_id, v_league.season);

  -- Everything that was true only of last season. Rosters and the record book
  -- are deliberately not in this list.
  delete from matchups      where league_id = p_league_id;
  delete from player_scores where league_id = p_league_id;
  delete from waiver_claims where league_id = p_league_id;
  delete from waiver_wire   where league_id = p_league_id;
  delete from trade_block   where league_id = p_league_id;
  delete from draft_queue   where league_id = p_league_id;
  delete from pickem_picks  where league_id = p_league_id;
  delete from playoff_seeds where league_id = p_league_id and season = v_league.season;
  delete from notices       where league_id = p_league_id;

  -- An offer names players against a season that no longer exists, and a pick
  -- for a draft that has now happened. Declined rather than deleted, so a
  -- manager's work leaves a trace rather than vanishing.
  update trades
     set status = 'declined'
   where league_id = p_league_id
     and status in ('open', 'countered', 'agreed');

  -- Everybody keeps their players; nobody keeps their lineup. Last year's
  -- starters mean nothing against a schedule that does not exist yet, and a
  -- player on IR in December is not necessarily hurt in September.
  update roster_slots
     set lineup_slot = 'BENCH',
         overall_pick = null
   where league_id = p_league_id;

  -- Waiver order back to the league's own order. Last season's rolling order
  -- is a consequence of last season.
  update managers m
     set waiver_priority = seq.rn,
         ready = false,
         -- A manager who let the machine draft for him one year has not asked
         -- it to do so forever. Cleared with the rest of last season, beside
         -- the two flags that always were.
         autodraft = false
    from (
      select id, row_number() over (order by slot) as rn
        from managers where league_id = p_league_id
    ) seq
   where seq.id = m.id;

  update leagues
     set season = v_next,
         draft_state = 'pending',
         current_pick = 1,
         pick_started_at = null,
         draft_at = null,
         -- A lottery is drawn for one draft, and the next order comes from the
         -- record instead.
         lottery_order = null
   where id = p_league_id;

  -- The board for the new draft, from the picks awarded above — so a pick
  -- traded a year ago lands on it as its new owner's.
  delete from draft_picks where league_id = p_league_id;
  perform rebuild_draft_board(p_league_id);

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'season_rolled',
          jsonb_build_object('from', v_league.season, 'to', v_next,
                             'champion', v_champ, 'players_kept', v_kept,
                             'weeks_removed', v_weeks, 'roster_rows_saved', v_saved,
                             'archived', v_archived));

  return jsonb_build_object(
    'ok', true,
    'from', v_league.season,
    'season', v_next,
    'champion', v_champ,
    'playersKept', v_kept,
    'weeksRemoved', v_weeks,
    'rosterRowsSaved', v_saved,
    'picks', v_picks,
    'archived', v_archived
  );
end;
$$;

revoke all on function roll_season(uuid, int) from public;
grant execute on function roll_season(uuid, int) to authenticated;
