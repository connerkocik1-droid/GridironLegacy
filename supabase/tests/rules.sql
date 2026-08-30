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

select expect('a claimed franchise cannot be removed',
  refuses(format('select set_team_count(%L, 4)', :'L')),
  'These franchises are claimed or hold players: Franchise 5');

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

select expect('every week is fully paired',
  (select count(*)::int from matchups where league_id = :'S'), 6);

select expect('two games a week for four teams',
  (select count(distinct week)::int from matchups where league_id = :'S'), 3);

-- Nobody may play twice in one week, and nobody may play themselves.
select expect('nobody appears twice in a week',
  (select count(*)::int from (
     select week, m from matchups, lateral (values (home_manager), (away_manager)) v(m)
      where league_id = :'S'
      group by week, m having count(*) > 1
   ) dupes), 0);

select expect('nobody plays themselves',
  (select count(*)::int from matchups
    where league_id = :'S' and home_manager = away_manager), 0);

select expect('a round robin meets everyone once',
  (select count(*)::int from (
     select least(home_manager::text, away_manager::text) a,
            greatest(home_manager::text, away_manager::text) b
       from matchups where league_id = :'S'
      group by 1, 2 having count(*) > 1
   ) repeats), 0);

-- An odd league gives someone a bye each week rather than a broken pairing.
\o /dev/null
insert into managers (league_id, slot, name, franchise) values (:'S', 'EEE', 'E', 'Echo');
select generate_schedule(:'S');
\o

select expect('an odd league still pairs cleanly',
  (select count(*)::int from matchups where league_id = :'S' and home_manager = away_manager), 0);

select expect('and gives two games a week, not two and a half',
  (select bool_and(n = 2) from (
     select week, count(*) n from matchups where league_id = :'S' group by week
   ) per_week), true);

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
