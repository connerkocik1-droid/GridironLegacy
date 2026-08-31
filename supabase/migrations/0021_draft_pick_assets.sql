-- Future draft picks, as things you can own.
--
-- A dynasty league is only a dynasty if next year is worth something today.
-- Until now a draft pick existed only as a row on this season's board, which
-- meant a rebuilding team had nothing to sell and a contender had nothing to
-- buy with. This gives every franchise a pick per round per season, owned
-- separately from the board, so they can change hands.
--
-- Two ideas are kept apart on purpose:
--
--   origin_manager  whose record decides where in the round the pick falls.
--                   Never changes. Trading your first-rounder away does not
--                   make it a better pick.
--   manager_id      who holds it. A trade moves this and nothing else.
--
-- Order is the inverse of the record: worst picks first. It is recomputed
-- nightly rather than fixed, because a record is not final until the season
-- is, and a pick's value should move with the team it came from.

-- ---------------------------------------------------------------------------
-- Which season the league started in
-- ---------------------------------------------------------------------------
-- The inaugural draft is the one everybody is here for, and its picks are not
-- currency: trading them away before a ball is thrown is how a league loses a
-- manager in week one. Every later season is fair game.

alter table leagues add column if not exists inaugural_season int;
update leagues set inaugural_season = season where inaugural_season is null;
alter table leagues alter column inaugural_season set default 2026;
alter table leagues alter column inaugural_season set not null;

-- ---------------------------------------------------------------------------
-- The picks
-- ---------------------------------------------------------------------------

create table if not exists draft_pick_assets (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references leagues(id) on delete cascade,
  season         int not null,
  round          int not null,
  -- Whose record places this pick within its round.
  origin_manager uuid not null references managers(id) on delete cascade,
  -- Who owns it now.
  manager_id     uuid not null references managers(id) on delete cascade,
  -- Position in the round, 1 first. Null until the order has been computed.
  slot           int,
  created_at     timestamptz not null default now(),

  -- One pick per franchise per round per season. This is what stops a nightly
  -- job that runs twice from handing out two first-rounders.
  unique (league_id, season, round, origin_manager),
  constraint draft_pick_assets_round_positive check (round >= 1),
  constraint draft_pick_assets_slot_positive check (slot is null or slot >= 1)
);

-- Both manager columns are foreign keys and both are queried directly: the
-- holder for "what do I own", the origin for cascades and for the order.
create index if not exists draft_pick_assets_holder_idx
  on draft_pick_assets (manager_id, season, round);
create index if not exists draft_pick_assets_origin_idx
  on draft_pick_assets (origin_manager);
create index if not exists draft_pick_assets_league_season_idx
  on draft_pick_assets (league_id, season, round, slot);

alter table draft_pick_assets enable row level security;

-- Everyone in the league sees every pick. Who holds what is exactly the
-- information a trade market runs on.
drop policy if exists pick_assets_read on draft_pick_assets;
create policy pick_assets_read on draft_pick_assets
  for select using (league_id = (select league_id from current_manager()));

-- No direct writes at all. Picks are created by the nightly award and moved by
-- execute_trade, both of which check what a manager may not be trusted to.
grant select on draft_pick_assets to authenticated;

-- ---------------------------------------------------------------------------
-- Whether a season's picks may be traded
-- ---------------------------------------------------------------------------

