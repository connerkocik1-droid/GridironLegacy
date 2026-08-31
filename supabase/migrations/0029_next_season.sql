-- Rolling the league into next year.
--
-- This is a dynasty league and nothing carried it forward. Every piece of the
-- next season existed — picks awarded for 2027, a champion recorded for 2026,
-- rosters that are supposed to be kept — and there was no way to get from one
-- to the other. The season would simply have ended and stayed ended.
--
-- What a dynasty rollover is, exactly: the rosters stay, and everything that
-- was true only of last year goes. That is the whole difference between this
-- and reset_league, which throws the rosters away too.
--
--   Kept:  every roster, exactly as it stands. The franchises, their names,
--          divisions, PINs and settings. The record book. The picks already
--          awarded and traded for the coming draft.
--   Gone:  the schedule and every result, the scores, the bracket and its
--          seeds, live waiver claims and the wire, open trade offers, the
--          trade block, draft queues and pick-'em picks.
--   Reset: the season number, the draft board, waiver order, and the ready
--          flags.
--
-- The transaction log is NOT cleared. "Where did he go?" is a question about a
-- player who is still on somebody's roster, and in a dynasty the answer may be
-- three years old. That is the only thing here that outlives its season on
-- purpose.
--
-- Refused until the season is actually over, because a rollover in week nine
-- is not a rollover, it is a reset that lies about what it did.

/**
 * Starts the next season, keeping the rosters.
 *
 * The picks for the new season are awarded here rather than left to the
 * nightly job, so that the league wakes up in the new year with a draft to
 * hold rather than an empty board and a wait.
 *
 * p_season exists for a commissioner who needs to skip a year or correct one;
 * left alone it is simply the year after this one.
 */
create or replace function roll_season(p_league_id uuid, p_season int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      managers;
  v_league  leagues;
  v_next    int;
  v_kept    int;
  v_weeks   int;
  v_saved   int;
  v_picks   jsonb;
  v_champ   text;
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
  v_saved := snapshot_rosters(p_league_id, 'season_roll');

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
         ready = false
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

  -- The board for the new draft, and the picks to fill it. award_draft_picks
  -- leaves alone any pick already created and traded, which is the whole point
  -- of having awarded them a year early.
  delete from draft_picks where league_id = p_league_id;
  v_picks := award_draft_picks(p_league_id, v_next);
  perform rebuild_draft_board(p_league_id);

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'season_rolled',
          jsonb_build_object('from', v_league.season, 'to', v_next,
                             'champion', v_champ, 'players_kept', v_kept,
                             'weeks_removed', v_weeks, 'roster_rows_saved', v_saved));

  return jsonb_build_object(
    'ok', true,
    'from', v_league.season,
    'season', v_next,
    'champion', v_champ,
    'playersKept', v_kept,
    'weeksRemoved', v_weeks,
    'rosterRowsSaved', v_saved,
    'picks', v_picks
  );
end;
$$;

revoke all on function roll_season(uuid, int) from public;
grant execute on function roll_season(uuid, int) to authenticated;
