-- Resetting the draft: putting the league back to the morning of draft day.
--
-- A draft can go wrong in ways no rule catches. The board was built before two
-- franchises were added, somebody was autodrafted through a whole round while
-- their power was out, half the room turned up an hour late. The commissioner
-- needs a way to say "none of that happened" without a database console.
--
-- It undoes the draft, not the season. Once a week has been graded the rosters
-- are part of the record — those players scored those points — so a reset is
-- refused from that moment on.

/**
 * Puts the league back to before the draft: no rosters, a fresh board, the
 * room closed.
 *
 * Every roster goes, not only the players taken in the draft. A player who was
 * drafted and later traded is carried as a trade, and one picked up off waivers
 * was never drafted at all — leaving either behind would reopen the board with
 * players already owned, and the room would offer them to somebody else.
 *
 * The board is rebuilt rather than blanked, so it reflects the league as it
 * stands now: a franchise count or a lottery order that changed since the last
 * board was drawn is picked up here.
 *
 * Draft queues are left alone. They are a manager's own preparation, and
 * players taken in the draft were removed from every queue as they went — that
 * ordering cannot be recovered, but wiping what remains would destroy work
 * nobody asked to lose.
 */
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

  -- A graded week is history. Undoing the draft under it would leave scores
  -- that no roster in the league can account for.
  if exists (select 1 from matchups where league_id = p_league_id and final) then
    raise exception 'Weeks have already been played — the draft cannot be reset now'
      using errcode = '55000';
  end if;

  select count(*) into v_picks
    from draft_picks where league_id = p_league_id and player_name is not null;

  select count(*) into v_rostered
    from roster_slots where league_id = p_league_id;

  delete from roster_slots where league_id = p_league_id;

  -- An offer names players on rosters that no longer exist. execute_trade
  -- would refuse it, but leaving offers standing that can never go through is
  -- its own confusion, so they are declined here where the reason is plain.
  update trades
     set status = 'declined'
   where league_id = p_league_id
     and status in ('open', 'countered', 'agreed');
  get diagnostics v_trades = row_count;

  -- Same for claims: everyone named is a free agent again, and the drop they
  -- were paired with is gone. Settling them as cancelled leaves the reason on
  -- the record rather than deleting a manager's work without explanation.
  update waiver_claims
     set status = 'cancelled',
         reason = 'The draft was reset',
         settled_at = now()
   where league_id = p_league_id and status = 'pending';
  get diagnostics v_claims = row_count;

  -- Nobody owns anybody, so nobody has anybody to shop.
  delete from trade_block where league_id = p_league_id;

  -- rebuild_draft_board refuses while picks are made, which is the point of
  -- that guard everywhere else. Here the picks are being deliberately undone,
  -- so they go first.
  delete from draft_picks where league_id = p_league_id;
  perform rebuild_draft_board(p_league_id);

  update leagues
     set draft_state = 'pending',
         current_pick = 1,
         -- Nobody is on the clock, and autodraft_expired refuses on a null.
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

revoke all on function reset_draft(uuid) from public;
grant execute on function reset_draft(uuid) to authenticated;
