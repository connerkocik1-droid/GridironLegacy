-- Behaviour tests for the rules that live in the database.
--
-- These cover the things that would quietly corrupt a league: a player drafted
-- twice, a trade that half-applies, a commissioner deleting a franchise
-- somebody already claimed. Run them with scripts/test-db.sh.
--
-- Each check prints PASS or FAIL. Any FAIL is a bug.

\set ON_ERROR_STOP off
\pset pager off
\pset tuples_only on
\pset format unaligned

\o /dev/null

create or replace function expect(p_label text, p_got anyelement, p_want anyelement)
returns text language plpgsql as $$
begin
  if p_got is not distinct from p_want then return format('PASS  %s', p_label); end if;
  return format('FAIL  %s — got [%s], want [%s]', p_label, p_got, p_want);
end;
$$;

-- Runs a statement and returns the error it raised, or null if it succeeded.
-- Lets a test assert that something is refused, and why.
create or replace function refuses(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

create or replace function signin(p_uid uuid) returns void language sql as $$
  select set_config('test.uid', p_uid::text, false);
  select null::void;
$$;

\set L  '99999999-0000-0000-0000-000000000001'
\set U1 'aaaa0000-0000-0000-0000-000000000001'
\set U2 'aaaa0000-0000-0000-0000-000000000002'
\set T1 'cccc0000-0000-0000-0000-000000000001'
\set T2 'cccc0000-0000-0000-0000-000000000002'

insert into leagues (id, name, season, commissioner_slot, settings, draft_state)
values (:'L', 'Rules', 2026, 'AAA', '{"rounds": 2, "pickSeconds": 90}'::jsonb, 'pending');

insert into auth.users (id) values (:'U1'), (:'U2');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'L', 'AAA', 'One', 'Alpha', true,  :'U1'),
  (:'L', 'BBB', 'Two', 'Bravo', false, :'U2');

select signin(:'U1');
select rebuild_draft_board(:'L');
\o

\echo ''
\echo '--- draft board ---'

select expect('board is teams x rounds',
  (select count(*)::int from draft_picks where league_id = :'L'), 4);

select expect('round 1 runs forward',
  (select string_agg(m.slot, ',' order by p.overall) from draft_picks p
     join managers m on m.id = p.manager_id
    where p.league_id = :'L' and p.round = 1), 'AAA,BBB');

select expect('round 2 snakes back',
  (select string_agg(m.slot, ',' order by p.overall) from draft_picks p
     join managers m on m.id = p.manager_id
    where p.league_id = :'L' and p.round = 2), 'BBB,AAA');

\echo ''
\echo '--- drafting ---'

\o /dev/null
update leagues set draft_state = 'running', pick_started_at = now() where id = :'L';
select make_pick(:'L', 'Player One');
\o

select expect('a pick lands on the roster',
  (select lineup_slot from roster_slots where league_id = :'L' and player_name = 'Player One'),
  'BENCH');

select expect('picking out of turn is refused',
  refuses(format('select make_pick(%L, %L)', :'L', 'Player Two')), 'It is not your pick');

\o /dev/null
select signin(:'U2');
\o

select expect('a rostered player cannot be drafted again',
  refuses(format('select make_pick(%L, %L)', :'L', 'Player One')),
  'That player is already rostered');

select expect('a manager cannot pick for someone else',
  refuses(format(
    'select make_pick(%L, %L, (select id from managers where league_id = %L and slot = ''AAA''))',
    :'L', 'Player Nine', :'L')),
  'Only the commissioner can pick for another manager');

\echo ''
\echo '--- trades ---'

\o /dev/null
select make_pick(:'L', 'Player Two');

insert into trades (id, league_id, from_manager, to_manager, offer, status, from_accepted, to_accepted)
values (:'T1', :'L',
  (select id from managers where league_id = :'L' and slot = 'AAA'),
  (select id from managers where league_id = :'L' and slot = 'BBB'),
  '{"give": ["Player One"], "get": ["Player Two"]}'::jsonb, 'agreed', true, true);

select execute_trade(:'T1');
\o

select expect('the traded player changed hands',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'L' and r.player_name = 'Player One'), 'BBB');

select expect('the return leg changed hands too',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'L' and r.player_name = 'Player Two'), 'AAA');

select expect('a traded player is marked as acquired by trade',
  (select acquired from roster_slots where league_id = :'L' and player_name = 'Player One'),
  'trade');

select expect('a trade cannot be executed twice',
  refuses(format('select execute_trade(%L)', :'T1')),
  'This trade has already been executed');

-- A trade written against rosters that have since changed must move nothing
-- at all, rather than applying the half that still lines up.
\o /dev/null
insert into trades (id, league_id, from_manager, to_manager, offer, status, from_accepted, to_accepted)
values (:'T2', :'L',
  (select id from managers where league_id = :'L' and slot = 'AAA'),
  (select id from managers where league_id = :'L' and slot = 'BBB'),
  '{"give": ["Player One", "Player Two"], "get": []}'::jsonb, 'agreed', true, true);
\o

select expect('a stale trade is refused',
  refuses(format('select execute_trade(%L)', :'T2')),
  'A player in this offer is no longer on the proposing roster');

select expect('the stale trade moved nothing',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'L' and r.player_name = 'Player Two'), 'AAA');

\o /dev/null
update trades set offer = '{"give": ["Player Two"], "get": []}'::jsonb where id = :'T2';
\o

select expect('changing the terms voids both acceptances',
  (select from_accepted or to_accepted from trades where id = :'T2'), false);

select expect('an unaccepted trade cannot execute',
  refuses(format('select execute_trade(%L)', :'T2')),
  'Both managers must accept first');

\echo ''
\echo '--- league size ---'

\o /dev/null
select signin(:'U1');
-- Clear the board so resizing is allowed again.
update draft_picks set player_name = null where league_id = :'L';
delete from roster_slots where league_id = :'L';
select set_team_count(:'L', 5);
\o

select expect('growing adds franchises',
  (select count(*)::int from managers where league_id = :'L'), 5);

select expect('new franchises are open and unclaimed',
  (select bool_and(pin_hash is null and name = 'Open') from managers
    where league_id = :'L' and slot like 'T%'), true);

select expect('the board is rebuilt to the new size',
  (select count(*)::int from draft_picks where league_id = :'L'), 10);

\o /dev/null
update managers set pin_hash = 'x' where league_id = :'L' and slot = 'T05';
\o

-- Named by slot, because every open seat is called the same thing and the
-- point of the message is to say which ones are in the way.
select expect('a claimed franchise cannot be removed',
  refuses(format('select set_team_count(%L, 4)', :'L')),
  'These franchises are claimed or hold players: T05 · Open Team');

select expect('the claimed franchise survived',
  (select count(*)::int from managers where league_id = :'L'), 5);

\o /dev/null
update managers set pin_hash = null where league_id = :'L' and slot = 'T05';
select set_team_count(:'L', 3);
\o

select expect('unclaimed franchises can be removed',
  (select count(*)::int from managers where league_id = :'L'), 3);

select expect('a non-commissioner cannot resize',
  (select refuses(format('select set_team_count(%L, 6)', :'L'))
     from (select signin(:'U2')) _),
  'Only the commissioner can change the league size');

\o /dev/null
select signin(:'U1');
\o

select expect('a league smaller than two is refused',
  refuses(format('select set_team_count(%L, 1)', :'L')),
  'A league runs from 2 to 16 franchises');

select expect('a league larger than sixteen is refused',
  refuses(format('select set_team_count(%L, 17)', :'L')),
  'A league runs from 2 to 16 franchises');

\o /dev/null
update leagues set draft_state = 'running' where id = :'L';
update draft_picks set player_name = 'Taken' where league_id = :'L' and overall = 1;
\o

select expect('the size is fixed once the draft starts',
  refuses(format('select set_team_count(%L, 6)', :'L')),
  'The draft has already started — the league size is fixed now');

select expect('the board cannot be rebuilt mid-draft',
  refuses(format('select rebuild_draft_board(%L)', :'L')) like 'The draft has already started%',
  true);

\echo ''
\echo '--- PIN reset ---'

\o /dev/null
update draft_picks set player_name = null where league_id = :'L';
update managers set pin_hash = 'hashed' where league_id = :'L' and slot = 'BBB';
\o

select expect('a manager cannot clear another PIN',
  (select refuses(format(
     'select clear_pin((select id from managers where league_id = %L and slot = ''AAA''))', :'L'))
     from (select signin(:'U2')) _),
  'Only the commissioner can reset a PIN');

\o /dev/null
select signin(:'U1');
select clear_pin((select id from managers where league_id = :'L' and slot = 'BBB'));
\o

