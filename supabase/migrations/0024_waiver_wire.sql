-- Dropped players go to waivers. Everybody else is a free agent.
--
-- Until now a drop deleted the roster slot and the player was available that
-- instant, to whoever happened to have the page open. That is the one thing
-- waivers exist to prevent: a player who becomes available should be available
-- to the whole league at once, in priority order.
--
-- The shape is the one every league already knows:
--
--   * Drop a player and he goes on the waiver wire for `waiverDays` days.
--     While he is there nobody can simply add him — he can only be claimed.
--   * The waiver run settles every claim against a player whose time is up,
--     best priority first, and then releases him. Winning a claim still sends
--     you to the back of the order.
--   * Anybody NOT on the wire is a free agent: added on the spot, first come
--     first served, no run to wait for.
--
-- `waiverMode` chooses between that and the two extremes:
--
--   'waivers'  (default) the above.
--   'open'     no wire at all; every drop is an immediate free agent.
--   'all'      nothing is ever an instant add; every pickup is a claim.
--
-- The wire row carries its own clearing time rather than relying on the run to
-- be punctual, so how often the run happens is a question of how quickly
-- claims are settled, never of whether a player is stuck.

create table if not exists waiver_wire (
  league_id   uuid not null references leagues(id) on delete cascade,
  player_name text not null,
  -- Who let him go. Kept for the record; a franchise that is later removed
  -- leaves the player on the wire rather than taking him with it.
  dropped_by  uuid references managers(id) on delete set null,
  dropped_at  timestamptz not null default now(),
  -- The moment he stops being claimable and starts being takeable. The next
  -- run at or after this settles the claims and lets him go.
  clears_at   timestamptz not null,
  primary key (league_id, player_name)
);

-- The run reads by league and clearing time; the primary key covers league_id
-- alone but not the ordering within it.
create index if not exists waiver_wire_clears_idx on waiver_wire (league_id, clears_at);
create index if not exists waiver_wire_dropped_by_idx on waiver_wire (dropped_by);

alter table waiver_wire enable row level security;

-- Everyone in the league sees the wire. Knowing who is unavailable, and until
-- when, is the whole of what makes a claim worth making.
drop policy if exists waiver_wire_read on waiver_wire;
create policy waiver_wire_read on waiver_wire
  for select using (league_id = (select league_id from current_manager()));

-- No direct writes. The wire is written by dropping a player and cleared by
-- the run, both of which check things a manager cannot be trusted to.
grant select on waiver_wire to authenticated;

-- ------------------------------------------------------------- the rules ---

