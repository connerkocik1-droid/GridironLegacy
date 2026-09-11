-- Trades go to the league, and the league is present.
--
-- Two things, and they are here together because both are about the league
-- being a room with people in it rather than twelve private dashboards.
--
-- A trade no longer executes the moment both managers agree. It goes to a
-- vote of the other ten, and settles one of three ways: enough vetoes kills
-- it, enough approvals sends it through early, and silence sends it through
-- once the window closes. Silence passing is the important half — a league
-- where nobody votes should not be a league where nothing trades.
--
-- And every manager now leaves a footprint when they use the app, so the
-- others can see who is about.

-- --------------------------------------------------------- the settings ---

/**
 * How many votes decide a trade, and how long the league gets to cast them.
 *
 * Four of the ten who are not in the deal, either way, and forty-eight hours.
 * Four rather than a majority because apathy passes a trade here: a bar of six
 * would mean a veto essentially never happens, which is the same as not having
 * one. The commissioner can move both.
 */
update leagues
   set settings = coalesce(settings, '{}'::jsonb)
                || jsonb_build_object('vetoVotes', 4, 'tradeVoteHours', 48)
 where not (settings ? 'vetoVotes');

alter table trades add column if not exists voting_opened_at timestamptz;

alter table trades drop constraint if exists trades_status_check;
alter table trades add constraint trades_status_check
  check (status in ('open','countered','agreed','voting','executed','declined','rescinded','scheduled'));