select expect('the commissioner clears a PIN',
  (select pin_hash from managers where league_id = :'L' and slot = 'BBB'), null::text);

\echo ''

\echo ''
\echo '--- waivers ---'

\o /dev/null
\set W '99999999-0000-0000-0000-000000000002'
\set W1 'bbbb0000-0000-0000-0000-000000000001'
\set W2 'bbbb0000-0000-0000-0000-000000000002'
\set W3 'bbbb0000-0000-0000-0000-000000000003'

-- A small league: capacity is 2 starters + 1 bench = 3.
insert into leagues (id, name, season, commissioner_slot, settings)
values (:'W', 'Waivers', 2026, 'AAA',
        '{"starters": {"QB": 1, "RB": 1}, "bench": 1, "rounds": 1}'::jsonb);

insert into auth.users (id) values (:'W1'), (:'W2'), (:'W3');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id, waiver_priority) values
  (:'W', 'AAA', 'A', 'Alpha',   true,  :'W1', 1),
  (:'W', 'BBB', 'B', 'Bravo',   false, :'W2', 2),
  (:'W', 'CCC', 'C', 'Charlie', false, :'W3', 3);
\o

select expect('capacity is starters plus bench',
  roster_capacity('{"starters": {"QB": 1, "RB": 1}, "bench": 1}'::jsonb), 3);

-- All three want the same player; Alpha has the best priority.
\o /dev/null
insert into waiver_claims (league_id, manager_id, add_player) values
  (:'W', (select id from managers where league_id = :'W' and slot = 'AAA'), 'Star Player'),
  (:'W', (select id from managers where league_id = :'W' and slot = 'BBB'), 'Star Player'),
  (:'W', (select id from managers where league_id = :'W' and slot = 'CCC'), 'Star Player');
select process_waivers(:'W');
\o

select expect('exactly one manager gets the contested player',
  (select count(*)::int from roster_slots where league_id = :'W' and player_name = 'Star Player'), 1);

select expect('the best priority wins it',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'W' and r.player_name = 'Star Player'), 'AAA');

select expect('the losers are told why',
  (select count(*)::int from waiver_claims
    where league_id = :'W' and status = 'lost' and reason like '%already rostered%'), 2);

select expect('winning sends you to the back of the queue',
  (select waiver_priority from managers where league_id = :'W' and slot = 'AAA'), 3);

select expect('everyone below moves up',
  (select string_agg(slot, ',' order by waiver_priority) from managers where league_id = :'W'),
  'BBB,CCC,AAA');

-- A second round: Bravo now has priority, and rolling order must hold.
\o /dev/null
insert into waiver_claims (league_id, manager_id, add_player) values
  (:'W', (select id from managers where league_id = :'W' and slot = 'BBB'), 'Second Player'),
  (:'W', (select id from managers where league_id = :'W' and slot = 'CCC'), 'Second Player');
select process_waivers(:'W');
\o

select expect('the new best priority wins the next one',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'W' and r.player_name = 'Second Player'), 'BBB');

select expect('priority rolls again',
  (select string_agg(slot, ',' order by waiver_priority) from managers where league_id = :'W'),
  'CCC,AAA,BBB');

-- Roster capacity.
\o /dev/null
select signin(:'W3');
select add_player(:'W', 'Filler One');
select add_player(:'W', 'Filler Two');
select add_player(:'W', 'Filler Three');
\o

select expect('a roster fills to capacity',
  roster_count((select id from managers where league_id = :'W' and slot = 'CCC')), 3);

select expect('a full roster refuses another add',
  refuses(format('select add_player(%L, %L)', :'W', 'One Too Many')) like '%roster is full%',
  true);

select expect('the refused add did not land',
  (select count(*)::int from roster_slots where league_id = :'W' and player_name = 'One Too Many'), 0);

select expect('adding with a drop makes room',
  (select (add_player(:'W', 'Swapped In', 'Filler One') ->> 'ok')::boolean), true);

select expect('the dropped player is gone',
  (select count(*)::int from roster_slots where league_id = :'W' and player_name = 'Filler One'), 0);

select expect('dropping someone you do not hold is refused',
  refuses(format('select drop_player(%L, %L)', :'W', 'Not Yours')) like '%do not hold%', true);

select expect('a rostered player cannot be added by someone else',
  refuses(format('select add_player(%L, %L)', :'W', 'Star Player')) like '%already rostered%', true);

-- IR does not count against capacity.
\o /dev/null
update roster_slots set lineup_slot = 'IR'
 where league_id = :'W' and player_name = 'Filler Two';
\o

select expect('IR sits outside the roster count',
  roster_count((select id from managers where league_id = :'W' and slot = 'CCC')), 2);

select expect('so an add is allowed again',
  (select (add_player(:'W', 'Back In', null) ->> 'ok')::boolean), true);

select expect('every move is logged',
  (select count(*)::int > 0 from transactions where league_id = :'W' and kind = 'waiver'), true);

\echo ''
\echo '--- schedule ---'

\o /dev/null
\set S '99999999-0000-0000-0000-000000000003'
\set S1 'dddd0000-0000-0000-0000-000000000001'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'S', 'Sched', 2026, 'AAA', '{"regularWeeks": 3, "starters": {"QB": 1}, "bench": 1}'::jsonb);

insert into auth.users (id) values (:'S1');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'S', 'AAA', 'A', 'Alpha',   true,  :'S1'),
  (:'S', 'BBB', 'B', 'Bravo',   false, null),
  (:'S', 'CCC', 'C', 'Charlie', false, null),
  (:'S', 'DDD', 'D', 'Delta',   false, null);

select signin(:'S1');
select generate_schedule(:'S');
\o

select expect('four franchises split into two divisions',
  (select string_agg(division || ':' || n, ' ' order by division) from (
     select division, count(*) n from managers where league_id = :'S' group by division
   ) d), 'East:2 West:2');

-- Everyone once (3 weeks) plus the divisional rematch (1 week) = 4 weeks, 8 games.
select expect('the season is a full round robin plus the divisional rematches',
  (select count(*)::int from matchups where league_id = :'S'), 8);

select expect('over the weeks that implies',
  (select max(week)::int from matchups where league_id = :'S'), 4);

select expect('the season length is written back to the league',
  (select (settings ->> 'regularWeeks')::int from leagues where id = :'S'), 4);

select expect('nobody appears twice in a week',
  (select count(*)::int from (
     select week, m from matchups, lateral (values (home_manager), (away_manager)) v(m)
      where league_id = :'S'
      group by week, m having count(*) > 1
   ) dupes), 0);

select expect('nobody plays themselves',
  (select count(*)::int from matchups
    where league_id = :'S' and home_manager = away_manager), 0);

-- The point of the exercise: division rivals twice, everyone else once.
select expect('divisional rivals meet twice',
  (select bool_and(n = 2) from (
     select count(*) n from matchups x
       join managers h on h.id = x.home_manager
       join managers a on a.id = x.away_manager
      where x.league_id = :'S' and h.division = a.division
      group by least(x.home_manager::text, x.away_manager::text),
               greatest(x.home_manager::text, x.away_manager::text)
   ) pairs), true);

select expect('everyone outside the division is met once',
  (select bool_and(n = 1) from (
     select count(*) n from matchups x
       join managers h on h.id = x.home_manager
       join managers a on a.id = x.away_manager
      where x.league_id = :'S' and h.division <> a.division
      group by least(x.home_manager::text, x.away_manager::text),
               greatest(x.home_manager::text, x.away_manager::text)
   ) pairs), true);

select expect('divisional games are flagged as such',
  (select count(*)::int from matchups x
     join managers h on h.id = x.home_manager
     join managers a on a.id = x.away_manager
    where x.league_id = :'S' and x.divisional <> (h.division = a.division)), 0);

select expect('and there are four of them',
  (select count(*)::int from matchups where league_id = :'S' and divisional), 4);

-- An odd league gives someone a bye each week rather than a broken pairing.
\o /dev/null
insert into managers (league_id, slot, name, franchise) values (:'S', 'EEE', 'E', 'Echo');
select generate_schedule(:'S');
\o

select expect('an odd league still pairs cleanly',
  (select count(*)::int from matchups where league_id = :'S' and home_manager = away_manager), 0);

select expect('and never puts more games in a week than there are pairs',
  (select bool_and(n <= 2) from (
     select week, count(*) n from matchups where league_id = :'S' group by week
   ) per_week), true);

select expect('an odd league still never plays anyone twice in a week',
  (select count(*)::int from (
     select week, m from matchups, lateral (values (home_manager), (away_manager)) v(m)
      where league_id = :'S'
      group by week, m having count(*) > 1
   ) dupes), 0);

