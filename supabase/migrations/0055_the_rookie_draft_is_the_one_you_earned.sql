-- The board a season of dealing actually earned.

-- Three things went wrong at the moment a dynasty league is least able to
-- recover from them, and they compounded.
--
-- roll_season deleted the schedule, deleted the bracket and bumped the season,
-- and only then worked out the new draft's order. set_draft_pick_order reads
-- the standings, the seeds and the playoff rounds of the season just finished
-- — all three of which were gone by the time it ran — so every input was empty
-- and the order collapsed to its last tiebreaker, the franchise slot. The
-- rookie draft came out alphabetical, and it overwrote the correct reverse
-- standings the nightly job had been keeping all season.
--
-- rebuild_draft_board then laid out `rounds` rounds — twenty-four, the startup
-- draft's length — rather than the `rookieRounds` the picks were awarded for.
--
-- And it built the board from the franchise list, never once looking at
-- draft_pick_assets. Every pick traded in the preceding year was silently
-- handed back to the club it came from. In a league whose whole currency is
-- next year's first, that is the year's dealing thrown away.

-- ------------------------------------------------------- the board itself ---

/**
 * The draft board, from the picks people actually hold.
 *
 * draft_pick_assets is the record of who owns what: one row per original pick,
 * carrying the franchise it came from and the franchise holding it now. That
 * is the only honest source for a board, because it is the only one that knows
 * about trades.
 *
 * Falls back to a plain snake of the franchise list when there are no assets
 * for the season, which is how a league that has never awarded them — or a
 * commissioner resizing the league before the first draft — still gets a
 * board.
 *
 * The seat an owner picks from is the seat of the pick's *origin*, not their
 * own: a first-rounder acquired from the worst team in the league is the first
 * pick of the round, and that is exactly what it was traded for.
 */
create or replace function rebuild_draft_board(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league  leagues;
  v_rounds  int;
  v_teams   int;
  v_made    int;
  v_order   uuid[];
  v_round   int;
  v_seat    int;
  v_overall int := 0;
  v_assets  int;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  select count(*) into v_made
    from draft_picks
   where league_id = p_league_id and player_name is not null;

  if v_made > 0 then
    raise exception 'The draft has already started — % picks are made', v_made
      using errcode = '55000';
  end if;

  select count(*) into v_assets
    from draft_pick_assets
   where league_id = p_league_id and season = v_league.season;

  -- Draft order: the lottery if one has been drawn, else by slot. Only used
  -- for the fallback board; a board built from assets takes its order from
  -- the assets, which the nightly job has already sorted by record.
  if v_league.lottery_order is not null and array_length(v_league.lottery_order, 1) > 0 then
    select array_agg(m.id order by idx)
      into v_order
      from unnest(v_league.lottery_order) with ordinality as lo(slot, idx)
      join managers m on m.league_id = p_league_id and m.slot = lo.slot;
  else
    select array_agg(id order by slot) into v_order
      from managers where league_id = p_league_id;
  end if;

  v_teams := coalesce(array_length(v_order, 1), 0);
  if v_teams = 0 then
    raise exception 'The league has no franchises' using errcode = '55000';
  end if;

  delete from draft_picks where league_id = p_league_id;

  if v_assets > 0 then
    -- One row per pick that exists, in the order the assets say, and to
    -- whoever holds it now.
    insert into draft_picks (league_id, overall, round, manager_id)
    select p_league_id,
           row_number() over (
             order by a.round,
                      -- Snaking, as the startup draft does and as the board
                      -- did before it read the assets: odd rounds run in
                      -- order, even rounds back. The seat is the origin's, so
                      -- a first acquired from the worst team is the first pick
                      -- of the round — which is what it was traded for.
                      case when a.round % 2 = 1
                           then coalesce(a.slot, 9999)
                           else -coalesce(a.slot, 9999)
                      end,
                      o.slot
           ),
           a.round,
           a.manager_id
      from draft_pick_assets a
      join managers o on o.id = a.origin_manager
     where a.league_id = p_league_id
       and a.season = v_league.season;

    get diagnostics v_overall = row_count;
    select coalesce(max(round), 0) into v_rounds
      from draft_pick_assets
     where league_id = p_league_id and season = v_league.season;
  else
    v_rounds := coalesce((v_league.settings ->> 'rounds')::int, 24);

    for v_round in 1..v_rounds loop
      for v_seat in 1..v_teams loop
        v_overall := v_overall + 1;
        insert into draft_picks (league_id, overall, round, manager_id)
        values (
          p_league_id,
          v_overall,
          v_round,
          -- Odd rounds run forward, even rounds back.
          v_order[case when v_round % 2 = 1 then v_seat else v_teams - v_seat + 1 end]
        );
      end loop;
    end loop;
  end if;

  update leagues
     set current_pick = 1,
         pick_started_at = null,
         draft_state = case when draft_state = 'complete' then 'pending' else draft_state end
   where id = p_league_id;

  return jsonb_build_object('ok', true, 'teams', v_teams, 'rounds', v_rounds,
                            'picks', v_overall, 'fromAssets', v_assets > 0);
end;
$$;

revoke all on function rebuild_draft_board(uuid) from public;

-- ------------------------------------------------------- the order of it ---

/**
 * Working out the new draft before throwing away what decides it.
 *
 * Two changes, and the rest is 0029's function exactly as it was: the pick
 * award moves above the deletions, and autodraft joins the flags that a new
 * season clears.
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
  -- Before anything is deleted. award_draft_picks calls set_draft_pick_order,
  -- which reads the table, the seeds and how far each franchise got in the
  -- bracket — all three about the season being closed, and in a moment none of
  -- it will be here. It ran three statements too late, so every input was
  -- empty and the order fell through to its last tiebreaker, the franchise
  -- slot: an alphabetical rookie draft, overwriting the reverse standings the
  -- nightly job had kept all season.
  v_picks := award_draft_picks(p_league_id, v_next);

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
