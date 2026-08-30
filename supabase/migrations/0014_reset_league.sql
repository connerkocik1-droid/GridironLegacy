-- Resetting the whole league, and a snapshot so it is not the end of the world.
--
-- reset_draft undoes draft night. This undoes the season: every roster, every
-- result, every transaction, the schedule, the board, the pick-'em. What it
-- keeps is the league itself — who is in it, what their franchises are called,
-- the divisions, the settings, and the PINs people already chose.
--
-- Unlike the draft reset it is NOT refused once a week has been played. That is
-- the whole point of it: it is the way back from a season that went wrong, and
-- a season cannot go wrong before it has started. The protection is that it is
-- the commissioner's alone, that it says exactly what it will do, and that the
-- rosters are photographed on the way past.

/**
 * Writes the league's rosters into roster_backups before something eats them.
 *
 * Returns how many players were recorded. The payload is plain JSON keyed by
 * franchise slot rather than by manager id, so it still reads as something
 * afterwards even if the franchises are rebuilt.
 */
create or replace function snapshot_rosters(p_league_id uuid, p_kind text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'slot', m.slot,
           'franchise', m.franchise,
           'player', r.player_name,
           'acquired', r.acquired,
           'overall_pick', r.overall_pick,
           'lineup_slot', r.lineup_slot
         ) order by m.slot, r.player_name), '[]'::jsonb)
    into v_rows
    from roster_slots r
    join managers m on m.id = r.manager_id
   where r.league_id = p_league_id;

  -- Nothing on the rosters is nothing worth photographing.
  if jsonb_array_length(v_rows) = 0 then return 0; end if;

  insert into roster_backups (league_id, kind, payload) values (p_league_id, p_kind, v_rows);
  return jsonb_array_length(v_rows);
end;
$$;

revoke all on function snapshot_rosters(uuid, text) from public;

-- The draft reset gets the same photograph. It was already refused once a week
-- had been played, so nothing irreplaceable was ever at stake — but four rounds
-- of picks is somebody's evening, and recovering them should not depend on
-- anyone having thought to write them down.
create or replace function reset_draft(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_picks    int;
  v_rostered int;
  v_claims   int;
  v_trades   int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can reset the draft' using errcode = '42501';
  end if;

  if exists (select 1 from matchups where league_id = p_league_id and final) then
    raise exception 'Weeks have already been played — the draft cannot be reset now'
      using errcode = '55000';
  end if;

  select count(*) into v_picks
    from draft_picks where league_id = p_league_id and player_name is not null;

  select count(*) into v_rostered
    from roster_slots where league_id = p_league_id;

  perform snapshot_rosters(p_league_id, 'draft_reset');

  delete from roster_slots where league_id = p_league_id;

  update trades
     set status = 'declined'
   where league_id = p_league_id
     and status in ('open', 'countered', 'agreed');
  get diagnostics v_trades = row_count;

  update waiver_claims
     set status = 'cancelled',
         reason = 'The draft was reset',
         settled_at = now()
   where league_id = p_league_id and status = 'pending';
  get diagnostics v_claims = row_count;

  delete from trade_block where league_id = p_league_id;

  delete from draft_picks where league_id = p_league_id;
  perform rebuild_draft_board(p_league_id);

  update leagues
     set draft_state = 'pending',
         current_pick = 1,
         pick_started_at = null
   where id = p_league_id;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'draft_reset',
          jsonb_build_object('picks_undone', v_picks,
                             'players_returned', v_rostered,
                             'trades_declined', v_trades,
                             'claims_cancelled', v_claims));

  return jsonb_build_object(
    'ok', true,
    'picksUndone', v_picks,
    'playersReturned', v_rostered,
    'tradesDeclined', v_trades,
    'claimsCancelled', v_claims
  );
end;
$$;

/**
 * Puts the league back to the day it was created, keeping who is in it.
 *
 * Gone: rosters, the draft, the schedule and every result, scores, waiver
 * claims, trades, the trade block, draft queues, pick-'em picks, and the
 * transaction log. The board is redrawn empty and the draft room closes.
 *
 * Kept: the franchises and their names, divisions, league settings, the draft
 * date, and the PINs managers already chose — so twelve people do not have to
 * sign up again over a mistake in week three. The admin log is kept too,
 * including the record of this.
 *
 * p_release_franchises hands the franchises back as well: PINs cleared, sign-in
 * links broken, names back to Open. The commissioner is excluded from that on
 * purpose — clearing their own link would leave a league whose office nobody
 * can reach, since every commissioner function finds them by it.
 */
create or replace function reset_league(
  p_league_id uuid,
  p_release_franchises boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        managers;
  v_players   int;
  v_weeks     int;
  v_played    int;
  v_released  int := 0;
  v_saved     int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can reset the league' using errcode = '42501';
  end if;

  select count(*) into v_players from roster_slots where league_id = p_league_id;
  select count(distinct week) into v_weeks from matchups where league_id = p_league_id;
  select count(*) into v_played from matchups where league_id = p_league_id and final;

  -- Taken before anything is deleted, and returned to the caller so the
  -- commissioner is told where the rosters went rather than having to trust it.
  v_saved := snapshot_rosters(p_league_id, 'league_reset');

  delete from roster_slots   where league_id = p_league_id;
  delete from matchups       where league_id = p_league_id;
  delete from player_scores  where league_id = p_league_id;
  delete from transactions   where league_id = p_league_id;
  delete from waiver_claims  where league_id = p_league_id;
  delete from trades         where league_id = p_league_id;
  delete from trade_block    where league_id = p_league_id;
  delete from draft_queue    where league_id = p_league_id;
  delete from pickem_picks   where league_id = p_league_id;

  -- Waiver order is a consequence of a season that no longer happened, so it
  -- goes back to the order the league was written down in.
  update managers m
     set waiver_priority = seq.rn,
         ready = false
    from (
      select id, row_number() over (order by slot) as rn
        from managers where league_id = p_league_id
    ) seq
   where seq.id = m.id;

  if p_release_franchises then
    update managers
       set pin_hash = null,
           auth_user_id = null,
           name = 'Open'
     where league_id = p_league_id
       and not is_commissioner;
    get diagnostics v_released = row_count;
  end if;

  delete from draft_picks where league_id = p_league_id;
  perform rebuild_draft_board(p_league_id);

  update leagues
     set draft_state = 'pending',
         current_pick = 1,
         pick_started_at = null,
         -- A lottery is drawn for one season. This is not that season anymore.
         lottery_order = null
   where id = p_league_id;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'league_reset',
          jsonb_build_object('players_returned', v_players,
                             'weeks_removed', v_weeks,
                             'weeks_played', v_played,
                             'franchises_released', v_released,
                             'roster_rows_saved', v_saved));

  return jsonb_build_object(
    'ok', true,
    'playersReturned', v_players,
    'weeksRemoved', v_weeks,
    'weeksPlayed', v_played,
    'franchisesReleased', v_released,
    'rosterRowsSaved', v_saved
  );
end;
$$;

revoke all on function reset_league(uuid, boolean) from public;
grant execute on function reset_league(uuid, boolean) to authenticated;
