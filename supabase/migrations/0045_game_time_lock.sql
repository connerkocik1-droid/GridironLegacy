-- 0045: a roster stops moving when the football starts.
--
-- Until now a manager could watch his running back tear a hamstring at 1:12
-- and drop him at 1:13, or watch somebody else's receiver score twice and
-- claim him off the wire before the second half. Both are the same theft: the
-- week's outcome is already partly known, and the roster is still open.
--
-- So, from kickoff:
--
--   * a free agent whose club is playing, or has played, cannot be picked up
--   * a player whose club is playing, or has played, cannot be dropped
--   * a trade may still be agreed, but it does not move anybody until the
--     following week unless every player in it is still to play
--
-- The last one is deliberately the gentlest. A trade is two managers agreeing,
-- not one manager reacting, so there is no reason to stop them talking on a
-- Sunday — only a reason not to let the players move mid-week.
--
-- Enforced here rather than in the routes because the routes are not the only
-- way in: every one of these functions is granted to `authenticated`, and a
-- browser holding a session can call them directly.

-- --------------------------------------------------------- who plays where ---

/**
 * The club each player belongs to.
 *
 * The app has always known this — it is in the draft pool — but the database
 * never did, and "has his game started" cannot be answered without it. Seeded
 * below from that pool so the rule works the moment this migration runs, and
 * kept current by sync_nfl_players, which the roster sync calls.
 *
 * League-agnostic on purpose: a player plays for one NFL club regardless of
 * how many fantasy leagues this table serves.
 */
create table if not exists nfl_players (
  name       text primary key,
  team       text not null,
  position   text,
  updated_at timestamptz not null default now()
);

create index if not exists nfl_players_team_idx on nfl_players (team);

alter table nfl_players enable row level security;

-- Not a secret, and every roster page needs it.
drop policy if exists nfl_players_read on nfl_players;
create policy nfl_players_read on nfl_players
  for select using (auth.uid() is not null);

/**
 * Refreshes the map. The service key only — a session that could write this
 * could move a player to a club on a bye and then drop him at half time,
 * which is exactly the rule this table exists to enforce.
 */