create table if not exists trade_votes (
  trade_id   uuid not null references trades(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  vote       text not null check (vote in ('veto','approve')),
  created_at timestamptz not null default now(),
  primary key (trade_id, manager_id)
);

alter table trade_votes enable row level security;

drop policy if exists trade_votes_read on trade_votes;
-- The count is public within the league, and so is who cast what: a secret
-- ballot among twelve friends is an invitation to veto anonymously and deny
-- it afterwards.
create policy trade_votes_read on trade_votes for select to authenticated
  using (exists (
    select 1 from trades t join managers m on m.league_id = t.league_id
     where t.id = trade_votes.trade_id and m.auth_user_id = auth.uid()
  ));

-- Votes are only ever cast through cast_trade_vote, which checks who may.
revoke insert, update, delete on trade_votes from authenticated;

grant select on trade_votes to authenticated;

/** How many votes settle a trade in this league. */
create or replace function veto_threshold(p_league_id uuid)
returns int
language sql
stable
as $$
  select greatest(1, coalesce((select (settings ->> 'vetoVotes')::int
                                 from leagues where id = p_league_id), 4));
$$;

/** How long the league has to vote. */
create or replace function trade_vote_hours(p_league_id uuid)
returns int
language sql
stable
as $$
  select greatest(1, coalesce((select (settings ->> 'tradeVoteHours')::int
                                 from leagues where id = p_league_id), 48));
$$;

-- ------------------------------------------------------ moving the players ---

/**
 * The trade itself, with nothing said about who asked for it.
 *
 * Split out of execute_trade so that somebody other than the two managers can
 * cause it: a tenth voter tipping the count, the nightly settle, or the
 * commissioner forcing it through. execute_trade keeps every guard it had and
 * calls this; the mechanics below are the same statements it always ran, so a
 * trade executes identically however it came to be executed.
 */
create or replace function apply_trade(p_trade_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade       trades;
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
  -- Locked for the duration, so two settlers cannot both move the same players.
  select * into v_trade from trades where id = p_trade_id for update;
  if v_trade.id is null then
    raise exception 'No such trade' using errcode = 'P0002';
  end if;

  if v_trade.status = 'executed' then
    raise exception 'This trade has already been executed' using errcode = '55000';
  end if;

  if v_trade.status = 'scheduled' then
    raise exception 'This trade is already agreed and goes through in week %',
      v_trade.effective_week using errcode = '55000';
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
    values (v_trade.league_id, p_actor, 'trade_scheduled',
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
  values (v_trade.league_id, p_actor, 'trade_executed',
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

revoke all on function apply_trade(uuid, uuid) from public;

/**
 * The two managers' own route to executing a trade.
 *
 * Every guard it had, and then the mechanics. What has changed is what calls
 * it: with voting on, the app opens a vote when both sides agree rather than
 * executing here, and this stays for the leagues and the paths that do not
 * vote.
 */
create or replace function execute_trade(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade trades;
  v_me    managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_trade from trades where id = p_trade_id;
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

  return apply_trade(p_trade_id, v_me.id);
end;
$$;

grant execute on function execute_trade(uuid) to authenticated;

-- ------------------------------------------------------------- the vote ---

/**
 * Opens the vote once both managers have agreed.
 *
 * The clock starts here rather than at the offer, because an offer can sit
 * unanswered for a fortnight and the league has no business voting on
 * something one side has not accepted yet.
 */
create or replace function open_trade_vote(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade trades;
  v_me    managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_trade from trades where id = p_trade_id for update;
  if v_trade.id is null then
    raise exception 'No such trade' using errcode = 'P0002';
  end if;

  if v_me.id <> v_trade.from_manager and v_me.id <> v_trade.to_manager then
    raise exception 'Not your trade' using errcode = '42501';
  end if;

  if not (v_trade.from_accepted and v_trade.to_accepted) then
    raise exception 'Both managers must accept first' using errcode = '55000';
  end if;

  if v_trade.status in ('executed', 'scheduled', 'declined') then
    raise exception 'This trade is already settled' using errcode = '55000';
  end if;

  -- Already open. Saying so is not an error: both managers pressing accept in
  -- the same second must not turn one of them into a failure.
  if v_trade.status = 'voting' then
    return jsonb_build_object('ok', true, 'status', 'voting',
                              'closesAt', v_trade.voting_opened_at
                                + make_interval(hours => trade_vote_hours(v_trade.league_id)));
  end if;

  update trades
     set status = 'voting', voting_opened_at = now()
   where id = p_trade_id;

  return jsonb_build_object(
    'ok', true, 'status', 'voting',
    'closesAt', now() + make_interval(hours => trade_vote_hours(v_trade.league_id)));
end;
$$;

grant execute on function open_trade_vote(uuid) to authenticated;

/**
 * Settles one trade if the votes or the clock have decided it.
 *
 * Does nothing when the answer is not yet in, so it is safe to call from
 * anywhere and as often as anybody likes — a voter tipping the count, the
 * nightly run, or a page load. Silence passing the trade is deliberate: a
 * league where nobody votes should not be a league where nothing moves.
 */
create or replace function settle_trade_vote(p_trade_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade    trades;
  v_bar      int;
  v_vetoes   int;
  v_approves int;
  v_closes   timestamptz;
begin
  select * into v_trade from trades where id = p_trade_id for update;
  if v_trade.id is null or v_trade.status <> 'voting' then
    return null;
  end if;

  v_bar := veto_threshold(v_trade.league_id);
  select count(*) filter (where vote = 'veto'),
         count(*) filter (where vote = 'approve')
    into v_vetoes, v_approves
    from trade_votes where trade_id = p_trade_id;

  if v_vetoes >= v_bar then
    update trades set status = 'declined' where id = p_trade_id;
    insert into admin_log (league_id, actor, action, detail)
    values (v_trade.league_id, null, 'trade_vetoed',
            jsonb_build_object('trade_id', p_trade_id, 'vetoes', v_vetoes));
    return 'declined';
  end if;

  v_closes := v_trade.voting_opened_at
              + make_interval(hours => trade_vote_hours(v_trade.league_id));

  if v_approves >= v_bar or now() >= v_closes then
    -- apply_trade may still defer it to next week if somebody has played;
    -- that is its decision, not the vote's.
    perform apply_trade(p_trade_id, null);
    return 'executed';
  end if;

  return null;
end;
$$;

revoke all on function settle_trade_vote(uuid) from public;
grant execute on function settle_trade_vote(uuid) to authenticated;

/**
 * Casting a vote, and settling the trade if that was the deciding one.
 *
 * The two managers in the deal do not get a say — they have already had one,
 * by agreeing to it.
 */
create or replace function cast_trade_vote(p_trade_id uuid, p_vote text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade  trades;
  v_me     managers;
  v_result text;
begin
  if p_vote not in ('veto', 'approve') then
    raise exception 'A vote is veto or approve' using errcode = '22023';
  end if;

  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_trade from trades where id = p_trade_id;
  if v_trade.id is null then
    raise exception 'No such trade' using errcode = 'P0002';
  end if;

  if v_me.league_id <> v_trade.league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  if v_me.id = v_trade.from_manager or v_me.id = v_trade.to_manager then
    raise exception 'You are in this trade — you have already had your say'
      using errcode = '42501';
  end if;

  if v_trade.status <> 'voting' then
    raise exception 'This trade is not open for voting' using errcode = '55000';
  end if;

  -- Changing your mind is allowed right up until it settles.
  insert into trade_votes (trade_id, manager_id, vote)
  values (p_trade_id, v_me.id, p_vote)
      on conflict (trade_id, manager_id) do update set vote = excluded.vote,
                                                       created_at = now();

  v_result := settle_trade_vote(p_trade_id);

  return jsonb_build_object('ok', true, 'vote', p_vote, 'settled', v_result);
end;
$$;

grant execute on function cast_trade_vote(uuid, text) to authenticated;

/** Every trade still out for a vote whose answer is now in. */
create or replace function settle_trade_votes(p_league_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_closed int := 0;
begin
  for v_id in
    select id from trades where league_id = p_league_id and status = 'voting'
  loop
    if settle_trade_vote(v_id) is not null then v_closed := v_closed + 1; end if;
  end loop;
  return v_closed;
end;
$$;

revoke all on function settle_trade_votes(uuid) from public;
grant execute on function settle_trade_votes(uuid) to authenticated;

/**
 * The commissioner putting a trade through regardless.
 *
 * For the deal everybody agrees is fine and nobody can be bothered to vote on,
 * and for the one the vote got wrong. Recorded as what it is, because a
 * commissioner overriding a league vote should leave a mark.
 */
create or replace function force_trade(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade trades;
  v_me    managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner then
    raise exception 'Only the commissioner can force a trade' using errcode = '42501';
  end if;

  select * into v_trade from trades where id = p_trade_id;
  if v_trade.id is null then
    raise exception 'No such trade' using errcode = 'P0002';
  end if;

  if v_me.league_id <> v_trade.league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  if not (v_trade.from_accepted and v_trade.to_accepted) then
    raise exception 'Both managers must accept first' using errcode = '55000';
  end if;

  insert into admin_log (league_id, actor, action, detail)
  values (v_trade.league_id, v_me.id, 'trade_forced',
          jsonb_build_object('trade_id', p_trade_id, 'wasStatus', v_trade.status));

  return apply_trade(p_trade_id, v_me.id);
end;
$$;

grant execute on function force_trade(uuid) to authenticated;

-- ----------------------------------------------------------- who is about ---

alter table managers add column if not exists last_seen_at timestamptz;

/**
 * A manager saying they are here.
 *
 * Written through a function rather than a policy so that nobody can mark
 * somebody else present — the only row it can touch is the caller's own.
 */
create or replace function touch_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update managers set last_seen_at = now() where auth_user_id = auth.uid();
$$;

grant execute on function touch_presence() to authenticated;