/** Which of the three waiver models this league is playing. */
create or replace function waiver_mode(p_league_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce(settings ->> 'waiverMode', 'waivers')
           when 'open' then 'open'
           when 'all'  then 'all'
           else 'waivers'
         end
    from leagues where id = p_league_id;
$$;

/**
 * How long a dropped player sits on the wire.
 *
 * Floored at a day. A league that wants no waiting at all wants waiverMode
 * 'open', which says so plainly, rather than a period of zero that reads like
 * a waiver system and behaves like none.
 */
create or replace function waiver_days(p_league_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, coalesce((settings ->> 'waiverDays')::int, 1))
    from leagues where id = p_league_id;
$$;

-- Both read a league's settings past its row policy, so neither is anybody's
-- to call about a league they are not in.
revoke all on function waiver_mode(uuid) from public;
revoke all on function waiver_days(uuid) from public;

/** Whether a player must be claimed rather than simply added. */
create or replace function on_waivers(p_league_id uuid, p_player text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from waiver_wire
     where league_id = p_league_id and player_name = p_player
  );
$$;

-- The wire is already readable to the league, so this says nothing new to a
-- manager — it just says it in one call rather than a query.
revoke all on function on_waivers(uuid, text) from public;
grant execute on function on_waivers(uuid, text) to authenticated;

/**
 * Puts a dropped player on the wire.
 *
 * Called from both places a player can be let go — an outright drop, and the
 * drop half of an add or a winning claim — so there is one rule rather than
 * two that can drift apart. In an open league it does nothing, which is what
 * an open league means.
 *
 * Re-dropping someone already on the wire restarts his time there rather than
 * failing: he has just been owned again, so the league deserves the same look
 * at him it would have had the first time.
 */
create or replace function send_to_waivers(
  p_league_id uuid,
  p_manager_id uuid,
  p_player text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clears timestamptz;
begin
  if waiver_mode(p_league_id) = 'open' then return null; end if;

  v_clears := now() + make_interval(days => waiver_days(p_league_id));

  insert into waiver_wire (league_id, player_name, dropped_by, dropped_at, clears_at)
  values (p_league_id, p_player, p_manager_id, now(), v_clears)
  on conflict (league_id, player_name) do update
     set dropped_by = excluded.dropped_by,
         dropped_at = excluded.dropped_at,
         clears_at  = excluded.clears_at;

  return v_clears;
end;
$$;

revoke all on function send_to_waivers(uuid, uuid, text) from public;

-- ----------------------------------------------------- roster moves, again ---

/**
 * Puts a player on a roster, dropping one if it is full.
 *
 * Re-emitted from 0007 for the two halves the wire touches: whoever is dropped
 * to make room goes on the wire like any other drop, and whoever arrives comes
 * off it. Everything else is as it was.
 *
 * This is still the mechanism with no opinion about who is asking — the run
 * calls it for the winning manager, add_player calls it for the caller — so
 * the wire is not consulted here about whether the ADD was allowed. That is
 * add_player's question, because the run is precisely the thing permitted to
 * take a player off the wire.
 */
create or replace function place_player(
  p_league_id uuid,
  p_manager_id uuid,
  p_add text,
  p_drop text default null,
  p_kind text default 'add'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league   leagues;
  v_capacity int;
  v_clears   timestamptz;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from managers where id = p_manager_id and league_id = p_league_id
  ) then
    raise exception 'That manager is not in this league' using errcode = '42501';
  end if;

  if exists (
    select 1 from roster_slots where league_id = p_league_id and player_name = p_add
  ) then
    raise exception 'That player is already rostered' using errcode = '23505';
  end if;

  -- The drop happens first, so a full roster can take the incoming player.
  if p_drop is not null then
    delete from roster_slots
     where league_id = p_league_id and manager_id = p_manager_id and player_name = p_drop;

    if not found then
      raise exception 'You do not hold %', p_drop using errcode = 'P0002';
    end if;

    v_clears := send_to_waivers(p_league_id, p_manager_id, p_drop);

    insert into transactions (league_id, manager_id, kind, player_name, detail)
    values (p_league_id, p_manager_id, 'drop', p_drop,
            jsonb_build_object('for', p_add, 'waivers', v_clears is not null,
                               'clearsAt', v_clears));
  end if;

  v_capacity := roster_capacity(v_league.settings);
  if roster_count(p_manager_id) >= v_capacity then
    raise exception 'Your roster is full at % — drop someone first', v_capacity
      using errcode = '55000';
  end if;

  insert into roster_slots (league_id, manager_id, player_name, acquired, lineup_slot)
  values (p_league_id, p_manager_id, p_add, p_kind, 'BENCH');

  -- He is owned; the wire has no further business with him. Ordinarily the
  -- run's sweep would have taken this row, but a claim settled early — or an
  -- open-market add of somebody the league moved off the wire — must not leave
  -- a rostered player still listed as claimable.
  delete from waiver_wire where league_id = p_league_id and player_name = p_add;

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  values (p_league_id, p_manager_id, p_kind, p_add, jsonb_build_object('dropped', p_drop));

  return jsonb_build_object('ok', true, 'added', p_add, 'dropped', p_drop,
                            'clearsAt', v_clears);
end;
$$;

revoke all on function place_player(uuid, uuid, text, text, text) from public;

/**
 * Adds a player to the signed-in manager's own roster, off the open market.
 *
 * This is the door the wire closes. A player on it is refused here and pointed
 * at a claim, which is the only route that competes properly; a league playing
 * 'all' has no open market at all and every pickup is refused the same way.
 */
create or replace function add_player(
  p_league_id uuid,
  p_add text,
  p_drop text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     managers;
  v_clears timestamptz;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  if waiver_mode(p_league_id) = 'all' then
    raise exception 'Every pickup in this league goes through waivers — place a claim'
      using errcode = '55000';
  end if;

  select clears_at into v_clears
    from waiver_wire where league_id = p_league_id and player_name = p_add;

  if v_clears is not null then
    raise exception '% is on waivers — place a claim instead', p_add
      using errcode = '55000';
  end if;

  return place_player(p_league_id, v_me.id, p_add, p_drop, 'add');
end;
$$;

revoke all on function add_player(uuid, text, text) from public;
grant execute on function add_player(uuid, text, text) to authenticated;

/** Drops a player outright. He goes to the wire, not back on the shelf. */
create or replace function drop_player(p_league_id uuid, p_player text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     managers;
  v_clears timestamptz;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  delete from roster_slots
   where league_id = p_league_id and manager_id = v_me.id and player_name = p_player;

  if not found then
    raise exception 'You do not hold %', p_player using errcode = 'P0002';
  end if;

  v_clears := send_to_waivers(p_league_id, v_me.id, p_player);

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  values (p_league_id, v_me.id, 'drop', p_player,
          jsonb_build_object('waivers', v_clears is not null, 'clearsAt', v_clears));

  return jsonb_build_object('ok', true, 'dropped', p_player, 'clearsAt', v_clears);
end;
$$;

revoke all on function drop_player(uuid, text) from public;
grant execute on function drop_player(uuid, text) to authenticated;

-- ---------------------------------------------------------------- the run ---

/**
 * Settles the claims that are ripe, then releases the players they were for.
 *
 * Two changes from 0007. A claim is only judged if its player is claimable
 * NOW — off the wire entirely, or on it with his time up. A claim on somebody
 * still inside his waiver period is left pending for a later run rather than
 * being lost, which is the difference between a waiver period and a race.
 *
 * And when the judging is done, everyone whose time is up leaves the wire and
 * becomes a free agent. Players dropped DURING this run are not swept: their
 * clearing time is a whole waiver period away, so the manager who drops
 * somebody to make room for a claim does not hand the league his player in the
 * same breath.
 *
 * Rolling priority is unchanged: the best-priority manager with a live claim
 * wins it and drops to the bottom, and the next claim is judged against the
 * new order. That is why this is a loop rather than one ordered pass.
 */
create or replace function process_waivers(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim    waiver_claims;
  v_won      int := 0;
  v_lost     int := 0;
  v_cleared  int := 0;
  v_held     int := 0;
  v_max      int;
  v_guard    int := 0;
begin
  loop
    -- The next claim to judge: best waiver priority first, then the manager's
    -- own ordering, then the order it was placed. A player still serving his
    -- waiver period is not judged at all.
    select c.* into v_claim
      from waiver_claims c
      join managers m on m.id = c.manager_id
      left join waiver_wire w
        on w.league_id = c.league_id and w.player_name = c.add_player
     where c.league_id = p_league_id
       and c.status = 'pending'
       and (w.player_name is null or w.clears_at <= now())
     order by m.waiver_priority, c.claim_order, c.created_at
     limit 1;

    exit when v_claim.id is null;

    -- Bounded so a bug here can never spin forever against a live database.
    v_guard := v_guard + 1;
    exit when v_guard > 10000;

    begin
      perform place_player(
        p_league_id, v_claim.manager_id,
        v_claim.add_player, v_claim.drop_player, 'waiver'
      );

      update waiver_claims
         set status = 'won', settled_at = now()
       where id = v_claim.id;

      -- Winning sends this manager to the back of the queue, and everyone
      -- below them moves up one.
      select max(waiver_priority) into v_max
        from managers where league_id = p_league_id;

      update managers
         set waiver_priority = waiver_priority - 1
       where league_id = p_league_id
         and waiver_priority > (
           select waiver_priority from managers where id = v_claim.manager_id
         );

      update managers set waiver_priority = v_max where id = v_claim.manager_id;

      v_won := v_won + 1;

    exception when others then
      update waiver_claims
         set status = 'lost', reason = sqlerrm, settled_at = now()
       where id = v_claim.id;
      v_lost := v_lost + 1;
    end;

  end loop;

  -- Everyone whose period is up and who nobody won is a free agent now.
  delete from waiver_wire
   where league_id = p_league_id and clears_at <= now();
  get diagnostics v_cleared = row_count;

  select count(*) into v_held from waiver_wire where league_id = p_league_id;

  return jsonb_build_object('ok', true, 'won', v_won, 'lost', v_lost,
                            'cleared', v_cleared, 'stillOnWaivers', v_held);
end;
$$;

revoke all on function process_waivers(uuid) from public;

-- ---------------------------------------------------------------- resets ---
-- Both resets hand every player in the league back at once. A wire left
-- standing across that would keep players unclaimable for a league that no
-- longer has the rosters they were dropped from.

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

  delete from waiver_wire where league_id = p_league_id;
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

revoke all on function reset_draft(uuid) from public;
grant execute on function reset_draft(uuid) to authenticated;

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

  v_saved := snapshot_rosters(p_league_id, 'league_reset');

  delete from roster_slots   where league_id = p_league_id;
  delete from matchups       where league_id = p_league_id;
  delete from player_scores  where league_id = p_league_id;
  delete from transactions   where league_id = p_league_id;
  delete from waiver_claims  where league_id = p_league_id;
  delete from waiver_wire    where league_id = p_league_id;
  delete from trades         where league_id = p_league_id;
  delete from trade_block    where league_id = p_league_id;
  delete from draft_queue    where league_id = p_league_id;
  delete from pickem_picks   where league_id = p_league_id;

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