-- The real shape: twelve franchises, six a side.
\o /dev/null
\set D '99999999-0000-0000-0000-000000000006'
insert into leagues (id, name, season, commissioner_slot, settings)
values (:'D', 'Twelve', 2026, 'F01', '{"regularWeeks": 13}'::jsonb);
insert into managers (league_id, slot, name, franchise)
select :'D', 'F' || lpad(i::text, 2, '0'), 'Open', 'Franchise ' || i
  from generate_series(1, 12) i;
select generate_schedule(:'D');
\o

select expect('twelve franchises split six and six',
  (select string_agg(division || ':' || n, ' ' order by division) from (
     select division, count(*) n from managers where league_id = :'D' group by division
   ) d), 'East:6 West:6');

select expect('a twelve-team season runs sixteen weeks',
  (select max(week)::int from matchups where league_id = :'D'), 16);

select expect('which is 96 games',
  (select count(*)::int from matchups where league_id = :'D'), 96);

select expect('six games every week, nobody idle',
  (select bool_and(n = 6) from (
     select week, count(*) n from matchups where league_id = :'D' group by week
   ) per_week), true);

select expect('every divisional rival is met twice',
  (select bool_and(n = 2) from (
     select count(*) n from matchups x
       join managers h on h.id = x.home_manager
       join managers a on a.id = x.away_manager
      where x.league_id = :'D' and h.division = a.division
      group by least(x.home_manager::text, x.away_manager::text),
               greatest(x.home_manager::text, x.away_manager::text)
   ) pairs), true);

select expect('every cross-division rival exactly once',
  (select bool_and(n = 1) from (
     select count(*) n from matchups x
       join managers h on h.id = x.home_manager
       join managers a on a.id = x.away_manager
      where x.league_id = :'D' and h.division <> a.division
      group by least(x.home_manager::text, x.away_manager::text),
               greatest(x.home_manager::text, x.away_manager::text)
   ) pairs), true);

select expect('so everyone plays sixteen games',
  (select bool_and(n = 16) from (
     select m, count(*) n from matchups, lateral (values (home_manager), (away_manager)) v(m)
      where league_id = :'D' group by m
   ) per_team), true);

-- Grading, on its own two-franchise league so the pairing is not in doubt.
\o /dev/null
\set G '99999999-0000-0000-0000-000000000004'
\set G1 'eeee0000-0000-0000-0000-000000000001'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'G', 'Grade', 2026, 'AAA', '{"regularWeeks": 1, "starters": {"QB": 1}, "bench": 1}'::jsonb);

insert into auth.users (id) values (:'G1');
insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'G', 'AAA', 'A', 'Alpha', true,  :'G1'),
  (:'G', 'BBB', 'B', 'Bravo', false, null);

select signin(:'G1');
select generate_schedule(:'G');

insert into roster_slots (league_id, manager_id, player_name, lineup_slot) values
  (:'G', (select id from managers where league_id = :'G' and slot = 'AAA'), 'Starter A', 'QB'),
  (:'G', (select id from managers where league_id = :'G' and slot = 'AAA'), 'Bench A', 'BENCH'),
  (:'G', (select id from managers where league_id = :'G' and slot = 'BBB'), 'Starter B', 'QB');

insert into player_scores (league_id, week, player_name, points) values
  (:'G', 1, 'Starter A', 20), (:'G', 1, 'Bench A', 99), (:'G', 1, 'Starter B', 15);

-- Week 1 games are still being played.
insert into nfl_games (id, season, week, season_type, starts_at, home_team, away_team, state, completed)
values ('g1', 2026, 1, 2, now(), 'SEA', 'SF', 'in', false);

select grade_week(:'G', 1);
\o

select expect('only starters count — the bench is ignored',
  lineup_points(:'G', (select id from managers where league_id = :'G' and slot = 'AAA'), 1),
  20::numeric);

select expect('an unfinished week is not final',
  (select bool_or(final) from matchups where league_id = :'G' and week = 1), false);

select expect('an unfinished week has no winner',
  (select count(*)::int from matchups where league_id = :'G' and week = 1 and winner is not null), 0);

select expect('but it still carries live points',
  (select max(greatest(home_points, away_points)) from matchups where league_id = :'G' and week = 1),
  20::numeric);

select expect('an unfinished week counts for nothing in the table',
  (select sum(wins + losses + ties)::int from standings(:'G')), 0);

-- The games finish.
\o /dev/null
update nfl_games set completed = true, state = 'post' where id = 'g1';
select grade_week(:'G', 1);
\o

select expect('a finished week is final',
  (select bool_and(final) from matchups where league_id = :'G' and week = 1), true);

select expect('the higher score wins',
  (select m.slot from matchups x join managers m on m.id = x.winner
    where x.league_id = :'G' and x.week = 1), 'AAA');

select expect('the winner has a win',
  (select wins from standings(:'G') where slot = 'AAA'), 1);

select expect('the loser has a loss',
  (select losses from standings(:'G') where slot = 'BBB'), 1);

select expect('points for and against are recorded',
  (select points_for::int || '/' || points_against::int from standings(:'G') where slot = 'AAA'),
  '20/15');

select expect('the starters are snapshotted',
  (select jsonb_array_length(home_starters) > 0 from matchups
    where league_id = :'G' and week = 1), true);

-- A later lineup change must not rewrite a finished week.
\o /dev/null
update roster_slots set lineup_slot = 'BENCH'
 where league_id = :'G' and player_name = 'Starter A';
select grade_week(:'G', 1);
\o

select expect('a final week is not regraded',
  (select max(greatest(home_points, away_points)) from matchups where league_id = :'G' and week = 1),
  20::numeric);

select expect('and the record still stands',
  (select wins from standings(:'G') where slot = 'AAA'), 1);

select expect('the schedule cannot be rebuilt once a week is final',
  refuses(format('select generate_schedule(%L)', :'G')) like '%schedule is fixed%', true);

select expect('a non-commissioner cannot build the schedule',
  (select refuses(format('select commissioner_generate_schedule(%L)', :'G'))
     from (select signin(:'U2')) _),
  'Only the commissioner can build the schedule');

-- A tie is a tie, not a win for whoever is listed first.
\o /dev/null
\set T3 '99999999-0000-0000-0000-000000000005'
insert into leagues (id, name, season, commissioner_slot, settings)
values (:'T3', 'Tie', 2026, 'AAA', '{"regularWeeks": 1, "starters": {"QB": 1}, "bench": 1}'::jsonb);
insert into managers (league_id, slot, name, franchise) values
  (:'T3', 'AAA', 'A', 'Alpha'), (:'T3', 'BBB', 'B', 'Bravo');
select generate_schedule(:'T3');
insert into roster_slots (league_id, manager_id, player_name, lineup_slot) values
  (:'T3', (select id from managers where league_id = :'T3' and slot = 'AAA'), 'Tie A', 'QB'),
  (:'T3', (select id from managers where league_id = :'T3' and slot = 'BBB'), 'Tie B', 'QB');
insert into player_scores (league_id, week, player_name, points) values
  (:'T3', 1, 'Tie A', 12), (:'T3', 1, 'Tie B', 12);
select grade_week(:'T3', 1);
\o

select expect('an equal score is a tie',
  (select is_tie from matchups where league_id = :'T3' and week = 1), true);

select expect('a tie has no winner',
  (select winner is null from matchups where league_id = :'T3' and week = 1), true);

select expect('a tie is recorded for both',
  (select sum(ties)::int from standings(:'T3')), 2);

\echo ''
\echo '--- column privileges ---'
-- Row-level security says which rows you may touch, not which columns. These
-- check the half that policies do not cover.

\o /dev/null
\set P '99999999-0000-0000-0000-000000000007'
\set P1 'ffff0000-0000-0000-0000-000000000001'
\set P2 'ffff0000-0000-0000-0000-000000000002'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'P', 'Privs', 2026, 'AAA', '{"starters":{"QB":1},"bench":4}'::jsonb);
insert into auth.users (id) values (:'P1'), (:'P2');
insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'P', 'AAA', 'A', 'Alpha', true,  :'P1'),
  (:'P', 'BBB', 'B', 'Bravo', false, :'P2');
insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
  select :'P', id, 'Mine', 'BENCH' from managers where league_id = :'P' and slot = 'BBB';
\o

-- The grants are what enforce this, so they are read directly: a test running
-- as the owner would bypass them.
select expect('a manager cannot update is_commissioner',
  has_column_privilege('authenticated', 'managers', 'is_commissioner', 'UPDATE'), false);

select expect('nor waiver_priority',
  has_column_privilege('authenticated', 'managers', 'waiver_priority', 'UPDATE'), false);

