-- Four things a review found in the vote and the outbox.

-- ------------------------------------------------- a vote that settles ---

/**
 * Settling a trade the rosters have moved under.
 *
 * settle_trade_vote called apply_trade bare, and apply_trade raises when a
 * player in the offer is no longer where the offer said — which, over a
 * forty-eight hour window, is an ordinary thing to happen. The raise took the
 * whole transaction with it: the deciding voter got a 403 and their ballot was
 * rolled back with it, so the trade sat in 'voting' forever with the count one
 * short, and on the nightly pass one such trade aborted the loop for every
 * other trade in the league.
 *
 * A trade that cannot be applied is declined, which is what settling a
 * scheduled trade already does with the same problem, and for the same reason:
 * the deal on the table is no longer a deal anybody can be held to. The reason
 * goes in the log so it is not a trade that silently vanished.
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
    begin
      -- apply_trade may still defer it to next week if somebody has played;
      -- that is its decision, not the vote's.
      perform apply_trade(p_trade_id, null);
      return 'executed';
    exception when others then
      update trades set status = 'declined' where id = p_trade_id;
      insert into admin_log (league_id, actor, action, detail)
      values (v_trade.league_id, null, 'trade_void',
              jsonb_build_object('trade_id', p_trade_id, 'why', sqlerrm));
      return 'declined';
    end;
  end if;

  return null;
end;
$$;

revoke all on function settle_trade_vote(uuid) from public;
grant execute on function settle_trade_vote(uuid) to authenticated;

-- ------------------------------------------ a ballot on the terms voted on ---

/**
 * Changing the terms throws away the votes cast on the old ones.
 *
 * Countering a trade that was out for a vote dropped it back to 'countered'
 * and left every ballot standing. Re-opened, those ballots counted again — so
 * three managers who vetoed a lopsided deal would have their vetoes applied to
 * whatever it was rewritten into, and one more veto could kill terms nobody
 * had rejected. They were also filtered off those managers' home pages as
 * already voted, so they could not correct it.
 *
 * Extends the trigger from 0048 rather than adding a second one, so there is
 * one place that says what changing the terms means.
 */
create or replace function void_acceptance_on_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me uuid;
begin
  if new.offer is not distinct from old.offer then
    return new;
  end if;

  new.status := 'countered';

  -- The league voted on the deal as it was. Whatever it is now, nobody has
  -- seen it.
  delete from trade_votes where trade_id = new.id;
  new.voting_opened_at := null;

  if current_user in ('authenticated', 'anon') then
    select id into v_me from managers where auth_user_id = auth.uid();
  end if;

  if v_me is null then
    new.from_accepted := false;
    new.to_accepted := false;
    return new;
  end if;

  if v_me = new.from_manager then
    new.to_accepted := false;
  elsif v_me = new.to_manager then
    new.from_accepted := false;
  else
    new.from_accepted := false;
    new.to_accepted := false;
  end if;

  return new;
end;
$$;

-- ------------------------------------------- a commissioner is not exempt ---

/**
 * The commissioner may put a trade through, but not their own.
 *
 * Overriding a league vote on somebody else's deal is a commissioner doing
 * their job. Overriding it on a deal they are in is the exact thing the vote
 * exists to prevent, and it was allowed: the check was is_commissioner and
 * nothing else.
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

  if v_me.id = v_trade.from_manager or v_me.id = v_trade.to_manager then
    raise exception 'You are in this trade — the league decides it, not you'
      using errcode = '42501';
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

-- ------------------------------------------------- retiring a dead device ---

/**
 * Counting the refusals that are worth counting.
 *
 * This added one to `failures` on exactly the endpoints it deleted on the next
 * line, so the counter never survived to reach anything and claim_push's
 * `failures < 5` retirement could never fire. A device behind a push service
 * that has been refusing for a week was retried forever.
 *
 * The two lists are now what they say they are: the ones that failed, and the
 * ones that are gone.
 */
create or replace function push_failed(
  p_ids            uuid[],
  p_dead_endpoints text[],
  p_sick_endpoints text[] default '{}'
)
returns void
language sql
security definer
set search_path = public
as $$
  update push_outbox set claimed_at = null where id = any(p_ids) and sent_at is null;
  update push_subscriptions
     set failures = failures + 1
   where endpoint = any(p_sick_endpoints);
  delete from push_subscriptions where endpoint = any(p_dead_endpoints);
