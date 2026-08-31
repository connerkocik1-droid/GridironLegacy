-- Telling a manager something happened to them.
--
-- The league has never told anybody anything. It is your pick and nothing
-- says so; somebody offers you a trade and you find out by opening the trade
-- desk; your waiver claim wins or loses and the only trace is a roster that
-- changed overnight. For twelve people who are not all checking a website
-- every day, that is the difference between a league and a database.
--
-- What this is NOT: email. That needs a provider and a key this deployment
-- does not have, and sending mail is a thing you should turn on deliberately
-- rather than discover. This is the half that needs nothing: a per-manager
-- list of things that happened, an unread count, and a place to read them.
--
-- Notices are written by the same functions that do the thing being announced,
-- inside the same transaction. A notice that can arrive without its cause —
-- or a cause that can happen without its notice — is worse than neither.

create table if not exists notices (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues(id) on delete cascade,
  -- Who it is for. Not who caused it: a trade offer is news to the person
  -- receiving it and not to the person who sent it.
  manager_id uuid not null references managers(id) on delete cascade,
  kind       text not null,
  body       text not null,
  -- Where reading it should take you, as a path this app knows.
  href       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notices_inbox_idx
  on notices (manager_id, created_at desc);
-- The unread count is read on every page load, so it gets its own partial
-- index rather than scanning an inbox that only grows.
create index if not exists notices_unread_idx
  on notices (manager_id) where read_at is null;

alter table notices enable row level security;

-- Yours and nobody else's, in both directions: a manager may read their own
-- and mark their own read, and may not see anybody else's at all.
drop policy if exists notices_own on notices;
create policy notices_own on notices
  for select using (manager_id = (select id from current_manager()));

drop policy if exists notices_mark on notices;
create policy notices_mark on notices
  for update using (manager_id = (select id from current_manager()))
  with check (manager_id = (select id from current_manager()));

grant select on notices to authenticated;
-- Only the read mark. A manager who could write the body could write anything
-- into anybody's idea of what happened.
grant update (read_at) on notices to authenticated;

/** Writes one notice. Called from inside whatever it is announcing. */
create or replace function notify_manager(
  p_league_id uuid,
  p_manager_id uuid,
  p_kind text,
  p_body text,
  p_href text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notices (league_id, manager_id, kind, body, href)
  select p_league_id, p_manager_id, p_kind, p_body, p_href
   where p_manager_id is not null;
$$;

revoke all on function notify_manager(uuid, uuid, text, text, text) from public;

/** Marks every unread notice read. */
create or replace function read_notices(p_league_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   managers;
  v_read int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  update notices set read_at = now()
   where manager_id = v_me.id and read_at is null;

  get diagnostics v_read = row_count;
  return v_read;
end;
$$;

revoke all on function read_notices(uuid) from public;
grant execute on function read_notices(uuid) to authenticated;

-- ------------------------------------------------------- what gets announced ---

/**
 * The waiver run, re-emitted from 0024 so that it tells people.
 *
 * A claim that wins and a claim that loses are both news, and losing is the
 * one nobody would otherwise find out about: the player simply appears on
 * somebody else's roster. The reason the database recorded is the reason the
 * manager is given, because inventing a friendlier one would make the log and
 * the message disagree.
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

      select max(waiver_priority) into v_max
        from managers where league_id = p_league_id;

      update managers
         set waiver_priority = waiver_priority - 1
       where league_id = p_league_id
         and waiver_priority > (
           select waiver_priority from managers where id = v_claim.manager_id
         );

      update managers set waiver_priority = v_max where id = v_claim.manager_id;

      perform notify_manager(p_league_id, v_claim.manager_id, 'waiver',
        'You won ' || v_claim.add_player || ' on waivers.', '/free-agents');

      v_won := v_won + 1;

    exception when others then
      update waiver_claims
         set status = 'lost', reason = sqlerrm, settled_at = now()
       where id = v_claim.id;

      perform notify_manager(p_league_id, v_claim.manager_id, 'waiver',
        'Your claim for ' || v_claim.add_player || ' did not go through: ' || sqlerrm,
        '/free-agents');

      v_lost := v_lost + 1;
    end;
  end loop;

  delete from waiver_wire
   where league_id = p_league_id and clears_at <= now();
  get diagnostics v_cleared = row_count;

  select count(*) into v_held from waiver_wire where league_id = p_league_id;

  return jsonb_build_object('ok', true, 'won', v_won, 'lost', v_lost,
                            'cleared', v_cleared, 'stillOnWaivers', v_held);
end;
$$;

revoke all on function process_waivers(uuid) from public;

/**
 * A trade offer arriving, and a trade going through.
 *
 * Written as triggers rather than into execute_trade, because an offer is
 * created by a plain insert from the browser and countered by a plain update,
 * and there is no function to put it in. The trigger fires for the service
 * key too, which is correct: an offer is news to its recipient however it got
 * there.
 */
create or replace function notice_on_trade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
  v_to   text;
begin
  select franchise into v_from from managers where id = new.from_manager;
  select franchise into v_to   from managers where id = new.to_manager;

  if tg_op = 'INSERT' then
    perform notify_manager(new.league_id, new.to_manager, 'trade',
      v_from || ' has offered you a trade.', '/trade-builder');
    return new;
  end if;

  -- A counter is the other side sending it back with different terms, so the
  -- news goes to whoever did not just change it.
  if new.status = 'countered' and old.status is distinct from 'countered' then
    perform notify_manager(new.league_id,
      case when new.to_accepted then new.from_manager else new.to_manager end,
      'trade', 'Your trade has been countered.', '/trade-builder');

  elsif new.status = 'executed' and old.status is distinct from 'executed' then
    perform notify_manager(new.league_id, new.from_manager, 'trade',
      'Your trade with ' || v_to || ' has gone through.', '/lineup');
    perform notify_manager(new.league_id, new.to_manager, 'trade',
      'Your trade with ' || v_from || ' has gone through.', '/lineup');

  elsif new.status = 'declined' and old.status is distinct from 'declined' then
    perform notify_manager(new.league_id, new.from_manager, 'trade',
      v_to || ' declined your offer.', '/trade-builder');

  elsif new.status = 'rescinded' and old.status is distinct from 'rescinded' then
    perform notify_manager(new.league_id,
      case when new.from_accepted then new.to_manager else new.from_manager end,
      'trade', 'A trade offer was withdrawn.', '/trade-builder');
  end if;

  return new;
end;
$$;

drop trigger if exists trades_notice_insert on trades;
create trigger trades_notice_insert
  after insert on trades
  for each row execute function notice_on_trade();

drop trigger if exists trades_notice_update on trades;
create trigger trades_notice_update
  after update on trades
  for each row execute function notice_on_trade();

/**
 * Your turn to pick.
 *
 * Fires when the clock starts on a new pick, which is exactly the moment the
 * league moves on: current_pick changing is the draft's own definition of
 * somebody being on the clock, so there is no second thing to keep in step.
 */
create or replace function notice_on_the_clock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_up uuid;
begin
  if new.draft_state <> 'running' then return new; end if;
  if new.current_pick is not distinct from old.current_pick then return new; end if;

  select manager_id into v_up
    from draft_picks
   where league_id = new.id and overall = new.current_pick;

  perform notify_manager(new.id, v_up, 'draft', 'You are on the clock.', '/draft');
  return new;
end;
$$;

drop trigger if exists leagues_notice_clock on leagues;
create trigger leagues_notice_clock
  after update on leagues
  for each row execute function notice_on_the_clock();

-- ------------------------------------------------------------- the reset ---
--
-- reset_league has now been re-emitted three times in three migrations for no
-- reason but to add a table to its delete list, copying ninety lines each time
-- to change one. The list is its own thing, so it becomes its own function:
-- the next table to be added is one line here, and reset_league stops being
-- something that has to be rewritten to stay correct.

/**
 * Deletes everything that belongs to a season rather than to the league.
 *
 * Kept: the league, its franchises, their names and divisions and PINs, the
 * settings, the admin log. Gone: everything those franchises did.
 */
create or replace function purge_league_season(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from roster_slots     where league_id = p_league_id;
  delete from matchups         where league_id = p_league_id;
  delete from player_scores    where league_id = p_league_id;
  delete from transactions     where league_id = p_league_id;
  delete from waiver_claims    where league_id = p_league_id;
  delete from waiver_wire      where league_id = p_league_id;
  delete from trades           where league_id = p_league_id;
  delete from trade_block      where league_id = p_league_id;
  delete from draft_queue      where league_id = p_league_id;
  delete from pickem_picks     where league_id = p_league_id;
  delete from playoff_seeds    where league_id = p_league_id;
  delete from league_champions where league_id = p_league_id;
  -- A notice is a thing that happened. None of it happened now.
  delete from notices          where league_id = p_league_id;
end;
$$;

revoke all on function purge_league_season(uuid) from public;

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

  perform purge_league_season(p_league_id);

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