select expect('nor their own PIN hash',
  has_column_privilege('authenticated', 'managers', 'pin_hash', 'UPDATE'), false);

select expect('nor which auth user they are',
  has_column_privilege('authenticated', 'managers', 'auth_user_id', 'UPDATE'), false);

select expect('but may rename their franchise',
  has_column_privilege('authenticated', 'managers', 'franchise', 'UPDATE'), true);

select expect('a manager cannot rewrite who is on their roster',
  has_column_privilege('authenticated', 'roster_slots', 'player_name', 'UPDATE'), false);

select expect('nor move a player to another manager',
  has_column_privilege('authenticated', 'roster_slots', 'manager_id', 'UPDATE'), false);

select expect('nor relabel how they acquired him',
  has_column_privilege('authenticated', 'roster_slots', 'acquired', 'UPDATE'), false);

select expect('but may set who starts',
  has_column_privilege('authenticated', 'roster_slots', 'lineup_slot', 'UPDATE'), true);

-- The trade-forgery guard keys on the current role, which cannot be switched
-- from inside a function, so those checks live in tests/forgery.sql and are
-- run separately by scripts/test-db.sh.

\echo ''
\echo '--- the commissioner is one franchise ---'

\o /dev/null
\set C '99999999-0000-0000-0000-000000000008'
insert into leagues (id, name, season, commissioner_slot, settings)
values (:'C', 'Office', 2026, 'STL', '{"starters":{"QB":1},"bench":2}'::jsonb);

insert into managers (league_id, slot, name, franchise) values
  (:'C', 'STL', 'Open', 'Steel Cartel'),
  (:'C', 'BLZ', 'Open', 'Blaze Syndicate'),
  (:'C', 'RVN', 'Open', 'Ravenous');
\o

select expect('the named franchise holds the office',
  (select slot from managers where league_id = :'C' and is_commissioner), 'STL');

select expect('and it is the only one',
  (select count(*)::int from managers where league_id = :'C' and is_commissioner), 1);

-- Inserting a franchise that claims the office does not get it.
\o /dev/null
insert into managers (league_id, slot, name, franchise, is_commissioner)
values (:'C', 'HELX', 'Open', 'Helix Nine', true);
\o

select expect('a new franchise cannot arrive as commissioner',
  (select is_commissioner from managers where league_id = :'C' and slot = 'HELX'), false);

select expect('the office is still only Steel Cartel',
  (select string_agg(slot, ',') from managers where league_id = :'C' and is_commissioner), 'STL');

-- Nor can an existing one take it, even writing directly as the owner.
\o /dev/null
update managers set is_commissioner = true where league_id = :'C' and slot = 'BLZ';
\o

select expect('an existing franchise cannot take the office',
  (select is_commissioner from managers where league_id = :'C' and slot = 'BLZ'), false);

select expect('nor can Steel Cartel be stripped of it',
  (select is_commissioner from managers where league_id = :'C' and slot = 'STL'), true);

\o /dev/null
update managers set is_commissioner = false where league_id = :'C' and slot = 'STL';
\o

select expect('even setting it false directly does not stick',
  (select is_commissioner from managers where league_id = :'C' and slot = 'STL'), true);

select expect('a browser session cannot move the office',
  has_column_privilege('authenticated', 'leagues', 'commissioner_slot', 'UPDATE'), false);

select expect('but may still save league settings',
  has_column_privilege('authenticated', 'leagues', 'settings', 'UPDATE'), true);

select expect('and the draft date',
  has_column_privilege('authenticated', 'leagues', 'draft_at', 'UPDATE'), true);

-- Handing the office over is deliberate, with the service key.
\o /dev/null
update leagues set commissioner_slot = 'BLZ' where id = :'C';
update managers m set is_commissioner = (m.slot = l.commissioner_slot)
  from leagues l where l.id = m.league_id and m.league_id = :'C';
\o

select expect('the owner can hand the office over',
  (select slot from managers where league_id = :'C' and is_commissioner), 'BLZ');

select expect('and it is still held by exactly one',
  (select count(*)::int from managers where league_id = :'C' and is_commissioner), 1);

\echo ''
\echo '--- resizing rebuilds the season ---'

\o /dev/null
\set R  '99999999-0000-0000-0000-000000000009'
\set R1 'a9990000-0000-0000-0000-000000000001'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'R', 'Resize', 2026, 'STL', '{"rounds": 2}'::jsonb);

insert into auth.users (id) values (:'R1');

-- The office holder sorts near the end of the alphabet on purpose. Removal
-- runs from the back, so this is exactly the arrangement that used to delete
-- the commissioner's own franchise and fail on the admin log's foreign key.
insert into managers (league_id, slot, name, franchise)
select :'R', 'F' || lpad(i::text, 2, '0'), 'Open', 'Franchise ' || i
  from generate_series(1, 11) i;

insert into managers (league_id, slot, name, franchise, auth_user_id)
values (:'R', 'STL', 'Boss', 'Steel Cartel', :'R1');

select signin(:'R1');
select generate_schedule(:'R');
\o

select expect('the twelve-team season starts out right',
  (select max(week)::int || '/' || count(*)::int from matchups where league_id = :'R'),
  '16/96');

-- The bug: this used to rebuild the board and leave the season alone, so the
-- departed franchises' fixtures cascaded out and left a twelve-team shape with
-- holes in it — sixteen weeks, sixty-six games, two franchises idle a week.
\o /dev/null
select set_team_count(:'R', 10);
\o

select expect('shrinking leaves the right number of franchises',
  (select count(*)::int from managers where league_id = :'R'), 10);

select expect('and never removes the commissioner',
  (select slot from managers where league_id = :'R' and is_commissioner), 'STL');

select expect('the divisions are evened up, not left lopsided',
  (select string_agg(division || ':' || n, ' ' order by division) from (
     select division, count(*) n from managers where league_id = :'R' group by division
   ) d), 'East:5 West:5');

select expect('the season is regenerated at the new size',
  (select max(week)::int || '/' || count(*)::int from matchups where league_id = :'R'),
  '14/65');

select expect('and the new length is written back to the league',
  (select (settings ->> 'regularWeeks')::int from leagues where id = :'R'), 14);

select expect('everybody plays thirteen games',
  (select bool_and(n = 13) from (
     select m, count(*) n from matchups, lateral (values (home_manager), (away_manager)) v(m)
      where league_id = :'R' group by m
   ) per_team), true);

select expect('nobody appears twice in a week',
  (select count(*)::int from (
     select week, m from matchups, lateral (values (home_manager), (away_manager)) v(m)
      where league_id = :'R'
      group by week, m having count(*) > 1
   ) dupes), 0);

select expect('the full round robin seats every franchise every week',
  (select bool_and(n = 5) from (
     select week, count(*) n from matchups where league_id = :'R' and week <= 9 group by week
   ) per_week), true);

select expect('divisional rivals still meet twice',
  (select bool_and(n = 2) from (
     select count(*) n from matchups x
       join managers h on h.id = x.home_manager
       join managers a on a.id = x.away_manager
      where x.league_id = :'R' and h.division = a.division
      group by least(x.home_manager::text, x.away_manager::text),
               greatest(x.home_manager::text, x.away_manager::text)
   ) pairs), true);

select expect('the board is rebuilt at the new size too',
  (select count(*)::int from draft_picks where league_id = :'R'), 20);

-- Rebalancing on its own: it moves as few franchises as it can, and it leaves
-- a league that is already close enough entirely alone.
\o /dev/null
update managers set division = 'East'
 where id = (select id from managers where league_id = :'R' and division = 'West'
              order by slot limit 1);
\o

select expect('a six-four split takes one move to fix', rebalance_divisions(:'R'), 1);

select expect('and comes out even',
  (select string_agg(division || ':' || n, ' ' order by division) from (
     select division, count(*) n from managers where league_id = :'R' group by division
   ) d), 'East:5 West:5');

select expect('an even league is left alone', rebalance_divisions(:'R'), 0);

\o /dev/null
insert into managers (league_id, slot, name, franchise) values (:'R', 'ODD', 'O', 'Odd One');
select assign_missing_divisions(:'R');
\o

select expect('an odd league is close enough at one apart', rebalance_divisions(:'R'), 0);

select expect('so it stays six and five',
  (select string_agg(n::text, '/' order by n desc) from (
     select count(*) n from managers where league_id = :'R' group by division
   ) d), '6/5');

-- A season under way fixes the shape as firmly as a made pick does.
\o /dev/null
select set_team_count(:'R', 10);
update matchups set final = true where league_id = :'R' and week = 1;
\o

select expect('a played week freezes the league size',
  refuses(format('select set_team_count(%L, 8)', :'R')),
  'Weeks have already been played — the league size is fixed now');