create or replace function sync_nfl_players(
  p_names     text[],
  p_teams     text[],
  p_positions text[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed int;
begin
  if coalesce(array_length(p_names, 1), 0) <> coalesce(array_length(p_teams, 1), 0) then
    raise exception 'A name and a club for each, or neither' using errcode = '22023';
  end if;

  insert into nfl_players (name, team, position, updated_at)
  select u.name, u.team, nullif(u.pos, ''), now()
    from unnest(p_names, p_teams, coalesce(p_positions, p_names)) as u(name, team, pos)
   where u.name is not null and length(btrim(u.name)) > 0
      on conflict (name) do update
         set team = excluded.team,
             position = coalesce(excluded.position, nfl_players.position),
             updated_at = now()
       where nfl_players.team is distinct from excluded.team
          or nfl_players.position is distinct from excluded.position;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function sync_nfl_players(text[], text[], text[]) from public;

-- ------------------------------------------------------------- the lock ---

/**
 * Has this player's game this week kicked off?
 *
 * "in" or "post" — being on the field and having left it are the same thing to
 * a manager holding the drop button. Before kickoff, false; on a bye, false,
 * because a club with no game this week has nothing to start.
 *
 * False for a player the map has never heard of, and false when the week's
 * fixtures are not loaded. Both are cases where we cannot prove he has played,
 * and refusing every move in the league because a feed is late is a worse
 * failure than allowing one move we should not have.
 */
create or replace function player_has_played(p_league_id uuid, p_player text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from nfl_players p
      join leagues l on l.id = p_league_id
      join nfl_games g
        on g.season = l.season
       and g.week = current_week(p_league_id)
       and g.season_type = 2
       and (g.home_team = p.team or g.away_team = p.team)
     where p.name = p_player
       and g.state in ('in', 'post')
  );
$$;

revoke all on function player_has_played(uuid, text) from public;
grant execute on function player_has_played(uuid, text) to authenticated;

/** The sentence a manager is shown, or null when the move is allowed. */
create or replace function move_block(p_league_id uuid, p_player text, p_verb text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_player is null or not player_has_played(p_league_id, p_player) then null
    else p_player || ' has already played this week — he cannot be ' || p_verb
         || ' until the week turns over.'
  end;
$$;

revoke all on function move_block(uuid, text, text) from public;
grant execute on function move_block(uuid, text, text) to authenticated;


-- ------------------------------------------------------ adds and drops ---

/**
 * Adds a free agent, dropping somebody if the roster is full.
 *
 * As 0024 left it, plus the kickoff check.
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
  v_block  text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  -- Kickoff closes the roster. Both halves of the move are checked: an add
  -- that also drops somebody is two moves, and only one of them was named in
  -- the request.
  v_block := coalesce(
    move_block(p_league_id, p_add, 'picked up'),
    move_block(p_league_id, p_drop, 'dropped'));
  if v_block is not null then
    raise exception '%', v_block using errcode = '55000';
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

/**
 * Drops a player outright. He goes to the wire, not back on the shelf.
 *
 * As 0024 left it, plus the kickoff check.
 */
create or replace function drop_player(p_league_id uuid, p_player text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     managers;
  v_clears timestamptz;
  v_block  text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  v_block := move_block(p_league_id, p_player, 'dropped');
  if v_block is not null then
    raise exception '%', v_block using errcode = '55000';
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

-- ------------------------------------------------------------- trades ---

-- A trade agreed mid-week waits for the week to turn.
alter table trades add column if not exists effective_week int;

alter table trades drop constraint if exists trades_status_check;
alter table trades add constraint trades_status_check
  check (status in ('open','countered','agreed','executed','declined','rescinded','scheduled'));

create or replace function execute_trade(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade       trades;
  v_me          managers;
  v_give        text[];
  v_get         text[];
  v_give_picks  uuid[];
  v_get_picks   uuid[];
  v_untradeable text;
  v_moved       int;
  v_expected    int;
  v_deadline    int;
  v_from_name   text;
  v_to_name     text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  -- Lock the row for the duration, so two managers hitting accept at the same
  -- moment cannot both execute the same trade.
  select * into v_trade from trades where id = p_trade_id for update;
  if v_trade.id is null then
    raise exception 'No such trade' using errcode = 'P0002';
  end if;

  if v_me.id <> v_trade.from_manager and v_me.id <> v_trade.to_manager then
    raise exception 'Not your trade' using errcode = '42501';
  end if;

  if v_trade.status = 'executed' then
    raise exception 'This trade has already been executed' using errcode = '55000';
  end if;

  if v_trade.status = 'scheduled' then
    raise exception 'This trade is already agreed and goes through in week %',
      v_trade.effective_week using errcode = '55000';
  end if;

  if not (v_trade.from_accepted and v_trade.to_accepted) then
    raise exception 'Both managers must accept first' using errcode = '55000';
  end if;

  -- Checked at execution rather than only at the offer, because an offer can
  -- sit unanswered for a fortnight and the deadline is about when the players
  -- actually move.
  v_deadline := trade_deadline_week(v_trade.league_id);
  if v_deadline > 0 and current_week(v_trade.league_id) > v_deadline then
    raise exception 'The trade deadline passed in week %', v_deadline
      using errcode = '55000';
  end if;

  v_give := coalesce(array(select jsonb_array_elements_text(v_trade.offer -> 'give')), '{}');
  v_get  := coalesce(array(select jsonb_array_elements_text(v_trade.offer -> 'get')),  '{}');

  v_give_picks := coalesce(
    array(select (jsonb_array_elements_text(v_trade.offer -> 'givePicks'))::uuid), '{}');
  v_get_picks := coalesce(
    array(select (jsonb_array_elements_text(v_trade.offer -> 'getPicks'))::uuid), '{}');

  if array_length(v_give, 1) is null and array_length(v_get, 1) is null
     and array_length(v_give_picks, 1) is null and array_length(v_get_picks, 1) is null then
    raise exception 'An empty trade cannot be executed' using errcode = '55000';
  end if;

  -- The rosters may have changed since the offer was made. Every player named
  -- must still be owned by the side that promised him, or the whole trade is
  -- void — never a partial move.
  v_expected := coalesce(array_length(v_give, 1), 0);
  select count(*) into v_moved
  from roster_slots
  where league_id = v_trade.league_id
    and manager_id = v_trade.from_manager
    and player_name = any (v_give);

  if v_moved <> v_expected then
    raise exception 'A player in this offer is no longer on the proposing roster'
      using errcode = '55000';
  end if;

  v_expected := coalesce(array_length(v_get, 1), 0);
  select count(*) into v_moved
  from roster_slots
  where league_id = v_trade.league_id
    and manager_id = v_trade.to_manager
    and player_name = any (v_get);

  if v_moved <> v_expected then
    raise exception 'A player in this offer is no longer on the receiving roster'
      using errcode = '55000';
  end if;

  -- The same test for picks, on both sides.
  v_expected := coalesce(array_length(v_give_picks, 1), 0);
  select count(*) into v_moved
  from draft_pick_assets
  where league_id = v_trade.league_id
    and manager_id = v_trade.from_manager
    and id = any (v_give_picks);

  if v_moved <> v_expected then
    raise exception 'A pick in this offer is no longer held by the proposing franchise'
      using errcode = '55000';
  end if;

  v_expected := coalesce(array_length(v_get_picks, 1), 0);
  select count(*) into v_moved
  from draft_pick_assets
  where league_id = v_trade.league_id
    and manager_id = v_trade.to_manager
    and id = any (v_get_picks);

  if v_moved <> v_expected then
    raise exception 'A pick in this offer is no longer held by the receiving franchise'
      using errcode = '55000';
  end if;

  -- The inaugural draft is not currency. Checked here as well as when the
  -- offer is made, because a season can only become untradeable, never the
  -- other way round, and the offer may be days old.
  select string_agg(distinct a.season::text, ', ' order by a.season::text)
    into v_untradeable
    from draft_pick_assets a
   where a.id = any (v_give_picks || v_get_picks)
     and not picks_are_tradeable(a.league_id, a.season);

  if v_untradeable is not null then
    raise exception 'Picks for the % draft cannot be traded', v_untradeable
      using errcode = '55000';
  end if;

  select franchise into v_from_name from managers where id = v_trade.from_manager;
  select franchise into v_to_name   from managers where id = v_trade.to_manager;

  -- Nobody moves mid-week. A trade is two managers agreeing rather than one
  -- reacting, so there is no reason to stop them agreeing on a Sunday — but a
  -- player who has already played this week must not change hands before the
  -- week is graded, or the same afternoon lands on two different rosters.
  --
  -- Every player on both sides is checked, not only the ones whose clubs have
  -- kicked off: a trade is one thing, and half of it moving is worse than none
  -- of it moving.
  if exists (
    select 1 from unnest(v_give || v_get) as n(name)
     where player_has_played(v_trade.league_id, n.name)
  ) then
    update trades
       set status = 'scheduled',
           effective_week = current_week(v_trade.league_id) + 1
     where id = p_trade_id;

    insert into admin_log (league_id, actor, action, detail)
    values (v_trade.league_id, v_me.id, 'trade_scheduled',
            jsonb_build_object('trade_id', p_trade_id, 'offer', v_trade.offer,
                               'effective_week', current_week(v_trade.league_id) + 1));

    return jsonb_build_object(
      'ok', true,
      'scheduled', true,
      'trade_id', p_trade_id,
      'effectiveWeek', current_week(v_trade.league_id) + 1,
      'give', to_jsonb(v_give),
      'get', to_jsonb(v_get)
    );
  end if;

  -- The move itself. Players land on the bench: a lineup slot on one roster
  -- means nothing on another, and the new owner sets it.
  update roster_slots
     set manager_id = v_trade.to_manager,
         acquired = 'trade',
         lineup_slot = 'BENCH'
   where league_id = v_trade.league_id
     and manager_id = v_trade.from_manager
     and player_name = any (v_give);

  update roster_slots
     set manager_id = v_trade.from_manager,
         acquired = 'trade',
         lineup_slot = 'BENCH'
   where league_id = v_trade.league_id
     and manager_id = v_trade.to_manager
     and player_name = any (v_get);

  -- Only the holder changes. origin_manager stays put, so the pick keeps
  -- falling where the record that produced it says it should.
  update draft_pick_assets
     set manager_id = v_trade.to_manager
   where league_id = v_trade.league_id
     and id = any (v_give_picks);

  update draft_pick_assets
     set manager_id = v_trade.from_manager
   where league_id = v_trade.league_id
     and id = any (v_get_picks);

  -- One row per asset, filed under whoever received it.
  insert into transactions (league_id, manager_id, kind, player_name, detail)
  select v_trade.league_id, v_trade.to_manager, 'trade', p,
         jsonb_build_object('tradeId', p_trade_id, 'fromManager', v_trade.from_manager,
                            'fromFranchise', v_from_name)
    from unnest(v_give) p;

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  select v_trade.league_id, v_trade.from_manager, 'trade', p,
         jsonb_build_object('tradeId', p_trade_id, 'fromManager', v_trade.to_manager,
                            'fromFranchise', v_to_name)
    from unnest(v_get) p;

  -- Picks are named rather than identified, because a pick's id means nothing
  -- to a reader and the season and round mean everything. `pick` marks them so
  -- nothing downstream mistakes the name for a footballer.
  insert into transactions (league_id, manager_id, kind, player_name, detail)
  select v_trade.league_id, v_trade.to_manager, 'trade',
         a.season || ' round ' || a.round || ' pick',
         jsonb_build_object('tradeId', p_trade_id, 'pick', true,
                            'fromManager', v_trade.from_manager,
                            'fromFranchise', v_from_name)
    from draft_pick_assets a where a.id = any (v_give_picks);

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  select v_trade.league_id, v_trade.from_manager, 'trade',
         a.season || ' round ' || a.round || ' pick',
         jsonb_build_object('tradeId', p_trade_id, 'pick', true,
                            'fromManager', v_trade.to_manager,
                            'fromFranchise', v_to_name)
    from draft_pick_assets a where a.id = any (v_get_picks);

  update trades
     set status = 'executed',
         executed_at = now()
   where id = p_trade_id;

  -- A traded player is no longer on offer.
  delete from trade_block
   where league_id = v_trade.league_id
     and player_name = any (v_give || v_get);

  insert into admin_log (league_id, actor, action, detail)
  values (v_trade.league_id, v_me.id, 'trade_executed',
          jsonb_build_object('trade_id', p_trade_id, 'offer', v_trade.offer));

  return jsonb_build_object(
    'ok', true,
    'trade_id', p_trade_id,
    'give', to_jsonb(v_give),
    'get', to_jsonb(v_get),
    'givePicks', to_jsonb(v_give_picks),
    'getPicks', to_jsonb(v_get_picks)
  );
end;
$$;

revoke all on function execute_trade(uuid) from public;
grant execute on function execute_trade(uuid) to authenticated;

/**
 * Puts through the trades that were waiting for this week.
 *
 * Run daily rather than at the instant a week is graded, because "the week has
 * turned" is a thing that becomes true rather than a thing that happens.
 *
 * Every scheduled trade is validated again from scratch. Days pass between
 * agreeing and settling, and in that time a player can be dropped, claimed, or
 * traded again — so a trade whose promised players are no longer where they
 * were is voided rather than partly applied. Both managers are told; a trade
 * that quietly did nothing is worse than one that visibly failed.
 */
create or replace function settle_scheduled_trades(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade   trades;
  v_give    text[];
  v_get     text[];
  v_ok      int := 0;
  v_voided  int := 0;
  v_week    int;
begin
  v_week := current_week(p_league_id);

  for v_trade in
    select * from trades
     where league_id = p_league_id
       and status = 'scheduled'
       and coalesce(effective_week, 0) <= v_week
     order by created_at
     for update
  loop
    v_give := coalesce(array(select jsonb_array_elements_text(v_trade.offer -> 'give')), '{}');
    v_get  := coalesce(array(select jsonb_array_elements_text(v_trade.offer -> 'get')),  '{}');

    -- Still where they were promised from?
    if (select count(*) from roster_slots
         where league_id = v_trade.league_id
           and manager_id = v_trade.from_manager
           and player_name = any (v_give)) <> coalesce(array_length(v_give, 1), 0)
       or (select count(*) from roster_slots
            where league_id = v_trade.league_id
              and manager_id = v_trade.to_manager
              and player_name = any (v_get)) <> coalesce(array_length(v_get, 1), 0)
    then
      update trades set status = 'declined' where id = v_trade.id;
      insert into admin_log (league_id, actor, action, detail)
      values (v_trade.league_id, null, 'trade_void_stale',
              jsonb_build_object('trade_id', v_trade.id, 'offer', v_trade.offer));
      v_voided := v_voided + 1;
      continue;
    end if;

    update roster_slots
       set manager_id = v_trade.to_manager, acquired = 'trade', lineup_slot = 'BENCH'
     where league_id = v_trade.league_id
       and manager_id = v_trade.from_manager
       and player_name = any (v_give);

    update roster_slots
       set manager_id = v_trade.from_manager, acquired = 'trade', lineup_slot = 'BENCH'
     where league_id = v_trade.league_id
       and manager_id = v_trade.to_manager
       and player_name = any (v_get);

    update draft_pick_assets
       set manager_id = v_trade.to_manager
     where league_id = v_trade.league_id
       and id = any (coalesce(array(select (jsonb_array_elements_text(v_trade.offer -> 'givePicks'))::uuid), '{}'));

    update draft_pick_assets
       set manager_id = v_trade.from_manager
     where league_id = v_trade.league_id
       and id = any (coalesce(array(select (jsonb_array_elements_text(v_trade.offer -> 'getPicks'))::uuid), '{}'));

    update trades set status = 'executed', executed_at = now() where id = v_trade.id;

    delete from trade_block
     where league_id = v_trade.league_id and player_name = any (v_give || v_get);

    insert into admin_log (league_id, actor, action, detail)
    values (v_trade.league_id, null, 'trade_executed',
            jsonb_build_object('trade_id', v_trade.id, 'offer', v_trade.offer,
                               'scheduled', true));

    v_ok := v_ok + 1;
  end loop;

  return jsonb_build_object('ok', true, 'executed', v_ok, 'voided', v_voided, 'week', v_week);
end;
$$;

revoke all on function settle_scheduled_trades(uuid) from public;

-- --------------------------------------------------------------- the seed ---

-- The pool as it stands, so the rule works from the moment this runs rather
-- than from the first time the sync happens to be called.
insert into nfl_players (name, team, position) values
  ('Jahmyr Gibbs', 'DET', 'RB'),
  ('Bijan Robinson', 'ATL', 'RB'),
  ('Ja''Marr Chase', 'CIN', 'WR'),
  ('Christian McCaffrey', 'SF', 'RB'),
  ('Jonathan Taylor', 'IND', 'RB'),
  ('Puka Nacua', 'LAR', 'WR'),
  ('James Cook III', 'BUF', 'RB'),
  ('Jaxon Smith-Njigba', 'SEA', 'WR'),
  ('De''Von Achane', 'MIA', 'RB'),
  ('Ashton Jeanty', 'LV', 'RB'),
  ('Amon-Ra St. Brown', 'DET', 'WR'),
  ('Omarion Hampton', 'LAC', 'RB'),
  ('CeeDee Lamb', 'DAL', 'WR'),
  ('Saquon Barkley', 'PHI', 'RB'),
  ('Derrick Henry', 'BAL', 'RB'),
  ('Justin Jefferson', 'MIN', 'WR'),
  ('Chase Brown', 'CIN', 'RB'),
  ('Josh Allen', 'BUF', 'QB'),
  ('Drake London', 'ATL', 'WR'),
  ('Kenneth Walker III', 'KC', 'RB'),
  ('Trey McBride', 'ARI', 'TE'),
  ('Kyren Williams', 'LAR', 'RB'),
  ('Jeremiyah Love', 'ARI', 'RB'),
  ('Brock Bowers', 'LV', 'TE'),
  ('Nico Collins', 'HOU', 'WR'),
  ('George Pickens', 'DAL', 'WR'),
  ('Josh Jacobs', 'GB', 'RB'),
  ('A.J. Brown', 'NE', 'WR'),
  ('Chris Olave', 'NO', 'WR'),
  ('Breece Hall', 'NYJ', 'RB'),
  ('Malik Nabers', 'NYG', 'WR'),
  ('Javonte Williams', 'DAL', 'RB'),
  ('Lamar Jackson', 'BAL', 'QB'),
  ('Rashee Rice', 'KC', 'WR'),
  ('Bucky Irving', 'TB', 'RB'),
  ('Travis Etienne Jr.', 'NO', 'RB'),
  ('Cam Skattebo', 'NYG', 'RB'),
  ('Quinshon Judkins', 'CLE', 'RB'),
  ('Garrett Wilson', 'NYJ', 'WR'),
  ('Tetairoa McMillan', 'CAR', 'WR'),
  ('Tee Higgins', 'CIN', 'WR'),
  ('Zay Flowers', 'BAL', 'WR'),
  ('TreVeyon Henderson', 'NE', 'RB'),
  ('DeVonta Smith', 'PHI', 'WR'),
  ('Colston Loveland', 'CHI', 'TE'),
  ('Ladd McConkey', 'LAC', 'WR'),
  ('Bhayshul Tuten', 'JAX', 'RB'),
  ('Emeka Egbuka', 'TB', 'WR'),
  ('Jaylen Waddle', 'DEN', 'WR'),
  ('DJ Moore', 'BUF', 'WR'),
  ('David Montgomery', 'HOU', 'RB'),
  ('D''Andre Swift', 'CHI', 'RB'),
  ('Drake Maye', 'NE', 'QB'),
  ('Davante Adams', 'LAR', 'WR'),
  ('Joe Burrow', 'CIN', 'QB'),
  ('Jameson Williams', 'DET', 'WR'),
  ('Tyler Warren', 'IND', 'TE'),
  ('Terry McLaurin', 'WSH', 'WR'),
  ('Jaylen Warren', 'PIT', 'RB'),
  ('Mike Evans', 'SF', 'WR'),
  ('RJ Harvey', 'DEN', 'RB'),
  ('Jayden Daniels', 'WSH', 'QB'),
  ('Harold Fannin Jr.', 'CLE', 'TE'),
  ('Rhamondre Stevenson', 'NE', 'RB'),
  ('Rome Odunze', 'CHI', 'WR'),
  ('Rico Dowdle', 'PIT', 'RB'),
  ('Christian Watson', 'GB', 'WR'),
  ('Jadarian Price', 'SEA', 'RB'),
  ('Jalen Hurts', 'PHI', 'QB'),
  ('Carnell Tate', 'TEN', 'WR'),
  ('Tony Pollard', 'TEN', 'RB'),
  ('Tucker Kraft', 'GB', 'TE'),
  ('Parker Washington', 'JAX', 'WR'),
  ('Kyle Monangai', 'CHI', 'RB'),
  ('Luther Burden III', 'CHI', 'WR'),
  ('Michael Wilson', 'ARI', 'WR'),
  ('Brian Thomas Jr.', 'JAX', 'WR'),
  ('Courtland Sutton', 'DEN', 'WR'),
  ('J.K. Dobbins', 'DEN', 'RB'),
  ('Kyle Pitts Sr.', 'ATL', 'TE'),
  ('Chuba Hubbard', 'CAR', 'RB'),
  ('Jordyn Tyson', 'NO', 'WR'),
  ('Blake Corum', 'LAR', 'RB'),
  ('Marvin Harrison Jr.', 'ARI', 'WR'),
  ('DK Metcalf', 'PIT', 'WR'),
  ('Caleb Williams', 'CHI', 'QB'),
  ('Sam LaPorta', 'DET', 'TE'),
  ('Justin Herbert', 'LAC', 'QB'),
  ('Trevor Lawrence', 'JAX', 'QB'),
  ('Chris Godwin Jr.', 'TB', 'WR'),
  ('Jaxson Dart', 'NYG', 'QB'),
  ('Dak Prescott', 'DAL', 'QB'),
  ('Kenny Gainwell', 'TB', 'RB'),
  ('Wan''Dale Robinson', 'TEN', 'WR'),
  ('Jakobi Meyers', 'JAX', 'WR'),
  ('Jordan Mason', 'MIN', 'RB'),
  ('Jacory Croskey-Merritt', 'WSH', 'RB'),
  ('Alec Pierce', 'IND', 'WR'),
  ('Aaron Jones Sr.', 'MIN', 'RB'),
  ('Dalton Kincaid', 'BUF', 'TE'),
  ('George Kittle', 'SF', 'TE'),
  ('Jordan Addison', 'MIN', 'WR'),
  ('Travis Kelce', 'KC', 'TE'),
  ('Patrick Mahomes', 'KC', 'QB'),
  ('MarShawn Lloyd', 'GB', 'RB'),
  ('Michael Pittman Jr.', 'PIT', 'WR'),
  ('Isaiah Likely', 'NYG', 'TE'),
  ('Jake Ferguson', 'DAL', 'TE'),
  ('Mark Andrews', 'BAL', 'TE'),
  ('Josh Downs', 'IND', 'WR'),
  ('Quentin Johnston', 'LAC', 'WR'),
  ('Woody Marks', 'HOU', 'RB'),
  ('Brock Purdy', 'SF', 'QB'),
  ('Tyler Allgeier', 'ARI', 'RB'),
  ('Makai Lemon', 'PHI', 'WR'),
  ('Zach Charbonnet', 'SEA', 'RB'),
  ('Bo Nix', 'DEN', 'QB'),
  ('Dallas Goedert', 'PHI', 'TE'),
  ('Matthew Stafford', 'LAR', 'QB'),
  ('Rachaad White', 'WSH', 'RB'),
  ('Brian Robinson Jr.', 'ATL', 'RB'),
  ('Stefon Diggs', 'WSH', 'WR'),
  ('Juwan Johnson', 'NO', 'TE'),
  ('Tyrone Tracy Jr.', 'NYG', 'RB'),
  ('Jonathon Brooks', 'CAR', 'RB'),
  ('Jayden Reed', 'GB', 'WR'),
  ('Hunter Henry', 'NE', 'TE'),
  ('Jared Goff', 'DET', 'QB'),
  ('Romeo Doubs', 'NE', 'WR'),
  ('Alvin Kamara', 'NO', 'RB'),
  ('Tyjae Spears', 'TEN', 'RB'),
  ('Brandon Aubrey', 'DAL', 'K'),
  ('Jonah Coleman', 'DEN', 'RB'),
  ('Xavier Worthy', 'KC', 'WR'),
  ('Brenton Strange', 'JAX', 'TE'),
  ('Khalil Shakir', 'BUF', 'WR'),
  ('KC Concepcion', 'CLE', 'WR'),
  ('Jordan Love', 'GB', 'QB'),
  ('Baker Mayfield', 'TB', 'QB'),
  ('Deebo Samuel Sr.', 'SF', 'WR'),
  ('Kenyon Sadiq', 'NYJ', 'TE'),
  ('Jalen Coker', 'CAR', 'WR'),
  ('Chris Rodriguez Jr.', 'JAX', 'RB'),
  ('Dalton Schultz', 'HOU', 'TE'),
  ('Dylan Sampson', 'CLE', 'RB'),
  ('Tyler Shough', 'NO', 'QB'),
  ('T.J. Hockenson', 'MIN', 'TE'),
  ('Chig Okonkwo', 'WSH', 'TE'),
  ('Malik Willis', 'MIA', 'QB'),
  ('Kyler Murray', 'MIN', 'QB'),
  ('Keaton Mitchell', 'LAC', 'RB'),
  ('David Njoku', 'LAC', 'TE'),
  ('Isiah Pacheco', 'DET', 'RB'),
  ('Tank Bigsby', 'PHI', 'RB'),
  ('Jauan Jennings', 'MIN', 'WR'),
  ('Kayshon Boutte', 'HOU', 'WR'),
  ('Jayden Higgins', 'HOU', 'WR'),
  ('Braelon Allen', 'NYJ', 'RB'),
  ('Omar Cooper Jr.', 'NYJ', 'WR'),
  ('Cameron Dicker', 'LAC', 'K'),
  ('Tre Harris', 'LAC', 'WR'),
  ('Rashid Shaheed', 'SEA', 'WR'),
  ('Mike Washington Jr.', 'LV', 'RB'),
  ('Dontayvion Wicks', 'PHI', 'WR'),
  ('Emmett Johnson', 'KC', 'RB'),
  ('Matthew Golden', 'GB', 'WR'),
  ('Pat Bryant', 'DEN', 'WR'),
  ('Odell Beckham Jr.', 'NYG', 'WR'),
  ('Darnell Washington', 'PIT', 'TE'),
  ('Philip Rivers', 'FA', 'QB'),
  ('Cole Kmet', 'CHI', 'TE'),
  ('Dawson Knox', 'BUF', 'TE'),
  ('Lil''Jordan Humphrey', 'DEN', 'WR'),
  ('Tyreek Hill', 'FA', 'WR'),
  ('Drew Allar', 'PIT', 'QB'),
  ('Tyler Higbee', 'LAR', 'TE'),
  ('Sal Cannella', 'FA', 'TE'),
  ('KaVontae Turpin', 'DAL', 'WR'),
  ('Elijah Arroyo', 'SEA', 'TE'),
  ('Brock Wright', 'DET', 'TE'),
  ('Kadarius Toney', 'FA', 'WR'),
  ('Noah Gray', 'KC', 'TE'),
  ('Luke Schoonmaker', 'DAL', 'TE'),
  ('JuJu Smith-Schuster', 'FA', 'WR'),
  ('Tommy DeVito', 'NE', 'QB'),
  ('Luke McCaffrey', 'WSH', 'WR'),
  ('Jermar Jefferson', 'MIN', 'RB'),
  ('Israel Abanikanda', 'DAL', 'RB'),
  ('Nick Chubb', 'FA', 'RB'),
  ('Ezekiel Elliott', 'FA', 'RB'),
  ('Jameis Winston', 'NYG', 'QB'),
  ('Kyle Juszczyk', 'SF', 'RB'),
  ('Kaden Wetjen', 'PIT', 'WR'),
  ('Ricky Pearsall', 'SF', 'WR'),
  ('Elijah Higgins', 'ARI', 'TE'),
  ('Josh Oliver', 'MIN', 'TE'),
  ('Zavion Thomas', 'CHI', 'WR'),
  ('Jordan Whittington', 'LAR', 'WR'),
  ('Roman Wilson', 'PIT', 'WR'),
  ('Joshua Dobbs', 'DET', 'QB'),
  ('Cade Klubnik', 'NYJ', 'QB'),
  ('John Samuel Shenker', 'FA', 'TE'),
  ('Luke Lachey', 'FA', 'TE'),
  ('Mac Jones', 'SF', 'QB'),
  ('Josh Williams', 'TB', 'RB'),
  ('Tommy Tremble', 'CAR', 'TE'),
  ('Kalif Raymond', 'CHI', 'WR'),
  ('Isaiah Bond', 'CLE', 'WR'),
  ('Luke Musgrave', 'GB', 'TE'),
  ('Brevyn Spann-Ford', 'DAL', 'TE'),
  ('Kenny Pickett', 'CAR', 'QB'),
  ('Jahdae Walker', 'CHI', 'WR'),
  ('Kyle Allen', 'BUF', 'QB'),
  ('Drew Lock', 'SEA', 'QB'),
  ('Myles Price', 'MIN', 'WR'),
  ('Ray-Ray McCloud III', 'CHI', 'WR'),
  ('Stetson Bennett IV', 'LAR', 'QB'),
  ('Jake Bobo', 'SEA', 'WR'),
  ('Joe Milton III', 'DAL', 'QB'),
  ('Will Howard', 'PIT', 'QB'),
  ('Teddy Bridgewater', 'FA', 'QB'),
  ('Russell Wilson', 'FA', 'QB'),
  ('Jordan Travis', 'FA', 'QB'),
  ('Michael Pratt', 'FA', 'QB'),
  ('Tyson Bagent', 'CHI', 'QB'),
  ('Colbie Young', 'CIN', 'WR'),
  ('Eli Raridon', 'NE', 'TE'),
  ('Noah Fant', 'NO', 'TE'),
  ('Adam Trautman', 'DEN', 'TE'),
  ('Barion Brown', 'NO', 'WR'),
  ('Xavier Smith', 'LAR', 'WR'),
  ('Tanner McKee', 'PHI', 'QB'),
  ('Spencer Rattler', 'NO', 'QB'),
  ('Tyler Huntley', 'BAL', 'QB'),
  ('Jonathan Mingo', 'DAL', 'WR'),
  ('Quinn Ewers', 'JAX', 'QB'),
  ('Efton Chism III', 'NE', 'WR'),
  ('Tim Patrick', 'NYJ', 'WR'),
  ('Bub Means', 'FA', 'WR'),
  ('Dalvin Cook', 'FA', 'RB'),
  ('DeWayne McBride', 'FA', 'RB'),
  ('Junior Bergen', 'FA', 'WR'),
  ('Ja''Corey Brooks', 'FA', 'WR'),
  ('Sam Howell', 'DAL', 'QB'),
  ('Devontez Walker', 'BAL', 'WR'),
  ('Konata Mumpfield', 'LAR', 'WR'),
  ('Mo Alie-Cox', 'IND', 'TE'),
  ('Jackson Hawes', 'BUF', 'TE'),
  ('Hunter Luepke', 'DAL', 'RB'),
  ('Tez Johnson', 'TB', 'WR'),
  ('KeAndre Lambert-Smith', 'LAC', 'WR'),
  ('Calvin Austin III', 'NYG', 'WR'),
  ('Bo Melton', 'GB', 'WR'),
  ('CJ Daniels', 'LAR', 'WR'),
  ('Demarcus Robinson', 'SF', 'WR'),
  ('Tyrod Taylor', 'GB', 'QB'),
  ('Tai Felton', 'MIN', 'WR'),
  ('Sam Roush', 'CHI', 'TE'),
  ('Darius Cooper', 'PHI', 'WR'),
  ('Riley Nowakowski', 'PIT', 'RB'),
  ('Patrick Ricard', 'NYG', 'RB'),
  ('Ben Skowronek', 'PIT', 'WR'),
  ('Braxton Berrios', 'NYG', 'WR'),
  ('Skyy Moore', 'GB', 'WR'),
  ('Mason Rudolph', 'PIT', 'QB'),
  ('Dante Pettis', 'FA', 'WR'),
  ('Marquez Valdes-Scantling', 'FA', 'WR'),
  ('AJ Dillon', 'CAR', 'RB'),
  ('Roschon Johnson', 'CHI', 'RB'),
  ('Will Levis', 'FA', 'QB'),
  ('Frank Gore Jr.', 'BUF', 'RB'),
  ('Jalen Milroe', 'SEA', 'QB'),
  ('Ulysses Bentley IV', 'FA', 'RB'),
  ('Eli Heidenreich', 'PIT', 'RB'),
  ('Taysom Hill', 'FA', 'TE'),
  ('Joe Mixon', 'FA', 'RB'),
  ('John Ross', 'FA', 'WR'),
  ('Jimmy Garoppolo', 'FA', 'QB'),
  ('Jacob Kibodi', 'FA', 'RB'),
  ('Jermaine Jackson', 'FA', 'WR'),
  ('Tommy Mellott', 'FA', 'WR'),
  ('Jacob Saylors', 'DET', 'RB'),
  ('Austin Hooper', 'ATL', 'TE'),
  ('Anthony Richardson Sr.', 'IND', 'QB'),
  ('Jarrett Stidham', 'DEN', 'QB'),
  ('Bryce Lance', 'NO', 'WR'),
  ('Drew Sample', 'CIN', 'TE'),
  ('Justin Watson', 'FA', 'WR'),
  ('Durham Smythe', 'BAL', 'TE'),
  ('Oscar Delp', 'NO', 'TE'),
  ('Greg Dortch', 'BUF', 'WR'),
  ('Luke Farrell', 'SF', 'TE'),
  ('Mitchell Tinsley', 'HOU', 'WR'),
  ('Justin Joly', 'MIA', 'TE'),
  ('Trey Lance', 'LAC', 'QB'),
  ('Riley Leonard', 'IND', 'QB'),
  ('Tyler Conklin', 'DET', 'TE'),
  ('Josh Whyle', 'GB', 'TE'),
  ('Matthew Hibner', 'BAL', 'TE'),
  ('Davis Mills', 'HOU', 'QB'),
  ('Reggie Virgil', 'ARI', 'WR'),
  ('Reggie Gilliam', 'NE', 'RB'),
  ('Mitchell Trubisky', 'TEN', 'QB'),
  ('Cedric Tillman', 'NO', 'WR'),
  ('Gardner Minshew II', 'ARI', 'QB'),
  ('Arian Smith', 'NYJ', 'WR'),
  ('British Brooks', 'HOU', 'RB'),
  ('LaJohntay Wester', 'BAL', 'WR'),
  ('Cooper Rush', 'ATL', 'QB'),
  ('Scotty Miller', 'FA', 'WR'),
  ('Mecole Hardman Jr.', 'FA', 'WR'),
  ('Travis Homer', 'PIT', 'RB'),
  ('David Moore', 'CAR', 'WR'),
  ('Carson Wentz', 'MIN', 'QB'),
  ('Andy Dalton', 'PHI', 'QB'),
  ('Gunner Olszewski', 'NYG', 'WR'),
  ('D''Ernest Johnson', 'FA', 'RB'),
  ('Tom Kennedy', 'DET', 'WR'),
  ('Van Jefferson', 'FA', 'WR'),
  ('Albert Okwuegbunam Jr.', 'LV', 'TE'),
  ('Zach Wilson', 'NO', 'QB'),
  ('Ihmir Smith-Marsette', 'ARI', 'WR'),
  ('D.J. Montgomery', 'IND', 'WR'),
  ('Bailey Zappe', 'NYJ', 'QB'),
  ('Julius Chestnut', 'TEN', 'RB'),
  ('Ronnie Rivers', 'LAR', 'RB'),
  ('Aidan O''Connell', 'LV', 'QB'),
  ('Jaleel McLaughlin', 'CLE', 'RB'),
  ('Baylor Cupp', 'FA', 'TE'),
  ('Dillon Gabriel', 'CLE', 'QB'),
  ('Gavin Bartholomew', 'MIN', 'TE'),
  ('Brady Cook', 'MIA', 'QB'),
  ('Max Brosmer', 'MIN', 'QB'),
  ('Jam Miller', 'FA', 'RB'),
  ('Athan Kaliakmanis', 'WSH', 'QB'),
  ('Garrett Nussmeier', 'KC', 'QB'),
  ('Equanimeous St. Brown', 'FA', 'WR'),
  ('Kareem Hunt', 'FA', 'RB'),
  ('Austin Ekeler', 'FA', 'RB'),
  ('Jamaal Williams', 'FA', 'RB'),
  ('DeAndre Hopkins', 'FA', 'WR'),
  ('Derek Carr', 'FA', 'QB'),
  ('Zach Ertz', 'FA', 'TE'),
  ('Clyde Edwards-Helaire', 'FA', 'RB'),
  ('Antonio Gibson', 'FA', 'RB'),
  ('J.J. Taylor', 'FA', 'RB'),
  ('Dorian Thompson-Robinson', 'FA', 'QB'),
  ('Clayton Tune', 'FA', 'QB'),
  ('Max Duggan', 'FA', 'QB'),
  ('Devin Leary', 'FA', 'QB'),
  ('Thomas Odukoya', 'KC', 'TE'),
  ('D.J. Williams', 'FA', 'RB'),
  ('Marcus Mariota', 'WSH', 'QB'),
  ('Kendrick Bourne', 'ARI', 'WR'),
  ('Malik Benson', 'LV', 'WR'),
  ('Dyami Brown', 'WSH', 'WR'),
  ('Isaiah Williams', 'NYJ', 'WR'),
  ('Will Kacmarek', 'MIA', 'TE'),
  ('Charlie Kolar', 'LAC', 'TE'),
  ('Cade Stover', 'HOU', 'TE'),
  ('Olamide Zaccheaus', 'ATL', 'WR'),
  ('Jeremy Ruckert', 'NYJ', 'TE'),
  ('Davis Allen', 'LAR', 'TE'),
  ('Nate Adkins', 'DEN', 'TE'),
  ('Nate Boerkircher', 'JAX', 'TE'),
  ('Jalen Royals', 'KC', 'WR'),
  ('Payne Durham', 'TB', 'TE'),
  ('Alec Ingold', 'LAC', 'RB'),
  ('Dont''e Thornton Jr.', 'LV', 'WR'),
  ('Tyrell Shavers', 'BUF', 'WR'),
  ('Adam Prentice', 'DEN', 'RB'),
  ('Connor Heyward', 'LV', 'RB'),
  ('Michael Burton', 'CLE', 'RB'),
  ('Max Bredeson', 'MIN', 'RB'),
  ('Malachi Corley', 'CLE', 'WR'),
  ('Ko Kieft', 'TB', 'TE'),
  ('Marlin Klein', 'HOU', 'TE'),
  ('Drew Ogletree', 'IND', 'TE'),
  ('Josh Cuevas', 'BAL', 'TE'),
  ('Eric Saubert', 'SEA', 'TE'),
  ('Andrew Beck', 'NYJ', 'RB'),
  ('Jalen Reagor', 'MIA', 'WR'),
  ('Charlie Jones', 'NYG', 'WR'),
  ('Britain Covey', 'PHI', 'WR'),
  ('Nikko Remigio', 'KC', 'WR'),
  ('Josh Cameron', 'JAX', 'WR'),
  ('Jalen Brooks', 'ARI', 'WR'),
  ('Mason Kinsey', 'FA', 'WR'),
  ('Robert Tonyan', 'PIT', 'TE'),
  ('River Cracraft', 'FA', 'WR'),
  ('Cedrick Wilson Jr.', 'FA', 'WR'),
  ('Brandon Allen', 'FA', 'QB'),
  ('Dare Ogunbowale', 'LV', 'RB'),
  ('KhaDarel Hodge', 'SF', 'WR'),
  ('Trayveon Williams', 'FA', 'RB'),
  ('Ameer Abdullah', 'JAX', 'RB'),
  ('Easton Stick', 'TB', 'QB'),
  ('Case Keenum', 'CHI', 'QB'),
  ('Josh Johnson', 'CIN', 'QB'),
  ('Trenton Irwin', 'FA', 'WR'),
  ('K.J. Osborn', 'TEN', 'WR'),
  ('JaMycal Hasty', 'FA', 'RB'),
  ('Salvon Ahmed', 'CHI', 'RB'),
  ('Trey Sermon', 'ATL', 'RB'),
  ('Elijah Moore', 'PHI', 'WR'),
  ('Sam Ehlinger', 'DEN', 'QB'),
  ('Cody White', 'LV', 'WR'),
  ('Patrick Taylor Jr.', 'FA', 'RB'),
  ('Velus Jones Jr.', 'SEA', 'RB'),
  ('Dameon Pierce', 'PHI', 'RB'),
  ('Grant Calcaterra', 'PHI', 'TE'),
  ('Teagan Quitoriano', 'ARI', 'TE'),
  ('Skylar Thompson', 'BAL', 'QB'),
  ('Chris Oladokun', 'KC', 'QB'),
  ('Raheem Blackshear', 'FA', 'RB'),
  ('Hendon Hooker', 'TEN', 'QB'),
  ('Cameron Latu', 'NE', 'TE'),
  ('Scott Matlock', 'LAC', 'RB'),
  ('Jake Haener', 'NYG', 'QB'),
  ('Julian Hill', 'NE', 'TE'),
  ('Brady Russell', 'SEA', 'RB'),
  ('Tyler Goodson', 'ATL', 'RB'),
  ('Jamari Thrash', 'CLE', 'WR'),
  ('Sione Vaki', 'DET', 'RB'),
  ('Colson Yankoff', 'WSH', 'TE'),
  ('Sincere McCormick', 'SF', 'RB'),
  ('Chris Collier', 'LV', 'RB'),
  ('Mitchell Evans', 'CAR', 'TE'),
  ('Kurtis Rourke', 'SF', 'QB'),
  ('Dominic Lovett', 'DET', 'WR'),
  ('Lan Larison', 'NE', 'RB'),
  ('Raheim Sanders', 'CLE', 'RB'),
  ('Beaux Collins', 'ATL', 'WR'),
  ('Zavier Scott', 'CHI', 'RB'),
  ('Drake Dabney', 'GB', 'TE'),
  ('Taylen Green', 'CLE', 'QB'),
  ('Cole Payton', 'PHI', 'QB'),
  ('C.J. Ham', 'FA', 'RB'),
  ('Hunter Renfrow', 'FA', 'WR'),
  ('Cordarrelle Patterson', 'FA', 'RB'),
  ('Tim Boyle', 'FA', 'QB'),
  ('Anthony Miller', 'FA', 'WR'),
  ('Gus Edwards', 'FA', 'RB'),
  ('Amari Cooper', 'FA', 'WR'),
  ('Adam Thielen', 'FA', 'WR'),
  ('Khari Blasingame', 'FA', 'RB'),
  ('Cam Akers', 'FA', 'RB'),
  ('Zack Moss', 'FA', 'RB'),
  ('Darrynton Evans', 'FA', 'RB'),
  ('Khalil Herbert', 'FA', 'RB'),
  ('Desmond Ridder', 'FA', 'QB'),
  ('Deuce Vaughn', 'FA', 'RB'),
  ('Kenny McIntosh', 'FA', 'RB'),
  ('Jaren Hall', 'FA', 'QB'),
  ('Chase Cota', 'FA', 'WR'),
  ('Xazavian Valladay', 'FA', 'RB'),
  ('Nathan Rourke', 'FA', 'QB'),
  ('SaRodorick Thompson Jr.', 'FA', 'RB'),
  ('Louis Rees-Zammit', 'FA', 'RB'),
  ('Terrell Jennings', 'FA', 'RB'),
  ('Aaron Shampklin', 'FA', 'RB'),
  ('Joshua Cephus', 'FA', 'WR'),
  ('Jaylen Johnson', 'FA', 'WR'),
  ('Erick All Jr.', 'CIN', 'TE'),
  ('DeeJay Dallas', 'MIN', 'RB'),
  ('Treylon Burks', 'WSH', 'WR'),
  ('Jaylin Lane', 'WSH', 'WR'),
  ('John Bates', 'WSH', 'TE'),
  ('Kevin Coleman Jr.', 'MIA', 'WR'),
  ('Tanner Hudson', 'CIN', 'TE'),
  ('Daniel Bellinger', 'TEN', 'TE'),
  ('Ben Sinnott', 'WSH', 'TE'),
  ('Foster Moreau', 'HOU', 'TE'),
  ('Mason Tipton', 'NO', 'WR'),
  ('Ben Sims', 'MIA', 'TE'),
  ('Jason Myers', 'SEA', 'K'),
  ('Ryan Flournoy', 'DAL', 'WR'),
  ('Denzel Boston', 'CLE', 'WR'),
  ('Malik Washington', 'MIA', 'WR'),
  ('Ray Davis', 'BUF', 'RB'),
  ('Jalen Nailor', 'LV', 'WR'),
  ('Jacoby Brissett', 'ARI', 'QB'),
  ('Travis Hunter', 'JAX', 'WR'),
  ('Jaylin Noel', 'HOU', 'WR'),
  ('Sam Darnold', 'SEA', 'QB'),
  ('Aaron Rodgers', 'PIT', 'QB'),
  ('Kimani Vidal', 'LAC', 'RB'),
  ('Sean Tucker', 'TB', 'RB'),
  ('Jerry Jeudy', 'CLE', 'WR'),
  ('C.J. Stroud', 'HOU', 'QB'),
  ('Greg Dulcich', 'MIA', 'TE'),
  ('Troy Franklin', 'DEN', 'WR'),
  ('Cam Little', 'JAX', 'K'),
  ('Ka''imi Fairbairn', 'HOU', 'K'),
  ('Nicholas Singleton', 'TEN', 'RB'),
  ('Isaac TeSlaa', 'DET', 'WR'),
  ('James Conner', 'ARI', 'RB'),
  ('Gunnar Helm', 'TEN', 'TE'),
  ('Oronde Gadsden II', 'LAC', 'TE'),
  ('AJ Barner', 'SEA', 'TE'),
  ('Ja''Kobi Lane', 'BAL', 'WR'),
  ('Calvin Ridley', 'TEN', 'WR'),
  ('Darnell Mooney', 'NYG', 'WR'),
  ('Rashod Bateman', 'BAL', 'WR'),
  ('Tyler Loop', 'BAL', 'K'),
  ('Chris Bell', 'MIA', 'WR'),
  ('Jalen McMillan', 'TB', 'WR'),
  ('Geno Smith', 'NYJ', 'QB'),
  ('Terrance Ferguson', 'LAR', 'TE'),
  ('Kaelon Black', 'SF', 'RB'),
  ('Harrison Mevis', 'LAR', 'K'),
  ('Zachariah Branch', 'ATL', 'WR'),
  ('Justice Hill', 'BAL', 'RB'),
  ('Chad Ryland', 'ARI', 'K'),
  ('Kaytron Allen', 'WSH', 'RB'),
  ('Blake Grupe', 'NYJ', 'K'),
  ('Germie Bernard', 'PIT', 'WR'),
  ('De''Zhaun Stribling', 'SF', 'WR'),
  ('Cam Ward', 'TEN', 'QB'),
  ('Adonai Mitchell', 'NYJ', 'WR'),
  ('Emanuel Wilson', 'SEA', 'RB'),
  ('Malik Davis', 'DAL', 'RB'),
  ('Brandon McManus', 'FA', 'K'),
  ('Daniel Jones', 'IND', 'QB'),
  ('Antonio Williams', 'WSH', 'WR'),
  ('Andre Szmyt', 'CLE', 'K'),
  ('Jaylen Wright', 'MIA', 'RB'),
  ('Tank Dell', 'HOU', 'WR'),
  ('Ryan Fitzgerald', 'CAR', 'K'),
  ('Devin Neal', 'NO', 'RB'),
  ('Cade Otton', 'TB', 'TE'),
  ('Jake Bates', 'DET', 'K'),
  ('Matt Prater', 'FA', 'K'),
  ('George Holani', 'SEA', 'RB'),
  ('Bryce Young', 'CAR', 'QB'),
  ('Daniel Carlson', 'NO', 'K'),
  ('Ted Hurst III', 'TB', 'WR'),
  ('Zane Gonzalez', 'FA', 'K'),
  ('Jack Bech', 'LV', 'WR'),
  ('Kirk Cousins', 'LV', 'QB'),
  ('Fernando Mendoza', 'LV', 'QB'),
  ('Andy Borregales', 'NE', 'K'),
  ('Devaughn Vele', 'NO', 'WR'),
  ('Keon Coleman', 'BUF', 'WR'),
  ('Kaleb Johnson', 'GB', 'RB'),
  ('Jake Moody', 'BAL', 'K'),
  ('Eli Stowers', 'PHI', 'TE'),
  ('Chris Brooks', 'GB', 'RB'),
  ('Michael Badgley', 'FA', 'K'),
  ('Cyrus Allen', 'KC', 'WR'),
  ('Chimere Dike', 'TEN', 'WR'),
  ('Demond Claiborne', 'MIN', 'RB'),
  ('Caleb Douglas', 'MIA', 'WR'),
  ('Joshua Karty', 'FA', 'K'),
  ('Tre Tucker', 'LV', 'WR'),
  ('Ollie Gordon II', 'MIA', 'RB'),
  ('Pat Freiermuth', 'PIT', 'TE'),
  ('Harrison Butker', 'KC', 'K'),
  ('Spencer Shrader', 'IND', 'K'),
  ('Samaje Perine', 'CIN', 'RB'),
  ('Parker Romo', 'FA', 'K'),
  ('Isaiah Davis', 'NYJ', 'RB'),
  ('Graham Gano', 'FA', 'K'),
  ('Tory Horton', 'SEA', 'WR'),
  ('Trey Benson', 'ARI', 'RB'),
  ('Younghoe Koo', 'FA', 'K'),
  ('Jordan James', 'SF', 'RB'),
  ('Eddy Pineiro', 'SF', 'K'),
  ('Ben Sauls', 'FA', 'K'),
  ('LeQuint Allen Jr.', 'JAX', 'RB'),
  ('Matthew Wright', 'FA', 'K'),
  ('Ty Johnson', 'BUF', 'RB'),
  ('Chris Boswell', 'PIT', 'K'),
  ('Tyquan Thornton', 'KC', 'WR'),
  ('Elic Ayomanor', 'TEN', 'WR'),
  ('Lucas Havrisik', 'FA', 'K'),
  ('Malachi Fields', 'NYG', 'WR'),
  ('Colby Parkinson', 'LAR', 'TE'),
  ('Jude McAtamney', 'FA', 'K'),
  ('Seth McGowan', 'IND', 'RB'),
  ('Will Reichard', 'MIN', 'K'),
  ('Darren Waller', 'CAR', 'TE'),
  ('Seattle Seahawks D/ST', 'SEA', 'D/ST'),
  ('Trey Smack', 'GB', 'K'),
  ('Houston Texans D/ST', 'HOU', 'D/ST'),
  ('Xavier Legette', 'CAR', 'WR'),
  ('Jacksonville Jaguars D/ST', 'JAX', 'D/ST'),
  ('DeMario Douglas', 'NE', 'WR'),
  ('Najee Harris', 'NYG', 'RB'),
  ('Marvin Mims Jr.', 'DEN', 'WR'),
  ('Denver Broncos D/ST', 'DEN', 'D/ST'),
  ('Jaydon Blue', 'PHI', 'RB'),
  ('Minnesota Vikings D/ST', 'MIN', 'D/ST'),
  ('Jarquez Hunter', 'MIA', 'RB'),
  ('Darius Slayton', 'NYG', 'WR'),
  ('Carson Beck', 'ARI', 'QB'),
  ('Los Angeles Rams D/ST', 'LAR', 'D/ST'),
  ('Christian Kirk', 'SF', 'WR'),
  ('Philadelphia Eagles D/ST', 'PHI', 'D/ST'),
  ('Tyler Bass', 'BUF', 'K'),
  ('Mason Taylor', 'NYJ', 'TE'),
  ('Cleveland Browns D/ST', 'CLE', 'D/ST'),
  ('Joe Flacco', 'CIN', 'QB'),
  ('Kyle Williams', 'NE', 'WR'),
  ('Mike Gesicki', 'CIN', 'TE'),
  ('Evan Engram', 'DEN', 'TE'),
  ('Pittsburgh Steelers D/ST', 'PIT', 'D/ST'),
  ('Kendre Miller', 'NO', 'RB'),
  ('Wil Lutz', 'DEN', 'K'),
  ('New England Patriots D/ST', 'NE', 'D/ST'),
  ('DJ Giddens', 'IND', 'RB'),
  ('Keenan Allen', 'IND', 'WR'),
  ('Shedeur Sanders', 'CLE', 'QB'),
  ('Atlanta Falcons D/ST', 'ATL', 'D/ST'),
  ('Chase McLaughlin', 'TB', 'K'),
  ('Tua Tagovailoa', 'ATL', 'QB'),
  ('Mack Hollins', 'NE', 'WR'),
  ('New Orleans Saints D/ST', 'NO', 'D/ST'),
  ('Michael Penix Jr.', 'ATL', 'QB'),
  ('Chicago Bears D/ST', 'CHI', 'D/ST'),
  ('Andrei Iosivas', 'CIN', 'WR'),
  ('Los Angeles Chargers D/ST', 'LAC', 'D/ST'),
  ('Cairo Santos', 'CHI', 'K'),
  ('Jahan Dotson', 'ATL', 'WR'),
  ('Justin Fields', 'KC', 'QB'),
  ('Buffalo Bills D/ST', 'BUF', 'D/ST'),
  ('Theo Johnson', 'NYG', 'TE'),
  ('Carolina Panthers D/ST', 'CAR', 'D/ST'),
  ('Brashard Smith', 'KC', 'RB'),
  ('Xavier Hutchinson', 'HOU', 'WR'),
  ('Indianapolis Colts D/ST', 'IND', 'D/ST'),
  ('Devin Singletary', 'NYG', 'RB'),
  ('Tampa Bay Buccaneers D/ST', 'TB', 'D/ST'),
  ('J.J. McCarthy', 'MIN', 'QB'),
  ('Deshaun Watson', 'CLE', 'QB'),
  ('Baltimore Ravens D/ST', 'BAL', 'D/ST'),
  ('Adam Randall', 'BAL', 'RB'),
  ('Detroit Lions D/ST', 'DET', 'D/ST'),
  ('Jake Tonges', 'SF', 'TE'),
  ('Emari Demercado', 'DAL', 'RB'),
  ('Miami Dolphins D/ST', 'MIA', 'D/ST'),
  ('Jalen Tolbert', 'MIA', 'WR'),
  ('Kansas City Chiefs D/ST', 'KC', 'D/ST'),
  ('Michael Mayer', 'LV', 'TE'),
  ('Cooper Kupp', 'SEA', 'WR'),
  ('Tennessee Titans D/ST', 'TEN', 'D/ST'),
  ('Max Klare', 'LAR', 'TE'),
  ('Evan McPherson', 'CIN', 'K'),
  ('Dohnte Meyers', 'CIN', 'WR'),
  ('Michael Trigg', 'DAL', 'TE'),
  ('Jake Elliott', 'PHI', 'K'),
  ('Cincinnati Bengals D/ST', 'CIN', 'D/ST'),
  ('Chris Brazzell II', 'CAR', 'WR'),
  ('Trevor Etienne', 'CAR', 'RB'),
  ('Green Bay Packers D/ST', 'GB', 'D/ST'),
  ('Isaac Guerendo', 'SF', 'RB'),
  ('Joey Slye', 'TEN', 'K'),
  ('San Francisco 49ers D/ST', 'SF', 'D/ST'),
  ('Drew Stevens', 'WSH', 'K'),
  ('Arizona Cardinals D/ST', 'ARI', 'D/ST'),
  ('Tahj Brooks', 'CIN', 'RB'),
  ('New York Giants D/ST', 'NYG', 'D/ST'),
  ('Will Shipley', 'PHI', 'RB'),
  ('Bam Knight', 'ARI', 'RB'),
  ('Washington Commanders D/ST', 'WSH', 'D/ST'),
  ('Audric Estimé', 'NO', 'RB'),
  ('Las Vegas Raiders D/ST', 'LV', 'D/ST'),
  ('Chris Blair', 'ATL', 'WR'),
  ('Dallas Cowboys D/ST', 'DAL', 'D/ST'),
  ('Lew Nichols III', 'PIT', 'RB'),
  ('Matt Gay', 'LV', 'K'),
  ('Charlie Smyth', 'NO', 'K'),
  ('New York Jets D/ST', 'NYJ', 'D/ST'),
  ('Michael Carter', 'TEN', 'RB'),
  ('Rasheen Ali', 'BAL', 'RB'),
  ('Elijah Sarratt', 'BAL', 'WR'),
  ('Riley Patterson', 'MIA', 'K'),
  ('Jordan Watkins', 'SF', 'WR'),
  ('Ty Simpson', 'LAR', 'QB'),
  ('Hollywood Brown', 'PHI', 'WR'),
  ('Jaydn Ott', 'KC', 'RB'),
  ('Nick Folk', 'ATL', 'K'),
  ('Xavier Restrepo', 'TEN', 'WR'),
  ('J''Mari Taylor', 'JAX', 'RB'),
  ('Kalel Mullings', 'TEN', 'RB'),
  ('Corey Kiner', 'NE', 'RB'),
  ('Jeremy McNichols', 'WSH', 'RB'),
  ('Jerome Ford', 'FA', 'RB'),
  ('John Metchie III', 'CAR', 'WR'),
  ('Ashton Dulin', 'IND', 'WR'),
  ('Dylan Laube', 'LV', 'RB'),
  ('Theo Wease Jr.', 'LAC', 'WR'),
  ('Dominic Zvada', 'NYG', 'K'),
  ('Jawhar Jordan', 'HOU', 'RB'),
  ('Tutu Atwell', 'LAR', 'WR'),
  ('Brenen Thompson', 'LAC', 'WR'),
  ('Savion Williams', 'GB', 'WR'),
  ('Jacob Cowing', 'SF', 'WR'),
  ('Kene Nwangwu', 'NYJ', 'RB'),
  ('Ja''Tavion Sanders', 'CAR', 'TE'),
  ('Kevin Austin Jr.', 'NO', 'WR'),
  ('Jack Strand', 'ATL', 'QB'),
  ('Nick Westbrook-Ikhine', 'IND', 'WR'),
  ('Jonnu Smith', 'GB', 'TE'),
  ('Jason Sanders', 'NYJ', 'K'),
  ('Brittain Brown', 'CHI', 'RB'),
  ('Kendrick Law', 'DET', 'WR'),
  ('Deion Burks', 'IND', 'WR'),
  ('Tanner Koziol', 'JAX', 'TE'),
  ('Joshua Palmer', 'BUF', 'WR'),
  ('Jelani Woods', 'NYJ', 'TE'),
  ('Jimmy Horn Jr.', 'CAR', 'WR'),
  ('Skyler Bell', 'BUF', 'WR'),
  ('Tyler Badie', 'DEN', 'RB'),
  ('Kansei Matsuzawa', 'LV', 'K'),
  ('Kyle McCord', 'MIA', 'QB'),
  ('Jalon Daniels', 'TB', 'QB'),
  ('Haynes King', 'CAR', 'QB'),
  ('Nick Mullens', 'JAX', 'QB'),
  ('Luke Altmyer', 'DET', 'QB'),
  ('Jack Endries', 'CIN', 'TE'),
  ('Bauer Sharp', 'TB', 'TE'),
  ('Graham Mertz', 'HOU', 'QB'),
  ('Seydou Traore', 'MIA', 'TE'),
  ('Behren Morton', 'NE', 'QB'),
  ('Charlie Woerner', 'ATL', 'TE'),
  ('Joe Fagnano', 'BAL', 'QB'),
  ('Khalil Dinkins', 'SF', 'TE'),
  ('Joe Royer', 'CLE', 'TE'),
  ('Jared Wiley', 'KC', 'TE'),
  ('Johnny Mundt', 'PHI', 'TE'),
  ('Blake Whiteheart', 'CLE', 'TE'),
  ('Carsen Ryan', 'CLE', 'TE'),
  ('DJ Uiagalelei', 'LAC', 'QB'),
  ('Sam Hartman', 'WSH', 'QB'),
  ('Moliki Matavao', 'NO', 'TE'),
  ('Ian Thomas', 'LV', 'TE'),
  ('Shane Buechele', 'BUF', 'QB'),
  ('Ben Yurosek', 'MIN', 'TE'),
  ('Kylen Granson', 'TEN', 'TE'),
  ('Hunter Long', 'ARI', 'TE'),
  ('Joel Wilson', 'TEN', 'TE'),
  ('Brevin Jordan', 'HOU', 'TE'),
  ('Will Mallory', 'IND', 'TE'),
  ('Chris Manhertz', 'NYG', 'TE'),
  ('Stone Smartt', 'NO', 'TE'),
  ('Thomas Fidone II', 'NYG', 'TE'),
  ('Tip Reiman', 'ARI', 'TE'),
  ('Joshua Simon', 'WSH', 'TE'),
  ('Pharaoh Brown', 'IND', 'TE'),
  ('Dallen Bentley', 'DEN', 'TE'),
  ('Ty Pezza', 'BAL', 'WR'),
  ('Robert Henry Jr.', 'WSH', 'RB'),
  ('Nick Kallerup', 'SEA', 'TE'),
  ('Keleki Latu', 'BUF', 'TE'),
  ('Jake Briningstool', 'KC', 'TE'),
  ('Cash Jones', 'ATL', 'RB'),
  ('Noah Whittington', 'HOU', 'RB'),
  ('Jaren Kanak', 'TEN', 'TE'),
  ('Pierre Strong', 'GB', 'RB'),
  ('Quintin Morris', 'JAX', 'TE'),
  ('Ahmani Marshall', 'CAR', 'RB'),
  ('CJ Donaldson', 'NO', 'RB'),
  ('Zamir White', 'NO', 'RB'),
  ('Hayden Large', 'CHI', 'TE'),
  ('Roman Hemby', 'LV', 'RB'),
  ('Lucas Krull', 'DEN', 'TE'),
  ('Carter Runyon', 'LV', 'TE'),
  ('James Mitchell', 'DAL', 'TE'),
  ('Myles Montgomery', 'NE', 'RB'),
  ('Jack Westover', 'WSH', 'TE'),
  ('Craig Reynolds', 'WSH', 'RB'),
  ('CJ Dippre', 'TB', 'TE'),
  ('Nick Vannett', 'BAL', 'TE'),
  ('Hayden Rucci', 'JAX', 'TE'),
  ('Cole Turner', 'MIA', 'TE'),
  ('Jared Wayne', 'HOU', 'WR'),
  ('Hassan Haskins', 'NE', 'RB'),
  ('Dalevon Campbell', 'LAC', 'WR'),
  ('Coleman Owen', 'IND', 'WR'),
  ('Tay Martin', 'DET', 'WR'),
  ('Brycen Tremayne', 'CAR', 'WR'),
  ('Derius Davis', 'LAC', 'WR'),
  ('Montorie Foster Jr', 'SEA', 'WR'),
  ('Casey Washington', 'CAR', 'WR'),
  ('Michael Bandy', 'DEN', 'WR'),
  ('J. Michael Sturdivant', 'GB', 'WR'),
  ('Laquon Treadwell', 'IND', 'WR'),
  ('Michael Wortham', 'JAX', 'WR'),
  ('Michael Briscoe', 'MIN', 'WR'),
  ('Julian Hicks', 'SEA', 'WR'),
  ('Emmanuel Henderson Jr.', 'SEA', 'WR'),
  ('Tylan Wallace', 'CLE', 'WR'),
  ('Devin Duvernay', 'ARI', 'WR'),
  ('Kameron Johnson', 'TB', 'WR'),
  ('Anthony Gould', 'IND', 'WR'),
  ('Ryan Miller', 'MIA', 'WR'),
  ('C.J. Williams', 'JAX', 'WR'),
  ('Dareke Young', 'LV', 'WR'),
  ('Ke''Shawn Williams', 'CIN', 'WR'),
  ('Simi Fehoko', 'ARI', 'WR'),
  ('Camden Brown', 'DAL', 'WR'),
  ('Ricky White III', 'SEA', 'WR'),
  ('Vinny Anthony II', 'ATL', 'WR'),
  ('Ronnie Bell', 'LV', 'WR'),
  ('Lewis Bond', 'HOU', 'WR'),
  ('Jalin Hyatt', 'NYG', 'WR'),
  ('Alex Bachman', 'LAR', 'WR'),
  ('Jackson Meeks', 'DET', 'TE'),
  ('Johnny Wilson', 'PHI', 'WR'),
  ('Al-Jay Henderson', 'NYJ', 'RB'),
  ('Amar Johnson', 'LAC', 'RB'),
  ('Anderson Castle', 'IND', 'RB'),
  ('Andrew Armstrong', 'KC', 'WR'),
  ('Anthony Smith', 'DAL', 'WR'),
  ('Anthony Tyus III', 'CAR', 'RB'),
  ('Antwane Wells Jr.', 'ATL', 'WR'),
  ('Austin Trammell', 'JAX', 'WR'),
  ('Ben VanSumeren', 'KC', 'RB'),
  ('Brandon Johnson', 'PIT', 'WR'),
  ('Brandon Smith', 'PIT', 'WR'),
  ('Brennan Presley', 'LAR', 'WR'),
  ('Brock Rechsteiner', 'NO', 'WR'),
  ('Bryce Oliver', 'CLE', 'WR'),
  ('Bryson Nesbit', 'MIN', 'TE'),
  ('Caleb Lohner', 'DEN', 'TE'),
  ('Cam Grandy', 'MIN', 'TE'),
  ('Cameron Dorner', 'NE', 'WR'),
  ('Carlos Washington', 'MIA', 'RB'),
  ('Carson Steele', 'PHI', 'RB'),
  ('Carson Towt', 'IND', 'TE'),
  ('Carter Bradley', 'JAX', 'QB'),
  ('Chase Roberts', 'LV', 'WR'),
  ('Chip Trayanum', 'NYJ', 'RB'),
  ('Chris Hilton Jr.', 'GB', 'WR'),
  ('Chris Moore', 'BAL', 'WR'),
  ('Chris Myarick', 'LV', 'TE'),
  ('Cody Schrader', 'DEN', 'RB'),
  ('Cole Burgess', 'PIT', 'WR'),
  ('Connor Hulstein', 'NYJ', 'TE'),
  ('Corey Rucker', 'LV', 'WR'),
  ('Dalen Cambre', 'NYG', 'WR'),
  ('Dan Villari', 'LAR', 'TE'),
  ('Dane Key', 'DEN', 'WR'),
  ('Daniel Sobkowicz', 'HOU', 'WR'),
  ('Danny Gray', 'PHI', 'WR'),
  ('David Martin-Robinson', 'TEN', 'TE'),
  ('David Sills', 'TB', 'WR'),
  ('Davon Booth', 'IND', 'RB'),
  ('Dean Connors', 'LAR', 'RB'),
  ('Dean Patterson IV', 'TB', 'WR'),
  ('Deven Thompkins', 'LV', 'WR'),
  ('Dillon Bell', 'MIN', 'WR'),
  ('DJ Herman', 'MIA', 'RB'),
  ('DJ Rogers', 'DAL', 'TE'),
  ('Dominic Richardson', 'NYJ', 'RB'),
  ('Dontae Fleming', 'MIN', 'WR'),
  ('Dylan Drummond', 'ATL', 'WR'),
  ('E.J. Jenkins', 'PHI', 'TE'),
  ('EJ Smith', 'KC', 'RB'),
  ('Eric Rivers Jr.', 'TB', 'WR'),
  ('Evan Hull', 'ARI', 'RB'),
  ('Evan Svoboda', 'LAC', 'TE'),
  ('Feleipe Franks', 'CAR', 'TE'),
  ('Garrett Greene', 'TB', 'WR'),
  ('Gary Jennings', 'LAC', 'WR'),
  ('Grant Finley', 'NYG', 'RB'),
  ('Gregory Desrosiers', 'LAC', 'RB'),
  ('Harrison Wallace III', 'ARI', 'WR'),
  ('Irvin Charles', 'SEA', 'WR'),
  ('Isaiah Neyor', 'GB', 'WR'),
  ('Ja''Mori Maclin', 'BUF', 'WR'),
  ('Ja''Seem Reed', 'CAR', 'WR'),
  ('Jacardia Wright', 'SEA', 'RB'),
  ('Jack Velling', 'ATL', 'TE'),
  ('Jacoby Jones', 'WSH', 'WR'),
  ('Jaden Bradley', 'WSH', 'WR'),
  ('Jalen Moreno-Cropper', 'NO', 'WR'),
  ('Jamaal Pritchett', 'NYJ', 'WR'),
  ('Jameson Geers', 'ARI', 'TE'),
  ('Jeff Caldwell', 'KC', 'WR'),
  ('Jeremiah Webb', 'NE', 'WR'),
  ('Jeshaun Jones', 'MIN', 'WR'),
  ('Jimmy Holiday', 'KC', 'WR'),
  ('Joey Aguilar', 'JAX', 'QB'),
  ('John Michael Gyllenborg', 'KC', 'TE'),
  ('Jonathan Ward', 'BAL', 'RB'),
  ('Jordan Hudson', 'DAL', 'WR'),
  ('Jordan Moore', 'CIN', 'WR'),
  ('Jordan Waters', 'LAR', 'RB'),
  ('Josh Kelly', 'HOU', 'WR'),
  ('JP Richardson', 'CHI', 'WR'),
  ('Justin Shorter', 'LV', 'WR'),
  ('Kaden Davis', 'CHI', 'WR'),
  ('Kedon Slovis', 'GB', 'QB'),
  ('Kendall Milton', 'CIN', 'RB'),
  ('Kentrel Bullock', 'CIN', 'RB'),
  ('Kolbe Katsis', 'DEN', 'WR'),
  ('Kole Wilson', 'CLE', 'WR'),
  ('Kyle Dixon', 'NE', 'WR'),
  ('Lake McRee', 'PIT', 'TE'),
  ('Lenny Krieg', 'GB', 'K'),
  ('Lucky Jackson', 'DET', 'WR'),
  ('Malik McClain', 'NYJ', 'WR'),
  ('Mark Redman', 'GB', 'TE'),
  ('Matthew Caldwell', 'LAR', 'QB'),
  ('Max Hurleman', 'PIT', 'WR'),
  ('McCallan Castles', 'GB', 'TE'),
  ('Messiah Swinson', 'CLE', 'TE'),
  ('Mitch Van Vooren', 'DAL', 'TE'),
  ('Nate Carter', 'KC', 'RB'),
  ('Nick Muse', 'ATL', 'TE'),
  ('Nikola Kalinic', 'CHI', 'TE'),
  ('Noah Thomas', 'CIN', 'WR'),
  ('Omari Evans', 'KC', 'WR'),
  ('Patrick Herbert', 'LAC', 'TE'),
  ('Princeton Fant', 'DAL', 'TE'),
  ('Qadir Ismail', 'CHI', 'TE'),
  ('Quentin Moore', 'WSH', 'TE'),
  ('Robbie Ouzts', 'SEA', 'RB'),
  ('Scott Miller', 'CHI', 'WR'),
  ('Sean Clifford', 'CIN', 'QB'),
  ('Shane Zylstra', 'NE', 'TE'),
  ('Shawn Bowman', 'ARI', 'TE'),
  ('Sincere Brown', 'LAC', 'WR'),
  ('Stephen Carlson', 'CHI', 'TE'),
  ('Stephen Gosnell', 'BUF', 'WR'),
  ('Tanner Arkin', 'NE', 'TE'),
  ('Thomas Gordon', 'DET', 'TE'),
  ('Thomas Yassmin', 'GB', 'TE'),
  ('Tim Jones', 'JAX', 'WR'),
  ('Trayvon Rudolph', 'MIN', 'WR'),
  ('Tre Watson', 'MIA', 'TE'),
  ('Trebor Pena', 'JAX', 'WR'),
  ('Trent Sherfield', 'BUF', 'WR'),
  ('Trey Palmer', 'NO', 'WR'),
  ('Treyton Welch', 'NO', 'TE'),
  ('Ty Chandler', 'NO', 'RB'),
  ('Tyren Montgomery', 'TEN', 'WR'),
  ('Wesley Grimes', 'SF', 'WR'),
  ('Will Pauling', 'SF', 'WR'),
  ('Will Sheppard', 'MIA', 'WR'),
  ('Xavier Guillory', 'BAL', 'WR'),
  ('Zaire Mitchell-Paden', 'HOU', 'TE')
on conflict (name) do nothing;