create or replace function picks_are_tradeable(p_league_id uuid, p_season int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_season > l.inaugural_season from leagues l where l.id = p_league_id;
$$;

-- ---------------------------------------------------------------------------
-- The order: the inverse of the record
-- ---------------------------------------------------------------------------

create or replace function set_draft_pick_order(p_league_id uuid, p_season int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_touched int;
begin
  -- Worst record picks first. Win percentage rather than wins, so a franchise
  -- on a bye week is not punished for having played fewer games; points scored
  -- breaks a tie, because two 4-9 teams are not equally bad.
  --
  -- Before a week has been graded every record is identical, and the order
  -- falls back to the franchise slot. That is arbitrary but stable — it stops
  -- the nightly run from reshuffling the board for no reason — and it is
  -- replaced by something real the moment a game is settled.
  with ranked as (
    select s.manager_id,
           row_number() over (
             order by case when s.wins + s.losses + s.ties = 0
                           then 0
                           else (s.wins + s.ties * 0.5)::numeric
                                  / (s.wins + s.losses + s.ties)
                      end asc,
                      s.points_for asc,
                      s.slot asc
           )::int as position
      from standings(p_league_id) s
  )
  update draft_pick_assets a
     set slot = r.position
    from ranked r
   where a.league_id = p_league_id
     and a.season = p_season
     and a.origin_manager = r.manager_id
     and a.slot is distinct from r.position;

  get diagnostics v_touched = row_count;
  return v_touched;
end;
$$;

revoke all on function set_draft_pick_order(uuid, int) from public;

-- ---------------------------------------------------------------------------
-- Handing them out
-- ---------------------------------------------------------------------------

create or replace function award_draft_picks(p_league_id uuid, p_season int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league  leagues;
  v_season  int;
  v_rounds  int;
  v_created int;
  v_ordered int;
begin
  select * into v_league from leagues where id = p_league_id;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  -- Next season unless told otherwise. "Next" is the one after the season the
  -- league is currently playing.
  v_season := coalesce(p_season, v_league.season + 1);

  -- The startup draft is long because it fills empty rosters. Every draft
  -- after it is a rookie draft, and does not need twenty-four rounds of it.
  v_rounds := case
    when v_season <= v_league.inaugural_season
      then coalesce((v_league.settings ->> 'rounds')::int, 24)
    else coalesce((v_league.settings ->> 'rookieRounds')::int, 5)
  end;

  if v_rounds < 1 then
    raise exception 'A draft needs at least one round' using errcode = '22023';
  end if;

  -- Every franchise gets its own pick in every round, and starts out holding
  -- it. Rows that already exist are left exactly as they are: a pick that has
  -- been traded must not be handed back by the job that tops the season up.
  insert into draft_pick_assets (league_id, season, round, origin_manager, manager_id)
  select p_league_id, v_season, r.round, m.id, m.id
    from managers m
   cross join generate_series(1, v_rounds) as r(round)
   where m.league_id = p_league_id
  on conflict (league_id, season, round, origin_manager) do nothing;

  get diagnostics v_created = row_count;

  v_ordered := set_draft_pick_order(p_league_id, v_season);

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, null, 'draft_picks_awarded',
          jsonb_build_object('season', v_season, 'rounds', v_rounds,
                             'created', v_created, 'reordered', v_ordered));

  return jsonb_build_object(
    'season', v_season,
    'rounds', v_rounds,
    'created', v_created,
    'reordered', v_ordered,
    'tradeable', picks_are_tradeable(p_league_id, v_season)
  );
end;
$$;

revoke all on function award_draft_picks(uuid, int) from public;

-- The inaugural season's picks exist from the start, so a manager can see what
-- they hold before the first draft even though none of it is for sale.
do $seed$
declare
  v_league uuid;
begin
  for v_league in select id from leagues loop
    perform award_draft_picks(v_league, (select inaugural_season from leagues where id = v_league));
    perform award_draft_picks(v_league);
  end loop;
end
$seed$;

-- ---------------------------------------------------------------------------
-- Trading them
-- ---------------------------------------------------------------------------
-- execute_trade rewritten to move picks as well as players. The offer gains
-- two optional arrays of pick ids beside the two of player names; an offer
-- without them behaves exactly as it did.
--
-- Picks are checked the same way players are: still held by the side that
-- promised them, or the whole trade is void. Never a partial move.

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

  if not (v_trade.from_accepted and v_trade.to_accepted) then
    raise exception 'Both managers must accept first' using errcode = '55000';
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