select expect('and the season survives the refusal',
  (select max(week)::int || '/' || count(*)::int from matchups where league_id = :'R'),
  '14/65');

\echo ''
\echo '--- repairing a schedule left over from a bigger league ---'

\o /dev/null
\set Q '99999999-0000-0000-0000-000000000010'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'Q', 'Repair', 2026, 'F01', '{"rounds": 2}'::jsonb);

insert into managers (league_id, slot, name, franchise)
select :'Q', 'F' || lpad(i::text, 2, '0'), 'Open', 'Franchise ' || i
  from generate_series(1, 12) i;

select generate_schedule(:'Q');

create temp table before_repair as
select md5(string_agg(week || ':' || home_manager || ':' || away_manager, ','
             order by week, home_manager, away_manager)) h
  from matchups where league_id = :'Q';
\o

select expect('a healthy league is left alone', repair_schedule(:'Q'), false);

select expect('right down to the fixtures',
  (select md5(string_agg(week || ':' || home_manager || ':' || away_manager, ','
                order by week, home_manager, away_manager))
     from matchups where league_id = :'Q'),
  (select h from before_repair));

-- Break it the way the old set_team_count did: drop two franchises from one
-- division and leave the season exactly as it was.
\o /dev/null
delete from managers
 where id in (select id from managers
               where league_id = :'Q' and division = 'East'
               order by slot desc limit 2);
\o

select expect('which leaves a twelve-team season for ten franchises',
  (select max(week)::int || '/' || count(*)::int from matchups where league_id = :'Q'),
  '16/66');

select expect('and lopsided divisions',
  (select string_agg(division || ':' || n, ' ' order by division) from (
     select division, count(*) n from managers where league_id = :'Q' group by division
   ) d), 'East:4 West:6');

select expect('the repair spots it', repair_schedule(:'Q'), true);

select expect('and rebuilds the season the league actually implies',
  (select max(week)::int || '/' || count(*)::int from matchups where league_id = :'Q'),
  '14/65');

select expect('evening the divisions on the way past',
  (select string_agg(division || ':' || n, ' ' order by division) from (
     select division, count(*) n from managers where league_id = :'Q' group by division
   ) d), 'East:5 West:5');

select expect('everybody plays thirteen again',
  (select bool_and(n = 13) from (
     select m, count(*) n from matchups, lateral (values (home_manager), (away_manager)) v(m)
      where league_id = :'Q' group by m
   ) per_team), true);

select expect('running it a second time changes nothing', repair_schedule(:'Q'), false);

-- Five to a division means one sits out each rematch week. That is the shape
-- of a correct schedule, not a broken one, and the repair must not chase it.
select expect('an idle franchise in a rematch week is not treated as damage',
  (select bool_and(n = 4) from (
     select week, count(*) n from matchups where league_id = :'Q' and week > 9 group by week
   ) per_week), true);

-- Once a week has been played the season is history, however wrong it looks.
\o /dev/null
update matchups set final = true where league_id = :'Q' and week = 1;
delete from managers
 where id = (select id from managers where league_id = :'Q' and division = 'West'
              order by slot desc limit 1);

create temp table mid_season as
select md5(string_agg(week || ':' || home_manager || ':' || away_manager, ','
             order by week, home_manager, away_manager)) h
  from matchups where league_id = :'Q';
\o

select expect('a season under way is never rebuilt', repair_schedule(:'Q'), false);

select expect('however badly it now matches the league',
  (select md5(string_agg(week || ':' || home_manager || ':' || away_manager, ','
                order by week, home_manager, away_manager))
     from matchups where league_id = :'Q'),
  (select h from mid_season));

-- A league that has never had a schedule generated has nothing to compare
-- against, so the repair leaves it be rather than inventing one.
\o /dev/null
\set Q2 '99999999-0000-0000-0000-000000000011'
insert into leagues (id, name, season, commissioner_slot)
values (:'Q2', 'Unscheduled', 2026, 'F01');
insert into managers (league_id, slot, name, franchise)
select :'Q2', 'F' || lpad(i::text, 2, '0'), 'Open', 'Franchise ' || i
  from generate_series(1, 8) i;
\o

select expect('a league with no schedule yet has nothing to repair',
  repair_schedule(:'Q2'), false);

select expect('and is not given one behind the commissioner''s back',
  (select count(*)::int from matchups where league_id = :'Q2'), 0);

\echo ''
\echo '--- resetting the draft ---'

\o /dev/null
\set X  '99999999-0000-0000-0000-000000000012'
\set X1 'a9990000-0000-0000-0000-000000000011'
\set X2 'a9990000-0000-0000-0000-000000000012'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'X', 'Reset', 2026, 'AAA', '{"rounds": 3, "starters": {"QB": 1}, "bench": 5}'::jsonb);

insert into auth.users (id) values (:'X1'), (:'X2');

insert into managers (league_id, slot, name, franchise, auth_user_id) values
  (:'X', 'AAA', 'One', 'Alpha', :'X1'),
  (:'X', 'BBB', 'Two', 'Bravo', :'X2');

select signin(:'X1');
select rebuild_draft_board(:'X');
update leagues set draft_state = 'running', pick_started_at = now() where id = :'X';

-- A draft in progress, plus everything that hangs off one: a trade agreed but
-- not executed, a pending claim, a listing, and a manager's own queue.
select make_pick(:'X', 'Alpha One');
select signin(:'X2');
select make_pick(:'X', 'Bravo One');
select signin(:'X2');
select make_pick(:'X', 'Bravo Two');
select signin(:'X1');
select make_pick(:'X', 'Alpha Two');

insert into trades (league_id, from_manager, to_manager, offer, status, from_accepted, to_accepted)
values (:'X',
  (select id from managers where league_id = :'X' and slot = 'AAA'),
  (select id from managers where league_id = :'X' and slot = 'BBB'),
  '{"give": ["Alpha One"], "get": ["Bravo One"]}'::jsonb, 'agreed', true, true);

insert into waiver_claims (league_id, manager_id, add_player, drop_player)
values (:'X', (select id from managers where league_id = :'X' and slot = 'BBB'),
        'Somebody Else', 'Bravo One');

insert into trade_block (league_id, player_name, manager_id)
values (:'X', 'Alpha One', (select id from managers where league_id = :'X' and slot = 'AAA'));

insert into draft_queue (league_id, manager_id, player_name, rank)
values (:'X', (select id from managers where league_id = :'X' and slot = 'AAA'), 'Wanted Later', 1);
\o

select expect('four picks are in the book',
  (select count(*)::int from draft_picks where league_id = :'X' and player_name is not null), 4);

select expect('a manager cannot reset the draft',
  (select refuses(format('select reset_draft(%L)', :'X'))
     from (select signin(:'X2')) _),
  'Only the commissioner can reset the draft');

select expect('and nothing was undone by the attempt',
  (select count(*)::int from roster_slots where league_id = :'X'), 4);

\o /dev/null
select signin(:'X1');
select reset_draft(:'X');
\o

select expect('the rosters are empty',
  (select count(*)::int from roster_slots where league_id = :'X'), 0);

select expect('no pick has a player on it',
  (select count(*)::int from draft_picks where league_id = :'X' and player_name is not null), 0);

select expect('but the board is still there, at the league size',
  (select count(*)::int from draft_picks where league_id = :'X'), 6);

select expect('and it snakes the way a fresh board does',
  (select string_agg(m.slot, ',' order by p.overall) from draft_picks p
     join managers m on m.id = p.manager_id
    where p.league_id = :'X'), 'AAA,BBB,BBB,AAA,AAA,BBB');

select expect('the room is closed again',
  (select draft_state from leagues where id = :'X'), 'pending');

select expect('back on the first pick',
  (select current_pick from leagues where id = :'X'), 1);

select expect('with nobody on the clock',
  (select pick_started_at from leagues where id = :'X'), null::timestamptz);

select expect('the standing offer is declined, not left unrunnable',
  (select status from trades where league_id = :'X'), 'declined');

select expect('the pending claim is cancelled',
  (select status from waiver_claims where league_id = :'X'), 'cancelled');

select expect('and says why',
  (select reason from waiver_claims where league_id = :'X'), 'The draft was reset');

select expect('nobody is shopping anybody',
  (select count(*)::int from trade_block where league_id = :'X'), 0);

select expect('a manager keeps their own queue',
  (select player_name from draft_queue where league_id = :'X'), 'Wanted Later');

select expect('the reset is on the record',
  (select detail ->> 'picks_undone' from admin_log
    where league_id = :'X' and action = 'draft_reset'), '4');