$$;

revoke all on function push_failed(uuid[], text[], text[]) from public;

-- The two-argument shape is gone: leaving it would mean the cron could call
-- the old one by accident and count nothing.
drop function if exists push_failed(uuid[], text[]);

-- ---------------------------------------------- every lead change, not three ---

/**
 * One manager's side of it, said from where they are sitting.
 *
 * Split out because it was the same eight lines twice with home and away
 * swapped, and the swap was the part easy to get wrong.
 */
create or replace function say_the_score(
  p_manager_id uuid,
  p_week       int,
  p_lead       text,
  p_mine       text,
  p_theirs     text,
  p_my_points  numeric,
  p_their_points numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_said int;
  v_last text;
begin
  -- What this manager was last told about this week, so a lead that merely
  -- stands is not said twice and a lead that has changed is.
  select count(*) into v_said
    from push_outbox o
   where o.manager_id = p_manager_id
     and o.kind = 'scores'
     and o.dedupe like format('score:w%s:%%', p_week);

  -- The last thing said, by when it was said. max() over the key would answer
  -- alphabetically, and 'h' sorts above 'a' whichever came first.
  select o.dedupe into v_last
    from push_outbox o
   where o.manager_id = p_manager_id
     and o.kind = 'scores'
     and o.dedupe like format('score:w%s:%%', p_week)
   order by o.created_at desc, o.dedupe desc
   limit 1;

  if v_last is not null and split_part(v_last, ':', 3) = p_lead then
    return false;
  end if;

  return enqueue_push(p_manager_id, 'scores',
    format('%s %s', p_mine, round(p_my_points, 1)),
    case
      when p_my_points > p_their_points
        then format('Ahead of %s by %s.', p_theirs, round(p_my_points - p_their_points, 1))
      when p_my_points < p_their_points
        then format('Behind %s by %s.', p_theirs, round(p_their_points - p_my_points, 1))
      else format('Level with %s.', p_theirs)
    end,
    '/lineup',
    format('score:w%s:%s:%s', p_week, p_lead, v_said));
end;
$$;

revoke all on function say_the_score(uuid, int, text, text, text, numeric, numeric) from public;

/**
 * A scoring update per lead change, which is what it says on the switch.
 *
 * The dedupe key was who is ahead — three values for a whole week — so the
 * first time each side took the lead was news and every flip after it was
 * silently dropped. A Sunday where a matchup changes hands five times sent two
 * messages, and the settings panel promised otherwise.
 *
 * The key now carries how many have already gone out for this manager this
 * week, so each flip is its own message while a lead that merely stands is
 * still one. Deliberately not per score: only a change of leader gets this far.
 */
create or replace function push_score_news(p_league_id uuid, p_week int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m      record;
  v_home   numeric;
  v_away   numeric;
  v_lead   text;
  v_queued int := 0;
begin
  for v_m in
    select m.id, m.home_manager, m.away_manager,
           h.franchise as home_name, a.franchise as away_name
      from matchups m
      join managers h on h.id = m.home_manager
      join managers a on a.id = m.away_manager
     where m.league_id = p_league_id
       and m.week = p_week
       and not m.final
  loop
    v_home := lineup_points(p_league_id, v_m.home_manager, p_week);
    v_away := lineup_points(p_league_id, v_m.away_manager, p_week);

    -- Nothing has happened yet. A message saying nought to nought is a message
    -- saying the games have not started, which the reader already knows.
    continue when v_home = 0 and v_away = 0;

    v_lead := case
      when v_home > v_away then 'h'
      when v_away > v_home then 'a'
      else 't'
    end;

    v_queued := v_queued
      + say_the_score(v_m.home_manager, p_week, v_lead, v_m.home_name, v_m.away_name,
                      v_home, v_away)::int
      + say_the_score(v_m.away_manager, p_week, v_lead, v_m.away_name, v_m.home_name,
                      v_away, v_home)::int;
  end loop;

  return v_queued;
end;
$$;

revoke all on function push_score_news(uuid, int) from public;