select expect('and the rosters were photographed before they went',
  (select jsonb_array_length(payload) from roster_backups
    where league_id = :'X' and kind = 'draft_reset'), 4);

-- The whole point of resetting: draft it again from the top.
\o /dev/null
update leagues set draft_state = 'running', pick_started_at = now() where id = :'X';
\o

select expect('a player taken in the old draft can be taken again',
  (select refuses(format('select make_pick(%L, %L)', :'X', 'Alpha One'))
     from (select signin(:'X1')) _),
  null::text);

-- Once a week is graded the rosters are part of the record.
\o /dev/null
select signin(:'X1');
select reset_draft(:'X');
select generate_schedule(:'X');
update matchups set final = true where league_id = :'X' and week = 1;
\o

select expect('a played week closes the door on resetting',
  refuses(format('select reset_draft(%L)', :'X')),
  'Weeks have already been played — the draft cannot be reset now');

\echo ''
\echo '--- resetting the league ---'

\o /dev/null
\set Y  '99999999-0000-0000-0000-000000000013'
\set Y1 'a9990000-0000-0000-0000-000000000021'
\set Y2 'a9990000-0000-0000-0000-000000000022'

insert into leagues (id, name, season, commissioner_slot, settings, lottery_order)
values (:'Y', 'Wipe', 2026, 'AAA', '{"rounds": 2, "starters": {"QB": 1}, "bench": 5}'::jsonb,
        array['BBB', 'AAA']);

insert into auth.users (id) values (:'Y1'), (:'Y2');

insert into managers (league_id, slot, name, franchise, auth_user_id, ready) values
  (:'Y', 'AAA', 'Boss', 'Alpha', :'Y1', true),
  (:'Y', 'BBB', 'Two',  'Bravo', :'Y2', true);

update managers set pin_hash = 'hashed' where league_id = :'Y';

select signin(:'Y1');
select rebuild_draft_board(:'Y');
update leagues set draft_state = 'running', pick_started_at = now() where id = :'Y';

-- A league with a season's worth of everything in it. The lottery order above
-- puts Bravo on the clock first, which is the point of setting one.
select signin(:'Y2');
select make_pick(:'Y', 'Bravo One');
select signin(:'Y1');
select make_pick(:'Y', 'Alpha One');

select generate_schedule(:'Y');
update matchups set final = true, home_points = 101, winner = home_manager
 where league_id = :'Y' and week = 1;

insert into player_scores (league_id, week, player_name, points) values (:'Y', 1, 'Alpha One', 22);
insert into trade_block (league_id, player_name, manager_id)
values (:'Y', 'Alpha One', (select id from managers where league_id = :'Y' and slot = 'AAA'));
insert into waiver_claims (league_id, manager_id, add_player)
values (:'Y', (select id from managers where league_id = :'Y' and slot = 'BBB'), 'Somebody');
insert into draft_queue (league_id, manager_id, player_name, rank)
values (:'Y', (select id from managers where league_id = :'Y' and slot = 'AAA'), 'Wanted', 1);
insert into nfl_games (id, season, week, starts_at, home_team, away_team)
values ('evt-reset', 2026, 1, now(), 'BUF', 'MIA');
insert into pickem_picks (league_id, manager_id, game_id, pick)
values (:'Y', (select id from managers where league_id = :'Y' and slot = 'AAA'), 'evt-reset', 'BUF');
\o

select expect('a played week does not stop a league reset the way it stops a draft reset',
  refuses(format('select reset_draft(%L)', :'Y')),
  'Weeks have already been played — the draft cannot be reset now');

select expect('a manager cannot reset the league',
  (select refuses(format('select reset_league(%L)', :'Y'))
     from (select signin(:'Y2')) _),
  'Only the commissioner can reset the league');

select expect('and nothing was wiped by the attempt',
  (select count(*)::int from roster_slots where league_id = :'Y'), 2);

\o /dev/null
select signin(:'Y1');
select reset_league(:'Y');
\o

select expect('the rosters are gone',
  (select count(*)::int from roster_slots where league_id = :'Y'), 0);

select expect('the season is gone, played weeks and all',
  (select count(*)::int from matchups where league_id = :'Y'), 0);

select expect('so are the scores',
  (select count(*)::int from player_scores where league_id = :'Y'), 0);

select expect('the transaction log is cleared',
  (select count(*)::int from transactions where league_id = :'Y'), 0);

select expect('claims, trade block, queues and pick-em go too',
  (select (select count(*) from waiver_claims where league_id = :'Y')
        + (select count(*) from trade_block  where league_id = :'Y')
        + (select count(*) from draft_queue  where league_id = :'Y')
        + (select count(*) from pickem_picks where league_id = :'Y'))::int, 0);

select expect('the board is redrawn empty',
  (select count(*)::int from draft_picks where league_id = :'Y' and player_name is not null), 0);

select expect('and is still the right size',
  (select count(*)::int from draft_picks where league_id = :'Y'), 4);

select expect('the room is closed',
  (select draft_state || ':' || current_pick from leagues where id = :'Y'), 'pending:1');

select expect('the lottery is not carried into a season that is not happening',
  (select lottery_order from leagues where id = :'Y'), null::text[]);

-- What survives is the point: the league, not what happened in it.
select expect('the franchises are still here',
  (select count(*)::int from managers where league_id = :'Y'), 2);

select expect('nobody has to sign up again',
  (select count(*)::int from managers where league_id = :'Y' and pin_hash is not null), 2);

select expect('the commissioner is still the commissioner',
  (select slot from managers where league_id = :'Y' and is_commissioner), 'AAA');

select expect('waiver order goes back to the order the league was written in',
  (select string_agg(slot || ':' || waiver_priority, ' ' order by slot)
     from managers where league_id = :'Y'), 'AAA:1 BBB:2');

select expect('and nobody is marked ready for a draft that has not happened',
  (select bool_and(not ready) from managers where league_id = :'Y'), true);

select expect('the rosters were photographed on the way past',
  (select jsonb_array_length(payload) from roster_backups
    where league_id = :'Y' and kind = 'league_reset'), 2);

select expect('the photograph names the franchise, not just an id',
  (select payload -> 0 ->> 'slot' from roster_backups
    where league_id = :'Y' and kind = 'league_reset'), 'AAA');

select expect('and the reset is on the record',
  (select detail ->> 'weeks_played' from admin_log
    where league_id = :'Y' and action = 'league_reset'), '1');

-- Releasing the franchises as well, which is the other thing a reset can mean.
\o /dev/null
update managers set pin_hash = 'hashed', name = 'Two'
 where league_id = :'Y' and slot = 'BBB';
select reset_league(:'Y', true);
\o

select expect('a released franchise is open again',
  (select name || '/' || coalesce(pin_hash, 'none') from managers
    where league_id = :'Y' and slot = 'BBB'), 'Open/none');

select expect('but the commissioner keeps their own way in',
  (select coalesce(pin_hash, 'none') from managers
    where league_id = :'Y' and slot = 'AAA'), 'hashed');

select expect('so the office is still reachable afterwards',
  (select refuses(format('select reset_league(%L)', :'Y'))), null::text);

\echo ''
\echo '--- draft settings ---'

\o /dev/null
\set Z  '99999999-0000-0000-0000-000000000014'
\set Z1 'a9990000-0000-0000-0000-000000000031'
\set Z2 'a9990000-0000-0000-0000-000000000032'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'Z', 'Settings', 2026, 'AAA', '{"rounds": 2, "pickSeconds": 90}'::jsonb);

insert into auth.users (id) values (:'Z1'), (:'Z2');

insert into managers (league_id, slot, name, franchise, auth_user_id) values
  (:'Z', 'AAA', 'One',   'Alpha',   :'Z1'),
  (:'Z', 'BBB', 'Two',   'Bravo',   :'Z2'),
  (:'Z', 'CCC', 'Three', 'Charlie', null);

select signin(:'Z1');
select rebuild_draft_board(:'Z');
\o

select expect('the board starts in slot order',
  (select string_agg(m.slot, ',' order by p.overall) from draft_picks p
     join managers m on m.id = p.manager_id
    where p.league_id = :'Z' and p.round = 1), 'AAA,BBB,CCC');

select expect('a manager cannot set the order',
  (select refuses(format('select set_draft_order(%L, ''{CCC,AAA,BBB}''::text[])', :'Z'))
     from (select signin(:'Z2')) _),
  'Only the commissioner can set the draft order');

\o /dev/null
select signin(:'Z1');
select set_draft_order(:'Z', '{CCC,AAA,BBB}'::text[]);
\o

select expect('the commissioner sets it',
  (select array_to_string(lottery_order, ',') from leagues where id = :'Z'), 'CCC,AAA,BBB');

select expect('and the board is redrawn to match',
  (select string_agg(m.slot, ',' order by p.overall) from draft_picks p
     join managers m on m.id = p.manager_id
    where p.league_id = :'Z' and p.round = 1), 'CCC,AAA,BBB');

select expect('which still snakes',
  (select string_agg(m.slot, ',' order by p.overall) from draft_picks p
     join managers m on m.id = p.manager_id
    where p.league_id = :'Z' and p.round = 2), 'BBB,AAA,CCC');

select expect('an order that drops a franchise is refused',
  refuses(format('select set_draft_order(%L, ''{AAA,BBB}''::text[])', :'Z')),
  'The order must list all 3 franchises, not 2');

select expect('and one that names a franchise twice',
  refuses(format('select set_draft_order(%L, ''{AAA,AAA,BBB}''::text[])', :'Z'))
    like '%does not name this league%', true);

select expect('nor one naming a franchise from somewhere else',
  refuses(format('select set_draft_order(%L, ''{AAA,BBB,ZZZ}''::text[])', :'Z'))
    like '%does not name this league%', true);

\o /dev/null
update leagues set draft_state = 'running', pick_started_at = now() where id = :'Z';
select make_pick(:'Z', 'Somebody Good',
  (select id from managers where league_id = :'Z' and slot = 'CCC'));
\o

select expect('the order is fixed once a pick is made',
  refuses(format('select set_draft_order(%L, ''{AAA,BBB,CCC}''::text[])', :'Z')),
  'The draft has already started — the order is fixed now');

\echo ''
\echo '--- the clock ---'

\o /dev/null
update leagues set pick_started_at = now() where id = :'Z';
\o

select expect('a manager cannot move the clock',
  (select refuses(format('select nudge_clock(%L, 30)', :'Z'))
     from (select signin(:'Z2')) _),
  'Only the commissioner can change the clock');

\o /dev/null
select signin(:'Z1');
\o

-- Asserted as a range rather than a number: now() moves between statements,
-- so the exact remaining depends on how fast the test ran. The claim is that
-- thirty seconds were added, not that the clock reads any particular value.
select expect('the commissioner adds thirty seconds',
  (select (nudge_clock(:'Z', 30) ->> 'remaining')::int > 90
      and (nudge_clock(:'Z', -30) ->> 'remaining')::int <= 90), true);

select expect('and can take them away again',
  (select (nudge_clock(:'Z', -30) ->> 'remaining')::int <= 60), true);

select expect('taking away more than is there leaves a few seconds, not none',
  (select (nudge_clock(:'Z', -600) ->> 'remaining')::int between 1 and 6), true);

select expect('the clock does not move by more than ten minutes',
  refuses(format('select nudge_clock(%L, 900)', :'Z')),
  'Ten minutes either way is the most the clock moves');

\o /dev/null
select set_draft_state(:'Z', 'paused');
\o

select expect('and there is nothing to move when the draft is paused',
  refuses(format('select nudge_clock(%L, 30)', :'Z')),
  'Nobody is on the clock');

\echo ''
\echo '--- letting somebody go ---'

\o /dev/null
\set R2  '99999999-0000-0000-0000-000000000015'
\set RA  'a9990000-0000-0000-0000-000000000041'
\set RB  'a9990000-0000-0000-0000-000000000042'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'R2', 'Leavers', 2026, 'AAA', '{"rounds": 2}'::jsonb);

insert into auth.users (id) values (:'RA'), (:'RB');

insert into managers (league_id, slot, name, franchise, auth_user_id, ready) values
  (:'R2', 'AAA', 'Boss',   'Alpha',  :'RA', true),
  (:'R2', 'BBB', 'Quitter','Bravo',  :'RB', true),
  (:'R2', 'CCC', 'Open',   'Charlie', null, false);

update managers set pin_hash = 'hashed' where league_id = :'R2' and auth_user_id is not null;

insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
select :'R2', id, 'Their Best Player', 'BENCH'
  from managers where league_id = :'R2' and slot = 'BBB';

select signin(:'RA');
\o

select expect('a manager cannot let anybody go',
  (select refuses(format('select release_franchise(%L)',
     (select id from managers where league_id = :'R2' and slot = 'AAA')))
     from (select signin(:'RB')) _),
  'Only the commissioner can release a franchise');

\o /dev/null
select signin(:'RA');
\o

select expect('nor can the commissioner let themselves go',
  refuses(format('select release_franchise(%L)',
    (select id from managers where league_id = :'R2' and slot = 'AAA'))),
  'The commissioner cannot release their own franchise');

select expect('and an open franchise has nobody to let go',
  refuses(format('select release_franchise(%L)',
    (select id from managers where league_id = :'R2' and slot = 'CCC'))),
  'Nobody holds that franchise');

\o /dev/null
select release_franchise((select id from managers where league_id = :'R2' and slot = 'BBB'));
\o

select expect('the person is gone',
  (select coalesce(pin_hash, 'none') || '/' || coalesce(auth_user_id::text, 'none') || '/' || name
     from managers where league_id = :'R2' and slot = 'BBB'), 'none/none/Open');

select expect('and is not left marked ready',
  (select ready from managers where league_id = :'R2' and slot = 'BBB'), false);

select expect('but the franchise stays',
  (select franchise from managers where league_id = :'R2' and slot = 'BBB'), 'Bravo');

select expect('with its roster intact for whoever comes next',
  (select count(*)::int from roster_slots r
     join managers m on m.id = r.manager_id
    where m.league_id = :'R2' and m.slot = 'BBB'), 1);

select expect('the league is still the same size',
  (select count(*)::int from managers where league_id = :'R2'), 3);

select expect('and the seat is open to be claimed',
  (select pin_hash is null from managers where league_id = :'R2' and slot = 'BBB'), true);

select expect('it is on the record, with who it was',
  (select detail ->> 'was' from admin_log
    where league_id = :'R2' and action = 'franchise_released'), 'Quitter');

select expect('and letting go of nobody twice is refused',
  refuses(format('select release_franchise(%L)',
    (select id from managers where league_id = :'R2' and slot = 'BBB'))),
  'Nobody holds that franchise');

\echo ''
\echo '--- what counts as a name somebody chose ---'

-- ---------------------------------------------------------------------------
-- What counts as a name somebody chose
-- ---------------------------------------------------------------------------
-- Two of these names this app made up, and one a manager did. The difference
-- decides whether a franchise keeps its name when its manager leaves.

select expect('the open name is a default',
  (select is_default_franchise_name(open_team_name())), true);

select expect('so is a name derived from a first name',
  (select is_default_franchise_name('Dana''s Team')), true);

select expect('so is a seeded slot number',
  (select is_default_franchise_name('Franchise 7')), true);

select expect('and so is no name at all',
  (select is_default_franchise_name(null)), true);

select expect('but a name somebody chose is not',
  (select is_default_franchise_name('Steel Cartel')), false);

select expect('nor is one that merely mentions a team',
  (select is_default_franchise_name('Team Steel')), false);

-- Bravo above kept its name through a release. A franchise still carrying the
-- name this app gave it does not: it goes back to being an open seat by name
-- as well as in fact, so the sign-up cards do not offer "Quitter's Team".
\o /dev/null
update managers set franchise = 'Quitter''s Team', name = 'Quitter',
       pin_hash = 'hashed', auth_user_id = :'RB'
  where league_id = :'R2' and slot = 'BBB';
select release_franchise((select id from managers where league_id = :'R2' and slot = 'BBB'));
\o

select expect('a franchise named after its manager reopens under the open name',
  (select franchise from managers where league_id = :'R2' and slot = 'BBB'), 'Open Team');

\echo ''
\echo '--- draft picks as property ---'

\set P  '99999999-0000-0000-0000-000000000016'
\set PA 'aaaa0000-0000-0000-0000-000000000030'
\set PB 'aaaa0000-0000-0000-0000-000000000031'
\set PC 'aaaa0000-0000-0000-0000-000000000032'

\o /dev/null
insert into leagues (id, name, season, inaugural_season, commissioner_slot, settings)
values (:'P', 'Dynasty', 2026, 2026, 'AAA',
        '{"rounds": 2, "rookieRounds": 3, "regularWeeks": 3, "starters": {"QB": 1}, "bench": 1}'::jsonb);

insert into auth.users (id) values (:'PA'), (:'PB'), (:'PC');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'P', 'AAA', 'Ada',  'Alpha',   true,  :'PA'),
  (:'P', 'BBB', 'Bo',   'Bravo',   false, :'PB'),
  (:'P', 'CCC', 'Cass', 'Charlie', false, :'PC');

select award_draft_picks(:'P', 2026);
select award_draft_picks(:'P');
select signin(:'PA');
\o

select expect('the inaugural draft uses the league''s own round count',
  (select count(*)::int from draft_pick_assets where league_id = :'P' and season = 2026), 6);

select expect('and next season is a rookie draft, which is shorter',
  (select count(*)::int from draft_pick_assets where league_id = :'P' and season = 2027), 9);

select expect('every franchise starts out holding its own',
  (select bool_and(manager_id = origin_manager) from draft_pick_assets
    where league_id = :'P'), true);

select expect('the inaugural draft is not currency',
  (select picks_are_tradeable(:'P', 2026)), false);

select expect('but next season is',
  (select picks_are_tradeable(:'P', 2027)), true);

-- ---------------------------------------------------------------------------
-- Order is the inverse of the record
-- ---------------------------------------------------------------------------
\o /dev/null
-- Charlie loses twice, Bravo splits, Alpha wins twice.
insert into matchups (league_id, week, home_manager, away_manager,
                      home_points, away_points, winner, is_tie, final)
select :'P', 1,
       (select id from managers where league_id = :'P' and slot = 'AAA'),
       (select id from managers where league_id = :'P' and slot = 'CCC'),
       120, 80,
       (select id from managers where league_id = :'P' and slot = 'AAA'), false, true;

insert into matchups (league_id, week, home_manager, away_manager,
                      home_points, away_points, winner, is_tie, final)
select :'P', 2,
       (select id from managers where league_id = :'P' and slot = 'AAA'),
       (select id from managers where league_id = :'P' and slot = 'BBB'),
       110, 90,
       (select id from managers where league_id = :'P' and slot = 'AAA'), false, true;

insert into matchups (league_id, week, home_manager, away_manager,
                      home_points, away_points, winner, is_tie, final)
select :'P', 3,
       (select id from managers where league_id = :'P' and slot = 'BBB'),
       (select id from managers where league_id = :'P' and slot = 'CCC'),
       100, 70,
       (select id from managers where league_id = :'P' and slot = 'BBB'), false, true;

select set_draft_pick_order(:'P', 2027);
\o

-- Charlie 0-2, Bravo 1-1, Alpha 2-0. The worst record picks first.
select expect('the worst record picks first, the best last',
  (select string_agg(m.slot, ' ' order by a.slot)
     from draft_pick_assets a join managers m on m.id = a.origin_manager
    where a.league_id = :'P' and a.season = 2027 and a.round = 1), 'CCC BBB AAA');

select expect('and every round is in that same order',
  (select bool_and(same) from (
     select count(distinct ord) = 1 as same from (
       select a.round, string_agg(m.slot, ' ' order by a.slot) as ord
         from draft_pick_assets a join managers m on m.id = a.origin_manager
        where a.league_id = :'P' and a.season = 2027
        group by a.round
     ) rounds
   ) x), true);

-- Points break a tie between identical records: 100 points scored is a worse
-- season than 120, and gets the earlier pick.
\o /dev/null
update matchups set final = false where league_id = :'P';
select set_draft_pick_order(:'P', 2027);
\o

select expect('with nothing graded the order is stable rather than random',
  (select string_agg(m.slot, ' ' order by a.slot)
     from draft_pick_assets a join managers m on m.id = a.origin_manager
    where a.league_id = :'P' and a.season = 2027 and a.round = 1), 'AAA BBB CCC');

\o /dev/null
update matchups set final = true where league_id = :'P';
select set_draft_pick_order(:'P', 2027);
\o

-- ---------------------------------------------------------------------------
-- Trading them
-- ---------------------------------------------------------------------------
\set PICK '(select id from draft_pick_assets a join managers m on m.id = a.origin_manager where a.league_id = :''P'' and a.season = 2027 and a.round = 1 and m.slot = ''CCC'')'

\o /dev/null
-- Charlie sends their first-rounder to Alpha for nothing, which is Charlie's
-- business. Both accept, Alpha executes.
insert into trades (id, league_id, from_manager, to_manager, offer,
                    status, from_accepted, to_accepted)
select 'dddd0000-0000-0000-0000-000000000001', :'P',
       (select id from managers where league_id = :'P' and slot = 'CCC'),
       (select id from managers where league_id = :'P' and slot = 'AAA'),
       jsonb_build_object('give', '[]'::jsonb, 'get', '[]'::jsonb,
         'givePicks', jsonb_build_array(
           (select a.id from draft_pick_assets a join managers m on m.id = a.origin_manager
             where a.league_id = :'P' and a.season = 2027 and a.round = 1 and m.slot = 'CCC')),
         'getPicks', '[]'::jsonb),
       'agreed', true, true;

select execute_trade('dddd0000-0000-0000-0000-000000000001');
\o

select expect('a traded pick changes hands',
  (select m.slot from draft_pick_assets a join managers m on m.id = a.manager_id
     where a.league_id = :'P' and a.season = 2027 and a.round = 1
       and a.origin_manager = (select id from managers where league_id = :'P' and slot = 'CCC')),
  'AAA');

select expect('but it is still Charlie''s pick, so it still falls first',
  (select a.slot from draft_pick_assets a
     where a.league_id = :'P' and a.season = 2027 and a.round = 1
       and a.origin_manager = (select id from managers where league_id = :'P' and slot = 'CCC')),
  1);

select expect('Alpha now holds two first-rounders',
  (select count(*)::int from draft_pick_assets a
     where a.league_id = :'P' and a.season = 2027 and a.round = 1
       and a.manager_id = (select id from managers where league_id = :'P' and slot = 'AAA')), 2);

-- Trading the same pick twice is refused: Charlie no longer holds it.
\o /dev/null
insert into trades (id, league_id, from_manager, to_manager, offer,
                    status, from_accepted, to_accepted)
select 'dddd0000-0000-0000-0000-000000000002', :'P',
       (select id from managers where league_id = :'P' and slot = 'CCC'),
       (select id from managers where league_id = :'P' and slot = 'BBB'),
       jsonb_build_object('give', '[]'::jsonb, 'get', '[]'::jsonb,
         'givePicks', jsonb_build_array(
           (select a.id from draft_pick_assets a join managers m on m.id = a.origin_manager
             where a.league_id = :'P' and a.season = 2027 and a.round = 1 and m.slot = 'CCC')),
         'getPicks', '[]'::jsonb),
       'agreed', true, true;
select signin(:'PC');
\o

select expect('a pick already traded away cannot be traded again',
  refuses('select execute_trade(''dddd0000-0000-0000-0000-000000000002'')'),
  'A pick in this offer is no longer held by the proposing franchise');

-- The inaugural draft is not for sale.
\o /dev/null
insert into trades (id, league_id, from_manager, to_manager, offer,
                    status, from_accepted, to_accepted)
select 'dddd0000-0000-0000-0000-000000000003', :'P',
       (select id from managers where league_id = :'P' and slot = 'CCC'),
       (select id from managers where league_id = :'P' and slot = 'BBB'),
       jsonb_build_object('give', '[]'::jsonb, 'get', '[]'::jsonb,
         'givePicks', jsonb_build_array(
           (select a.id from draft_pick_assets a join managers m on m.id = a.origin_manager
             where a.league_id = :'P' and a.season = 2026 and a.round = 1 and m.slot = 'CCC')),
         'getPicks', '[]'::jsonb),
       'agreed', true, true;
\o

select expect('an inaugural pick cannot be traded even once both sides agree',
  refuses('select execute_trade(''dddd0000-0000-0000-0000-000000000003'')'),
  'Picks for the 2026 draft cannot be traded');

select expect('and it stays where it was',
  (select m.slot from draft_pick_assets a join managers m on m.id = a.manager_id
     where a.league_id = :'P' and a.season = 2026 and a.round = 1
       and a.origin_manager = (select id from managers where league_id = :'P' and slot = 'CCC')),
  'CCC');

-- ---------------------------------------------------------------------------
-- The nightly run must not undo a trade
-- ---------------------------------------------------------------------------
\o /dev/null
select signin(:'PA');
select award_draft_picks(:'P');
\o

select expect('running the award again creates nothing',
  (select count(*)::int from draft_pick_assets where league_id = :'P' and season = 2027), 9);

select expect('and does not hand a traded pick back',
  (select m.slot from draft_pick_assets a join managers m on m.id = a.manager_id
     where a.league_id = :'P' and a.season = 2027 and a.round = 1
       and a.origin_manager = (select id from managers where league_id = :'P' and slot = 'CCC')),
  'AAA');

select expect('every pick in the league is accounted for',
  (select string_agg(season || ':' || n, ' ' order by season) from (
     select season, count(*) n from draft_pick_assets where league_id = :'P' group by season
   ) d), '2026:6 2027:9');
