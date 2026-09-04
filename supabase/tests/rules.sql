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
\echo '--- the waiver wire ---'

\o /dev/null
\set X '99999999-0000-0000-0000-000000000018'
\set X1 'eeee9000-0000-0000-0000-000000000001'
\set X2 'eeee9000-0000-0000-0000-000000000002'
\set X3 'eeee9000-0000-0000-0000-000000000003'

-- Capacity 3 again: 2 starters and a bench spot.
insert into leagues (id, name, season, commissioner_slot, settings)
values (:'X', 'Wire', 2026, 'AAA',
        '{"starters": {"QB": 1, "RB": 1}, "bench": 1, "rounds": 1}'::jsonb);

insert into auth.users (id) values (:'X1'), (:'X2'), (:'X3');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id, waiver_priority) values
  (:'X', 'AAA', 'A', 'Alpha',   true,  :'X1', 1),
  (:'X', 'BBB', 'B', 'Bravo',   false, :'X2', 2),
  (:'X', 'CCC', 'C', 'Charlie', false, :'X3', 3);

select signin(:'X2');
\o

select expect('a player nobody dropped is a free agent, added on the spot',
  (select (add_player(:'X', 'Wire Guy') ->> 'ok')::boolean), true);

select expect('dropping him reports when he clears',
  (select (drop_player(:'X', 'Wire Guy') ->> 'clearsAt') is not null), true);

select expect('and he is on the wire, not back on the shelf',
  on_waivers(:'X', 'Wire Guy'), true);

select expect('with a clearing time in the future',
  (select clears_at > now() from waiver_wire where league_id = :'X' and player_name = 'Wire Guy'),
  true);

select expect('he has left the roster all the same',
  (select count(*)::int from roster_slots where league_id = :'X' and player_name = 'Wire Guy'), 0);

\o /dev/null
select signin(:'X3');
\o

select expect('nobody can simply take a player off the wire',
  refuses(format('select add_player(%L, %L)', :'X', 'Wire Guy')) like '%on waivers%', true);

select expect('so he is still nobody''s',
  (select count(*)::int from roster_slots where league_id = :'X' and player_name = 'Wire Guy'), 0);

-- Alpha and Charlie both want him. Alpha has the better priority.
\o /dev/null
insert into waiver_claims (league_id, manager_id, add_player) values
  (:'X', (select id from managers where league_id = :'X' and slot = 'AAA'), 'Wire Guy'),
  (:'X', (select id from managers where league_id = :'X' and slot = 'CCC'), 'Wire Guy');
select process_waivers(:'X');
\o

select expect('a run before his time is up settles nothing',
  (select count(*)::int from waiver_claims
    where league_id = :'X' and add_player = 'Wire Guy' and status = 'pending'), 2);

select expect('and does not release him either',
  on_waivers(:'X', 'Wire Guy'), true);

-- His waiver period elapses.
\o /dev/null
update waiver_wire set clears_at = now() - interval '1 minute'
 where league_id = :'X' and player_name = 'Wire Guy';
select process_waivers(:'X');
\o

select expect('the next run gives him to the best priority',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'X' and r.player_name = 'Wire Guy'), 'AAA');

select expect('the other claim is told why it lost',
  (select count(*)::int from waiver_claims
    where league_id = :'X' and add_player = 'Wire Guy'
      and status = 'lost' and reason like '%already rostered%'), 1);

select expect('a player who has been won is off the wire',
  on_waivers(:'X', 'Wire Guy'), false);

select expect('and winning still sends you to the back',
  (select string_agg(slot, ',' order by waiver_priority) from managers where league_id = :'X'),
  'BBB,CCC,AAA');

-- Nobody wants him the second time.
\o /dev/null
select signin(:'X1');
select drop_player(:'X', 'Wire Guy');
select process_waivers(:'X');
\o

select expect('an unclaimed player is not released early',
  on_waivers(:'X', 'Wire Guy'), true);

\o /dev/null
update waiver_wire set clears_at = now() - interval '1 minute'
 where league_id = :'X' and player_name = 'Wire Guy';
select process_waivers(:'X');
\o

select expect('but the run past his time lets him go',
  on_waivers(:'X', 'Wire Guy'), false);

\o /dev/null
select signin(:'X3');
\o

select expect('and then anybody may have him',
  (select (add_player(:'X', 'Wire Guy') ->> 'ok')::boolean), true);

-- Charlie fills up, then claims somebody while dropping to make room. The
-- player he drops must not be handed to the league in the same run.
\o /dev/null
select add_player(:'X', 'Spare One');
select add_player(:'X', 'Spare Two');
insert into waiver_claims (league_id, manager_id, add_player, drop_player) values
  (:'X', (select id from managers where league_id = :'X' and slot = 'CCC'), 'Fresh Face', 'Spare One');
select process_waivers(:'X');
\o

select expect('a claim on a free agent is settled by the same run',
  (select count(*)::int from roster_slots
    where league_id = :'X' and player_name = 'Fresh Face'), 1);

select expect('the player dropped to make room goes on the wire',
  on_waivers(:'X', 'Spare One'), true);

select expect('and the run that put him there does not also release him',
  (select clears_at > now() from waiver_wire where league_id = :'X' and player_name = 'Spare One'),
  true);

-- Re-dropping restarts the clock rather than failing.
\o /dev/null
select signin(:'X2');
select add_player(:'X', 'Boomerang');
select drop_player(:'X', 'Boomerang');
update waiver_wire set clears_at = now() - interval '1 minute'
 where league_id = :'X' and player_name = 'Boomerang';
select process_waivers(:'X');
select add_player(:'X', 'Boomerang');
select drop_player(:'X', 'Boomerang');
\o

select expect('a player dropped twice starts his period over',
  (select clears_at > now() from waiver_wire where league_id = :'X' and player_name = 'Boomerang'),
  true);

-- An open league has no wire at all.
\o /dev/null
update leagues set settings = settings || '{"waiverMode": "open"}'::jsonb where id = :'X';
select add_player(:'X', 'Open Season');
select drop_player(:'X', 'Open Season');
\o

select expect('an open league drops straight back to free agency',
  on_waivers(:'X', 'Open Season'), false);

select expect('so the next manager may take him at once',
  (select (add_player(:'X', 'Open Season') ->> 'ok')::boolean), true);

-- A league that runs everything through waivers has no open market.
\o /dev/null
update leagues set settings = settings || '{"waiverMode": "all"}'::jsonb where id = :'X';
\o

select expect('a claims-only league refuses an open-market add',
  refuses(format('select add_player(%L, %L)', :'X', 'Anybody At All'))
    like '%goes through waivers%', true);

\o /dev/null
update leagues set settings = settings || '{"waiverMode": "waivers"}'::jsonb where id = :'X';
select signin(:'X1');
select reset_draft(:'X');
\o

select expect('resetting the draft clears the wire with the rosters',
  (select count(*)::int from waiver_wire where league_id = :'X'), 0);

select expect('the waiver period is floored at a day',
  waiver_days(:'X'), 1);

\o /dev/null
update leagues set settings = settings || '{"waiverDays": 3}'::jsonb where id = :'X';
\o

select expect('but a league may make it longer', waiver_days(:'X'), 3);

\echo ''
\echo '--- the trade deadline, and the record a trade leaves ---'

\o /dev/null
\set D  '99999999-0000-0000-0000-000000000019'
\set D1 'ddd90000-0000-0000-0000-000000000001'
\set D2 'ddd90000-0000-0000-0000-000000000002'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'D', 'Deadline', 2026, 'AAA',
        '{"starters": {"QB": 1}, "bench": 4, "regularWeeks": 13, "rounds": 1}'::jsonb);

insert into auth.users (id) values (:'D1'), (:'D2');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'D', 'AAA', 'A', 'Alpha', true,  :'D1'),
  (:'D', 'BBB', 'B', 'Bravo', false, :'D2');

insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
  select :'D', id, 'Alpha Star', 'BENCH' from managers where league_id = :'D' and slot = 'AAA';
insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
  select :'D', id, 'Bravo Star', 'BENCH' from managers where league_id = :'D' and slot = 'BBB';

-- A season played up to week four.
insert into matchups (league_id, week, home_manager, away_manager, final)
select :'D', w,
       (select id from managers where league_id = :'D' and slot = 'AAA'),
       (select id from managers where league_id = :'D' and slot = 'BBB'),
       w < 4
  from generate_series(1, 13) w;
\o

select expect('the week is the first one still to be played', current_week(:'D'), 4);

select expect('the deadline defaults to two weeks short of the end',
  trade_deadline_week(:'D'), 11);

-- A straight swap, both sides agreed, comfortably inside the deadline.
\o /dev/null
insert into trades (id, league_id, from_manager, to_manager, offer,
                    status, from_accepted, to_accepted)
select 'ddd90000-0000-0000-0000-0000000000a1', :'D',
       (select id from managers where league_id = :'D' and slot = 'AAA'),
       (select id from managers where league_id = :'D' and slot = 'BBB'),
       '{"give": ["Alpha Star"], "get": ["Bravo Star"]}'::jsonb, 'agreed', true, true;
select signin(:'D1');
select execute_trade('ddd90000-0000-0000-0000-0000000000a1');
\o

select expect('a trade inside the deadline goes through',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'D' and r.player_name = 'Alpha Star'), 'BBB');

select expect('and both players are written into the record',
  (select count(*)::int from transactions
    where league_id = :'D' and kind = 'trade'), 2);

select expect('filed under whoever received each one',
  (select m.slot from transactions t join managers m on m.id = t.manager_id
    where t.league_id = :'D' and t.player_name = 'Alpha Star'), 'BBB');

select expect('naming the franchise he came from, in words',
  (select detail ->> 'fromFranchise' from transactions
    where league_id = :'D' and player_name = 'Alpha Star'), 'Alpha');

-- The season runs on past the deadline.
\o /dev/null
update matchups set final = true where league_id = :'D' and week <= 12;
\o

select expect('the week moves on with the season', current_week(:'D'), 13);

select expect('an offer past the deadline is refused when it is made',
  refuses(format($f$insert into trades (league_id, from_manager, to_manager, offer, status)
                    select %L,
                      (select id from managers where league_id = %L and slot = 'AAA'),
                      (select id from managers where league_id = %L and slot = 'BBB'),
                      '{"give": [], "get": ["Alpha Star"]}'::jsonb, 'open'$f$,
                 :'D', :'D', :'D')),
  null);

\o /dev/null
-- Written with the service key, which is past the trigger on purpose: this is
-- an offer made in week three that nobody answered until week thirteen.
insert into trades (id, league_id, from_manager, to_manager, offer,
                    status, from_accepted, to_accepted)
select 'ddd90000-0000-0000-0000-0000000000a2', :'D',
       (select id from managers where league_id = :'D' and slot = 'BBB'),
       (select id from managers where league_id = :'D' and slot = 'AAA'),
       '{"give": ["Alpha Star"], "get": []}'::jsonb, 'agreed', true, true;
\o

select expect('a stale offer accepted past the deadline is refused too',
  refuses($x$select execute_trade('ddd90000-0000-0000-0000-0000000000a2')$x$)
    like '%deadline passed in week 11%', true);

select expect('and the player did not move',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'D' and r.player_name = 'Alpha Star'), 'BBB');

-- A league that wants no deadline says so.
\o /dev/null
update leagues set settings = settings || '{"tradeDeadlineWeek": 0}'::jsonb where id = :'D';
\o

select expect('a league may turn the deadline off', trade_deadline_week(:'D'), 0);

select expect('and then a trade in the last week goes through',
  (select (execute_trade('ddd90000-0000-0000-0000-0000000000a2') ->> 'ok')::boolean), true);

select expect('the record shows the player coming back',
  (select count(*)::int from transactions
    where league_id = :'D' and kind = 'trade' and player_name = 'Alpha Star'), 2);

\echo ''
\echo '--- the playoffs ---'

\o /dev/null
\set Y  '99999999-0000-0000-0000-000000000020'
\set Y1 'aa209000-0000-0000-0000-000000000001'

-- Eight franchises, two divisions, a six-team field: two miss out, two get a
-- first-round bye, and the bracket reseeds twice.
insert into leagues (id, name, season, commissioner_slot, settings)
values (:'Y', 'Postseason', 2026, 'AAA',
        '{"starters": {"QB": 1}, "bench": 4, "rounds": 1, "playoffTeams": 6,
          "tradeDeadlineWeek": 0}'::jsonb);

insert into auth.users (id) values (:'Y1');

insert into managers (league_id, slot, name, franchise, division, is_commissioner, auth_user_id)
values
  (:'Y', 'AAA', 'A', 'Alpha',   'East', true,  :'Y1'),
  (:'Y', 'BBB', 'B', 'Bravo',   'East', false, null),
  (:'Y', 'CCC', 'C', 'Charlie', 'East', false, null),
  (:'Y', 'DDD', 'D', 'Delta',   'East', false, null),
  (:'Y', 'EEE', 'E', 'Echo',    'West', false, null),
  (:'Y', 'FFF', 'F', 'Foxtrot', 'West', false, null),
  (:'Y', 'GGG', 'G', 'Golf',    'West', false, null),
  (:'Y', 'HHH', 'H', 'Hotel',   'West', false, null);

-- A regular season written straight down: four graded weeks whose only job is
-- to produce a table with no ties in it anywhere.
--   Alpha 4-0/500  Echo 4-0/460  Bravo 3-1/440  Foxtrot 3-1/420
--   Charlie 2-2/400  Golf 2-2/380  Delta 1-3/300  Hotel 0-4/200
-- One row per franchise per week, which is all standings() reads. A loss has
-- to name somebody else as the winner or it is not counted as a loss, and the
-- franchise named picks up nothing from a row it is not a side in — so p_beat
-- is a bookkeeping device, not a fixture.
create or replace function seed_record(p_slot text, p_wins int, p_pf numeric, p_beat text)
returns void language plpgsql as $fn$
declare v_id uuid; v_other uuid; v_w int;
begin
  select id into v_id from managers
   where league_id = '99999999-0000-0000-0000-000000000020' and slot = p_slot;
  select id into v_other from managers
   where league_id = '99999999-0000-0000-0000-000000000020' and slot = p_beat;
  for v_w in 1..4 loop
    insert into matchups (league_id, week, home_manager, home_points, away_points,
                          winner, is_tie, final)
    values ('99999999-0000-0000-0000-000000000020', v_w, v_id, p_pf / 4, 0,
            case when v_w <= p_wins then v_id else v_other end,
            false, true);
  end loop;
end;
$fn$;

select seed_record('AAA', 4, 500, 'HHH');
select seed_record('EEE', 4, 460, 'HHH');
select seed_record('BBB', 3, 440, 'HHH');
select seed_record('FFF', 3, 420, 'HHH');
select seed_record('CCC', 2, 400, 'HHH');
select seed_record('GGG', 2, 380, 'HHH');
select seed_record('DDD', 1, 300, 'HHH');
select seed_record('HHH', 0, 200, 'AAA');
\o

select expect('a six-team field takes three weekends', playoff_rounds(6), 3);
select expect('a four-team field takes two', playoff_rounds(4), 2);
select expect('and eight still takes three', playoff_rounds(8), 3);

select expect('the regular season is as long as its fixtures',
  regular_season_weeks(:'Y'), 4);

select expect('the division winners take the top seeds, best record first',
  (select string_agg(m.slot, ' ' order by s.seed)
     from seeding(:'Y') s join managers m on m.id = s.manager_id
    where s.seed <= 2), 'AAA EEE');

select expect('then the best of the rest, whatever division they came from',
  (select string_agg(m.slot, ' ' order by s.seed)
     from seeding(:'Y') s join managers m on m.id = s.manager_id), 
  'AAA EEE BBB FFF CCC GGG DDD HHH');

-- Nothing has started yet.
select expect('the bracket refuses to be drawn twice by accident',
  (select (start_playoffs(:'Y') ->> 'games')::int), 2);

select expect('a second call changes nothing',
  (select (start_playoffs(:'Y') ->> 'already')::boolean), true);

select expect('only the field is seeded',
  (select count(*)::int from playoff_seeds where league_id = :'Y'), 6);

select expect('and the postseason length follows the field',
  (select (settings ->> 'playoffWeeks')::int from leagues where id = :'Y'), 3);

select expect('the top two seeds sit the first round out',
  (select count(*)::int from matchups m
     join managers h on h.id = m.home_manager
    where m.league_id = :'Y' and m.playoff_round = 1
      and h.slot in ('AAA', 'EEE')), 0);

select expect('the rest pair off from the outside in',
  (select string_agg(h.slot || 'v' || a.slot, ' ' order by h.slot)
     from matchups m
     join managers h on h.id = m.home_manager
     join managers a on a.id = m.away_manager
    where m.league_id = :'Y' and m.playoff_round = 1), 'BBBvGGG FFFvCCC');

select expect('in the week after the regular season',
  (select distinct week from matchups where league_id = :'Y' and playoff_round = 1), 5);

-- Round one: Bravo wins, and Charlie knocks out the better-seeded Foxtrot.
\o /dev/null
update matchups set final = true, home_points = 100, away_points = 90,
       winner = home_manager
 where league_id = :'Y' and playoff_round = 1
   and home_manager = (select id from managers where league_id = :'Y' and slot = 'BBB');
update matchups set final = true, home_points = 80, away_points = 95,
       winner = away_manager
 where league_id = :'Y' and playoff_round = 1
   and home_manager = (select id from managers where league_id = :'Y' and slot = 'FFF');
select advance_playoffs(:'Y');
\o

select expect('a bye is not a defeat — both top seeds are still in',
  (select string_agg(m.slot, ' ' order by s.seed)
     from playoff_survivors(:'Y', 2026) s join managers m on m.id = s.manager_id),
  'AAA EEE BBB CCC');

select expect('the second round reseeds: best left against worst left',
  (select string_agg(h.slot || 'v' || a.slot, ' ' order by h.slot)
     from matchups m
     join managers h on h.id = m.home_manager
     join managers a on a.id = m.away_manager
    where m.league_id = :'Y' and m.playoff_round = 2), 'AAAvCCC EEEvBBB');

-- Round two: Charlie keeps going, Echo sees off Bravo.
\o /dev/null
update matchups set final = true, home_points = 70, away_points = 99,
       winner = away_manager
 where league_id = :'Y' and playoff_round = 2
   and home_manager = (select id from managers where league_id = :'Y' and slot = 'AAA');
update matchups set final = true, home_points = 105, away_points = 88,
       winner = home_manager
 where league_id = :'Y' and playoff_round = 2
   and home_manager = (select id from managers where league_id = :'Y' and slot = 'EEE');
select advance_playoffs(:'Y');
\o

select expect('the final is the two left standing',
  (select h.slot || 'v' || a.slot
     from matchups m
     join managers h on h.id = m.home_manager
     join managers a on a.id = m.away_manager
    where m.league_id = :'Y' and m.playoff_round = 3), 'EEEvCCC');

select expect('and it is the last week the bracket needs',
  (select distinct week from matchups where league_id = :'Y' and playoff_round = 3), 7);

select expect('a round still being played is left alone',
  (select advance_playoffs(:'Y') ->> 'state'), 'playing');

select expect('and nobody is crowned in the meantime',
  (select count(*)::int from league_champions where league_id = :'Y'), 0);

-- The final, decided on a draw: the better seed goes through.
\o /dev/null
update matchups set final = true, home_points = 100, away_points = 100,
       winner = null, is_tie = true
 where league_id = :'Y' and playoff_round = 3;
select advance_playoffs(:'Y');
\o

select expect('a drawn final is won by the better seed',
  (select m.slot from league_champions c join managers m on m.id = c.manager_id
    where c.league_id = :'Y'), 'EEE');

select expect('and the title is filed against the season',
  (select season from league_champions where league_id = :'Y'), 2026);

select expect('the franchise name is kept with it',
  (select franchise from league_champions where league_id = :'Y'), 'Echo');

select expect('a decided season stays decided',
  (select advance_playoffs(:'Y') ->> 'state'), 'decided');

-- Next year's board.
\o /dev/null
select award_draft_picks(:'Y', 2027);
\o

select expect('the teams that missed pick first, worst record first',
  (select string_agg(m.slot, ' ' order by a.slot)
     from draft_pick_assets a join managers m on m.id = a.origin_manager
    where a.league_id = :'Y' and a.season = 2027 and a.round = 1 and a.slot <= 2),
  'HHH DDD');

select expect('then the playoff teams in the order they went out, champion last',
  (select string_agg(m.slot, ' ' order by a.slot)
     from draft_pick_assets a join managers m on m.id = a.origin_manager
    where a.league_id = :'Y' and a.season = 2027 and a.round = 1),
  'HHH DDD GGG FFF BBB AAA CCC EEE');

\o /dev/null
drop function seed_record(text, int, numeric, text);
\o

\echo ''
\echo '--- rolling into next season ---'

-- Reuses the postseason league, which has a played season and a champion.
\o /dev/null
select signin(:'Y1');

-- Give it the things a rollover has to keep and the things it has to clear.
insert into roster_slots (league_id, manager_id, player_name, acquired, lineup_slot, overall_pick)
select :'Y', id, 'Kept ' || slot, 'draft', 'QB', 3 from managers where league_id = :'Y';
insert into roster_slots (league_id, manager_id, player_name, acquired, lineup_slot)
select :'Y', id, 'Hurt ' || slot, 'add', 'IR' from managers where league_id = :'Y';
insert into trade_block (league_id, manager_id, player_name)
select :'Y', id, 'Kept AAA' from managers where league_id = :'Y' and slot = 'AAA';
-- A move made last season, on a player who is still on the roster. In a
-- dynasty the answer to "where did he come from" may be years old.
insert into transactions (league_id, manager_id, kind, player_name)
select :'Y', id, 'add', 'Kept AAA' from managers where league_id = :'Y' and slot = 'AAA';
insert into waiver_claims (league_id, manager_id, add_player)
select :'Y', id, 'Somebody' from managers where league_id = :'Y' and slot = 'BBB';
insert into trades (id, league_id, from_manager, to_manager, offer, status)
select 'aa209000-0000-0000-0000-0000000000f1', :'Y',
       (select id from managers where league_id = :'Y' and slot = 'AAA'),
       (select id from managers where league_id = :'Y' and slot = 'BBB'),
       '{"give": ["Kept AAA"], "get": []}'::jsonb, 'open';
\o

select expect('a manager cannot start the next season',
  (select signin(:'Y1')) is null and
  (select count(*)::int from managers where league_id = :'Y' and slot = 'BBB') = 1, true);

\o /dev/null
-- Bravo is not the commissioner; sign in as them via their own auth row.
insert into auth.users (id) values ('aa209000-0000-0000-0000-0000000000b2');
update managers set auth_user_id = 'aa209000-0000-0000-0000-0000000000b2'
 where league_id = :'Y' and slot = 'BBB';
select signin('aa209000-0000-0000-0000-0000000000b2');
\o

select expect('only the commissioner may roll the season',
  refuses(format('select roll_season(%L)', :'Y')) like '%Only the commissioner%', true);

\o /dev/null
select signin(:'Y1');
\o

select expect('and it cannot go backwards',
  refuses(format('select roll_season(%L, 2025)', :'Y')) like '%must come after 2026%', true);

-- Now do it.
select expect('the rollover names the champion it is closing the book on',
  (select roll_season(:'Y') ->> 'champion'), 'Echo');

select expect('the league is in the new season',
  (select season from leagues where id = :'Y'), 2027);

select expect('every roster is kept, to the player',
  (select count(*)::int from roster_slots where league_id = :'Y'), 16);

select expect('but nobody starts where they finished',
  (select count(*)::int from roster_slots
    where league_id = :'Y' and lineup_slot <> 'BENCH'), 0);

select expect('and last year''s draft position is not carried into this one',
  (select count(*)::int from roster_slots
    where league_id = :'Y' and overall_pick is not null), 0);

select expect('the schedule is gone',
  (select count(*)::int from matchups where league_id = :'Y'), 0);

select expect('so is the bracket that decided it',
  (select count(*)::int from playoff_seeds where league_id = :'Y' and season = 2026), 0);

select expect('but the title is not — that is what a dynasty is for',
  (select franchise from league_champions where league_id = :'Y' and season = 2026), 'Echo');

select expect('live claims and the wire are cleared',
  (select count(*)::int from waiver_claims where league_id = :'Y')
  + (select count(*)::int from waiver_wire where league_id = :'Y'), 0);

select expect('the trade block is cleared',
  (select count(*)::int from trade_block where league_id = :'Y'), 0);

select expect('an open offer is declined rather than deleted',
  (select status from trades where id = 'aa209000-0000-0000-0000-0000000000f1'), 'declined');

select expect('waiver order goes back to the league''s own order',
  (select string_agg(slot, ' ' order by waiver_priority) from managers where league_id = :'Y'),
  'AAA BBB CCC DDD EEE FFF GGG HHH');

select expect('and nobody is still ready from last year',
  (select bool_or(ready) from managers where league_id = :'Y'), false);

select expect('the transaction log survives — a dynasty roster has a history',
  (select count(*)::int from transactions
    where league_id = :'Y' and player_name = 'Kept AAA'), 1);

-- The draft that was already being traded for.
select expect('the picks awarded a year ago are the picks for this draft',
  (select count(*)::int from draft_pick_assets where league_id = :'Y' and season = 2027), 40);

select expect('and the board is rebuilt for them',
  (select count(*)::int > 0 from draft_picks where league_id = :'Y'), true);

select expect('with the room closed until the commissioner opens it',
  (select draft_state from leagues where id = :'Y'), 'pending');

select expect('the new season''s picks are tradeable, the inaugural ones never were',
  (select picks_are_tradeable(:'Y', 2027) and not picks_are_tradeable(:'Y', 2026)), true);

select expect('a season with no champion yet cannot be rolled',
  refuses(format('select roll_season(%L)', :'Y')) like '%no champion yet%', true);

\echo ''
\echo '--- the commissioner fixing a roster ---'

\o /dev/null
\set M  '99999999-0000-0000-0000-000000000021'
\set M1 'aa219000-0000-0000-0000-000000000001'
\set M2 'aa219000-0000-0000-0000-000000000002'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'M', 'Fixes', 2026, 'AAA',
        '{"starters": {"QB": 1}, "bench": 1, "rounds": 1}'::jsonb);

insert into auth.users (id) values (:'M1'), (:'M2');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'M', 'AAA', 'A', 'Alpha', true,  :'M1'),
  (:'M', 'BBB', 'B', 'Bravo', false, :'M2');

insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
  select :'M', id, 'Wrong Roster', 'QB' from managers where league_id = :'M' and slot = 'BBB';
\o

select expect('a plain manager cannot move anybody',
  (select signin(:'M2')) is null and
  refuses(format('select commissioner_move_player(%L, %L, (select id from managers where league_id = %L and slot = ''BBB''))',
                 :'M', 'Wrong Roster', :'M')) like '%Only the commissioner%', true);

select expect('so the player has not moved',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'M' and r.player_name = 'Wrong Roster'), 'BBB');

\o /dev/null
select signin(:'M1');
\o

select expect('the commissioner moves him to the right franchise',
  (select commissioner_move_player(:'M', 'Wrong Roster',
     (select id from managers where league_id = :'M' and slot = 'AAA'),
     'autodrafted to the wrong team') ->> 'to'), 'Alpha');

select expect('and he is there',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'M' and r.player_name = 'Wrong Roster'), 'AAA');

select expect('landing on the bench rather than in a slot that meant something else',
  (select lineup_slot from roster_slots
    where league_id = :'M' and player_name = 'Wrong Roster'), 'BENCH');

select expect('the league can see it happened',
  (select detail ->> 'fromFranchise' from transactions
    where league_id = :'M' and player_name = 'Wrong Roster' and kind = 'trade'), 'Bravo');

select expect('and it is marked as the commissioner''s doing, with the reason',
  (select (detail ->> 'commissioner') || ' ' || (detail ->> 'reason') from transactions
    where league_id = :'M' and player_name = 'Wrong Roster' and kind = 'trade'),
  'true autodrafted to the wrong team');

select expect('the office keeps its own record',
  (select count(*)::int from admin_log
    where league_id = :'M' and action = 'commissioner_move'), 1);

select expect('moving him where he already is is refused',
  refuses(format('select commissioner_move_player(%L, %L, (select id from managers where league_id = %L and slot = ''AAA''))',
                 :'M', 'Wrong Roster', :'M')) like '%already there%', true);

-- Capacity is 1 starter + 1 bench = 2. Alpha holds one; fill the other.
\o /dev/null
insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
  select :'M', id, 'Alpha Filler', 'BENCH' from managers where league_id = :'M' and slot = 'AAA';
insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
  select :'M', id, 'Bravo Spare', 'BENCH' from managers where league_id = :'M' and slot = 'BBB';
\o

select expect('a correction cannot push a roster past its capacity',
  refuses(format('select commissioner_move_player(%L, %L, (select id from managers where league_id = %L and slot = ''AAA''))',
                 :'M', 'Bravo Spare', :'M')) like '%is full at 2%', true);

select expect('and the player stays where he was',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'M' and r.player_name = 'Bravo Spare'), 'BBB');

-- Releasing.
select expect('releasing him sends him to waivers, not to whoever is watching',
  (select (commissioner_move_player(:'M', 'Alpha Filler', null, 'roster correction')
             ->> 'clearsAt') is not null), true);

select expect('he is off the roster',
  (select count(*)::int from roster_slots
    where league_id = :'M' and player_name = 'Alpha Filler'), 0);

select expect('and on the wire', on_waivers(:'M', 'Alpha Filler'), true);

select expect('releasing somebody nobody holds is refused',
  refuses(format('select commissioner_move_player(%L, %L, null)', :'M', 'Ghost'))
    like '%not on anybody%', true);

-- A free agent can be placed, which is the other half of an undo.
select expect('a free agent can be placed on a roster with room',
  (select commissioner_move_player(:'M', 'Alpha Filler',
     (select id from managers where league_id = :'M' and slot = 'AAA')) ->> 'from'),
  'free agency');

select expect('and placing him takes him off the wire',
  on_waivers(:'M', 'Alpha Filler'), false);

\echo ''
\echo '--- telling people things happened ---'

\o /dev/null
\set N  '99999999-0000-0000-0000-000000000022'
\set N1 'bb229000-0000-0000-0000-000000000001'
\set N2 'bb229000-0000-0000-0000-000000000002'
\set N3 'bb229000-0000-0000-0000-000000000003'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'N', 'Notices', 2026, 'AAA',
        '{"starters": {"QB": 1}, "bench": 4, "rounds": 1, "tradeDeadlineWeek": 0}'::jsonb);

insert into auth.users (id) values (:'N1'), (:'N2'), (:'N3');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id, waiver_priority)
values
  (:'N', 'AAA', 'A', 'Alpha', true,  :'N1', 1),
  (:'N', 'BBB', 'B', 'Bravo', false, :'N2', 2),
  (:'N', 'CCC', 'C', 'Charlie', false, :'N3', 3);

insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
  select :'N', id, 'Alpha Star', 'BENCH' from managers where league_id = :'N' and slot = 'AAA';
\o

-- A trade offer.
\o /dev/null
insert into trades (id, league_id, from_manager, to_manager, offer, status)
select 'bb290000-0000-0000-0000-0000000000a1', :'N',
       (select id from managers where league_id = :'N' and slot = 'AAA'),
       (select id from managers where league_id = :'N' and slot = 'BBB'),
       '{"give": ["Alpha Star"], "get": []}'::jsonb, 'open';
\o

select expect('an offer is news to the manager who received it',
  (select body from notices n join managers m on m.id = n.manager_id
    where n.league_id = :'N' and m.slot = 'BBB'), 'Alpha has offered you a trade.');

select expect('and not to the one who sent it',
  (select count(*)::int from notices n join managers m on m.id = n.manager_id
    where n.league_id = :'N' and m.slot = 'AAA'), 0);

select expect('it points at the page that answers it',
  (select href from notices where league_id = :'N'), '/trade-builder');

\o /dev/null
update trades set status = 'declined'
 where id = 'bb290000-0000-0000-0000-0000000000a1';
\o

select expect('a decline goes back to whoever offered',
  (select body from notices n join managers m on m.id = n.manager_id
    where n.league_id = :'N' and m.slot = 'AAA'), 'Bravo declined your offer.');

-- Losing a waiver claim is the thing nobody would otherwise find out about.
\o /dev/null
insert into waiver_claims (league_id, manager_id, add_player) values
  (:'N', (select id from managers where league_id = :'N' and slot = 'BBB'), 'Wanted Man'),
  (:'N', (select id from managers where league_id = :'N' and slot = 'CCC'), 'Wanted Man');
select process_waivers(:'N');
\o

select expect('winning a claim is announced',
  (select count(*)::int from notices n join managers m on m.id = n.manager_id
    where n.league_id = :'N' and m.slot = 'BBB' and n.body = 'You won Wanted Man on waivers.'), 1);

select expect('and so is losing one, with the reason the database recorded',
  (select count(*)::int from notices n join managers m on m.id = n.manager_id
    where n.league_id = :'N' and m.slot = 'CCC'
      and n.body like 'Your claim for Wanted Man did not go through:%already rostered%'), 1);

-- Being on the clock.
\o /dev/null
select signin(:'N1');
select rebuild_draft_board(:'N');
update leagues set draft_state = 'running', current_pick = 2 where id = :'N';
\o

select expect('the manager on the clock is told',
  (select count(*)::int from notices n
     join managers m on m.id = n.manager_id
    where n.league_id = :'N' and n.kind = 'draft' and n.body = 'You are on the clock.'
      and m.id = (select manager_id from draft_picks where league_id = :'N' and overall = 2)), 1);

\o /dev/null
update leagues set current_pick = 2 where id = :'N';
\o

select expect('and not told again for the same pick',
  (select count(*)::int from notices where league_id = :'N' and kind = 'draft'), 1);

\o /dev/null
update leagues set draft_state = 'paused', current_pick = 3 where id = :'N';
\o

select expect('a paused draft puts nobody on the clock',
  (select count(*)::int from notices where league_id = :'N' and kind = 'draft'), 1);

-- Reading them.
-- Three for Bravo: the offer, the claim he won, and the clock — with no
-- lottery drawn the board runs in slot order, so Bravo holds the second pick.
select expect('everything starts unread',
  (select count(*)::int from notices
    where league_id = :'N' and read_at is null and manager_id =
      (select id from managers where league_id = :'N' and slot = 'BBB')), 3);

\o /dev/null
select signin(:'N2');
\o

select expect('marking them read reports how many there were', read_notices(:'N'), 3);

select expect('and they stay read',
  (select count(*)::int from notices
    where league_id = :'N' and read_at is null and manager_id =
      (select id from managers where league_id = :'N' and slot = 'BBB')), 0);

select expect('reading yours does not read anybody else''s',
  (select count(*)::int from notices n join managers m on m.id = n.manager_id
    where n.league_id = :'N' and m.slot = 'CCC' and n.read_at is null), 1);

select expect('a manager cannot read notices for a league they are not in',
  refuses(format('select read_notices(%L)', '99999999-0000-0000-0000-000000000001'))
    like '%Not your league%', true);

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

-- Both of Alpha's are quarterbacks and the league starts one. Under best ball
-- the higher score plays, so the one saved on the bench is the one who counts.
insert into roster_slots (league_id, manager_id, player_name, position, lineup_slot) values
  (:'G', (select id from managers where league_id = :'G' and slot = 'AAA'), 'Starter A', 'QB', 'QB'),
  (:'G', (select id from managers where league_id = :'G' and slot = 'AAA'), 'Bench A', 'QB', 'BENCH'),
  (:'G', (select id from managers where league_id = :'G' and slot = 'BBB'), 'Starter B', 'QB', 'QB');

insert into player_scores (league_id, week, player_name, points) values
  (:'G', 1, 'Starter A', 20), (:'G', 1, 'Bench A', 99), (:'G', 1, 'Starter B', 15);

-- Week 1 games are still being played.
insert into nfl_games (id, season, week, season_type, starts_at, home_team, away_team, state, completed)
values ('g1', 2026, 1, 2, now(), 'SEA', 'SF', 'in', false);

select grade_week(:'G', 1);
\o

-- The rule best ball replaces. It used to be 20, because somebody had saved
-- the 20-point player into the only quarterback slot and the 99 sat on a
-- bench. Nobody saves anything now.
select expect('the highest scorer plays, whatever anybody saved',
  lineup_points(:'G', (select id from managers where league_id = :'G' and slot = 'AAA'), 1),
  99::numeric);

select expect('an unfinished week is not final',
  (select bool_or(final) from matchups where league_id = :'G' and week = 1), false);

select expect('an unfinished week has no winner',
  (select count(*)::int from matchups where league_id = :'G' and week = 1 and winner is not null), 0);

select expect('but it still carries live points',
  (select max(greatest(home_points, away_points)) from matchups where league_id = :'G' and week = 1),
  99::numeric);

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
  '99/15');

select expect('the starters are snapshotted',
  (select jsonb_array_length(home_starters) > 0 from matchups
    where league_id = :'G' and week = 1), true);

-- A later roster change must not rewrite a finished week. Moving somebody to
-- a bench proves nothing now — a bench does not mean anything — so this drops
-- the player the result was built on, which under best ball would take the
-- score from 99 back to 20 if a final week could be regraded.
\o /dev/null
delete from roster_slots where league_id = :'G' and player_name = 'Bench A';
select grade_week(:'G', 1);
\o

select expect('a final week is not regraded',
  (select max(greatest(home_points, away_points)) from matchups where league_id = :'G' and week = 1),
  99::numeric);

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

-- A manager marks their own notices read and writes nothing else about them.
-- Anybody who could set the body could tell somebody anything at all, in the
-- league's own voice.
select expect('a manager may mark a notice read',
  has_column_privilege('authenticated', 'notices', 'read_at', 'UPDATE'), true);

select expect('but cannot rewrite what it says',
  has_column_privilege('authenticated', 'notices', 'body', 'UPDATE'), false);

select expect('nor who it was for',
  has_column_privilege('authenticated', 'notices', 'manager_id', 'UPDATE'), false);

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
-- This league plays a three-week season, so the default deadline lands in
-- week one and every trade below would be refused on the calendar rather than
-- on what these checks are about. Turned off explicitly; the deadline has its
-- own section further down.
update leagues set settings = settings || '{"tradeDeadlineWeek": 0}'::jsonb where id = :'P';
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

\echo ''
\echo '--- the intro film after the draft ---'

\set V  '99999999-0000-0000-0000-000000000017'
\set VA 'aaaa0000-0000-0000-0000-000000000040'
\set VB 'aaaa0000-0000-0000-0000-000000000041'

\o /dev/null
insert into leagues (id, name, season, commissioner_slot, draft_state, settings)
values (:'V', 'Film', 2026, 'AAA', 'running',
        jsonb_build_object('rounds', 1,
          'introVideo', 'https://example.test/storage/' || :'V' || '/intro-1.mp4',
          'introVideoPath', :'V' || '/intro-1.mp4'));

insert into auth.users (id) values (:'VA'), (:'VB');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'V', 'AAA', 'Ada', 'Alpha', true,  :'VA'),
  (:'V', 'BBB', 'Bo',  'Bravo', false, :'VB');

select signin(:'VA');
\o

select expect('a draft still running keeps its film',
  (select claim_intro_video_cleanup(:'V')), null);

select expect('and the league still points at it',
  (select settings ->> 'introVideoPath' from leagues where id = :'V'),
  :'V' || '/intro-1.mp4');

\o /dev/null
update leagues set draft_state = 'paused' where id = :'V';
\o

select expect('a paused draft keeps it too — somebody may come back',
  (select claim_intro_video_cleanup(:'V')), null);

\o /dev/null
update leagues set draft_state = 'complete' where id = :'V';
\o

select expect('once the draft is over the film is handed over to be deleted',
  (select claim_intro_video_cleanup(:'V')), :'V' || '/intro-1.mp4');

select expect('and the league no longer points at it',
  (select (settings ? 'introVideo') or (settings ? 'introVideoPath')
     from leagues where id = :'V'), false);

select expect('while everything else in the settings survives',
  (select (settings ->> 'rounds')::int from leagues where id = :'V'), 1);

-- Twelve browsers poll the draft board at once. Exactly one of them may claim
-- the film; the rest must find nothing to do rather than deleting twice.
select expect('a second claim finds nothing left',
  (select claim_intro_video_cleanup(:'V')), null);

select expect('it is on the record',
  (select detail ->> 'reason' from admin_log
    where league_id = :'V' and action = 'intro_video_cleared'), 'draft complete');

-- A film the commissioner linked to rather than uploaded costs this project
-- no storage and is not ours to delete.
\o /dev/null
update leagues
   set settings = settings || jsonb_build_object('introVideo', 'https://somebody-else.test/film.mp4')
 where id = :'V';
\o

select expect('a linked film is left alone',
  (select claim_intro_video_cleanup(:'V')), null);

select expect('and stays linked',
  (select settings ->> 'introVideo' from leagues where id = :'V'),
  'https://somebody-else.test/film.mp4');

\o /dev/null
select signin(:'U1');
\o

select expect('somebody from another league cannot reach in and clear it',
  refuses(format('select claim_intro_video_cleanup(%L)', :'V')),
  'Not your league');

-- ---------------------------------------------------------------------------
-- Live scoring: the refresh throttle, and what "this week is over" means
-- ---------------------------------------------------------------------------

\o /dev/null
\set L '99999999-0000-0000-0000-000000000023'
\set M1 '99999999-0000-0000-0000-000000000024'
\set M2 '99999999-0000-0000-0000-000000000025'

insert into leagues (id, name, season, commissioner_slot, settings, draft_state, current_pick)
values (:'L', 'Live Scoring', 2031, 'AA',
        jsonb_build_object('rounds', 1, 'regularWeeks', 3, 'tradeDeadlineWeek', 0,
                           'starters', jsonb_build_object('QB', 1)),
        'complete', 1);

insert into managers (id, league_id, slot, name, franchise)
values (:'M1', :'L', 'AA', 'Ann', 'Anvils'),
       (:'M2', :'L', 'BB', 'Ben', 'Bears');

-- Positions, because best ball places a player by what he is rather than by
-- what a manager saved him as.
insert into roster_slots (league_id, manager_id, player_name, position, lineup_slot)
values (:'L', :'M1', 'Ann QB', 'QB', 'QB'),
       (:'L', :'M2', 'Ben QB', 'QB', 'QB');

insert into player_scores (league_id, week, player_name, points)
values (:'L', 1, 'Ann QB', 20), (:'L', 1, 'Ben QB', 10);

insert into matchups (league_id, week, home_manager, away_manager)
values (:'L', 1, :'M1', :'M2');
\o

-- The throttle. One yes per window, however many instances ask.

select expect('the first look claims the refresh',
  (select claim_score_refresh(:'L', 1, 60)), true);

select expect('the second, a moment later, is turned away',
  (select claim_score_refresh(:'L', 1, 60)), false);

select expect('and so is the third',
  (select claim_score_refresh(:'L', 1, 60)), false);

\o /dev/null
-- Wind the clock back to just past the window rather than waiting for it.
update score_refresh set refreshed_at = now() - interval '61 seconds'
 where league_id = :'L' and week = 1;
\o

select expect('once the window has passed, the next caller claims it',
  (select claim_score_refresh(:'L', 1, 60)), true);

select expect('a different week is throttled separately',
  (select claim_score_refresh(:'L', 2, 60)), true);

\o /dev/null
update score_refresh set refreshed_at = now() - interval '5 seconds'
 where league_id = :'L' and week = 1;
\o

-- A caller asking for a one-second window would be a way to use us to hammer
-- ESPN. The floor is enforced in the database, not in the code that calls it.
select expect('a window below the floor is raised to it',
  (select claim_score_refresh(:'L', 1, 1)), false);

-- Grading: a week is over when *this* league's season says so.

\o /dev/null
-- An earlier season's week 1, complete for ever. Other blocks in this file
-- have left week-1 rows of their own in other seasons, some finished and some
-- not, which is exactly the noise the season filter has to see through.
insert into nfl_games (id, season, week, season_type, starts_at, home_team, away_team,
                       home_score, away_score, state, completed)
values ('old-1', 2030, 1, 2, now() - interval '1 year', 'KC', 'BUF', 24, 15, 'post', true);
\o

select expect('a week with no games of its own cannot be closed',
  (select grade_week(:'L', 1) ->> 'final'), 'false');

\o /dev/null
-- This season's week 1, still being played.
insert into nfl_games (id, season, week, season_type, starts_at, home_team, away_team,
                       home_score, away_score, state, completed)
values ('new-1', 2031, 1, 2, now(), 'KC', 'BUF', 7, 3, 'in', false);
\o

select expect('another season''s completed games do not close this one',
  (select grade_week(:'L', 1) ->> 'final'), 'false');

select expect('but the points are live while it is open',
  (select home_points from matchups where league_id = :'L' and week = 1), 20::numeric);

select expect('and no winner is declared yet',
  (select winner from matchups where league_id = :'L' and week = 1), null);

\o /dev/null
-- A preseason fixture is not a fantasy week and must not hold one open.
insert into nfl_games (id, season, week, season_type, starts_at, home_team, away_team,
                       home_score, away_score, state, completed)
values ('pre-1', 2031, 1, 1, now(), 'KC', 'BUF', 0, 0, 'pre', false);
update nfl_games set state = 'post', completed = true where id = 'new-1';
\o

select expect('a preseason game does not hold the week open',
  (select grade_week(:'L', 1) ->> 'final'), 'true');

select expect('the winner is the one who scored more',
  (select winner from matchups where league_id = :'L' and week = 1), :'M1');

select expect('and the week is final',
  (select final from matchups where league_id = :'L' and week = 1), true);

-- A reset takes the throttle's memory with it, or next season's week one
-- would sit behind a timestamp set by last season's.
\o /dev/null
select purge_league_season(:'L');
\o

select expect('a reset clears the refresh record',
  (select count(*)::int from score_refresh where league_id = :'L'), 0);

select expect('so the first look at the new season claims immediately',
  (select claim_score_refresh(:'L', 1, 3600)), true);

\echo ''
\echo '--- the pick clock, the queue and the autodraft ---'

-- A league deep enough to reach the third rung of the clock: twelve rounds of
-- two franchises, which is round eleven at pick twenty-one.
--
-- The clock is set here rather than left to the migration's backfill, because
-- this harness runs the migrations against an empty database — there is no
-- league in existence at the moment the backfill runs, so what it does to an
-- existing one cannot be observed from in here. The fallback path a league
-- without a pickClock takes is checked below instead.
\set CK  '99999999-0000-0000-0000-0000000000c1'
\set CK1 'c10c0000-0000-0000-0000-000000000001'
\set CK2 'c10c0000-0000-0000-0000-000000000002'

\o /dev/null
insert into auth.users (id) values (:'CK1'), (:'CK2');
insert into leagues (id, name, season, commissioner_slot, settings, draft_state)
values (:'CK', 'Clock', 2033, 'AAA',
  '{"rounds": 12, "pickClock": [{"throughRound": 4, "seconds": 90},
                                {"throughRound": 10, "seconds": 75},
                                {"throughRound": null, "seconds": 60}]}'::jsonb,
  'pending');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'CK', 'AAA', 'One', 'Alpha', true,  :'CK1'),
  (:'CK', 'BBB', 'Two', 'Bravo', false, :'CK2');

select signin(:'CK1');
select rebuild_draft_board(:'CK');
\o

-- --------------------------------------------------------------- the clock --

select expect('the board is twelve rounds deep',
  (select count(*)::int from draft_picks where league_id = :'CK'), 24);

select expect('round 1 gets ninety seconds',
  pick_seconds_for((select settings from leagues where id = :'CK'), 1), 90);

select expect('and so does round 4',
  pick_seconds_for((select settings from leagues where id = :'CK'), 4), 90);

select expect('round 5 drops to seventy-five',
  pick_seconds_for((select settings from leagues where id = :'CK'), 5), 75);

select expect('and holds through round 10',
  pick_seconds_for((select settings from leagues where id = :'CK'), 10), 75);

select expect('round 11 drops to sixty',
  pick_seconds_for((select settings from leagues where id = :'CK'), 11), 60);

select expect('and stays there however deep the draft runs',
  pick_seconds_for((select settings from leagues where id = :'CK'), 40), 60);

-- The database and the app read the same array, so a settings blob nobody
-- validated must not be able to stop a draft from either side.
select expect('a league still on the old single number keeps it',
  pick_seconds_for('{"pickSeconds": 45}'::jsonb, 9), 45);

select expect('a pickClock that is not a list falls back to that number',
  pick_seconds_for('{"pickClock": "90", "pickSeconds": 45}'::jsonb, 3), 45);

select expect('a tier with nonsense in it is skipped, not raised on',
  pick_seconds_for(
    '{"pickClock": [{"throughRound": "soon", "seconds": 20}, {"seconds": 55}]}'::jsonb, 2), 55);

select expect('and a settings blob with nothing usable still has a clock',
  pick_seconds_for('{}'::jsonb, 7), 90);

select expect('nothing at all is still a clock',
  pick_seconds_for(null, 1), 90);

-- A nought is a typo, not a clock. draft-clock.ts skips such a tier too, and
-- the two implementations have to agree: one draws the countdown, the other
-- decides when the pick is taken.
select expect('a nought-second tier is skipped, not honoured',
  pick_seconds_for('{"pickClock": [{"seconds": 0}]}'::jsonb, 1), 90);

select expect('and the tier under it is used instead',
  pick_seconds_for('{"pickClock": [{"seconds": 0}, {"seconds": 40}]}'::jsonb, 1), 40);

select expect('a one-second tier is clamped up to five',
  pick_seconds_for('{"pickClock": [{"seconds": 1}]}'::jsonb, 1), 5);

select expect('and an absurdly long one down to ten minutes',
  pick_seconds_for('{"pickClock": [{"seconds": 99999}]}'::jsonb, 1), 600);

-- --------------------------------------------------------------- the queue --

\o /dev/null
select signin(:'CK2');
select set_draft_queue(:'CK', array['Bravo Two', 'Bravo Three', 'Bravo One']);
\o

select expect('a queue is kept in the order it was given',
  (select string_agg(player_name, ',' order by rank) from draft_queue
    where league_id = :'CK'), 'Bravo Two,Bravo Three,Bravo One');

\o /dev/null
select set_draft_queue(:'CK', array['Bravo One', 'Bravo Two']);
\o

select expect('setting it again replaces it rather than adding to it',
  (select string_agg(player_name, ',' order by rank) from draft_queue
    where league_id = :'CK'), 'Bravo One,Bravo Two');

\o /dev/null
select set_draft_queue(:'CK', array['Bravo One', 'Bravo One', '', 'Bravo Three']);
\o

select expect('a name twice is one place, and a blank is nobody',
  (select string_agg(player_name, ',' order by rank) from draft_queue
    where league_id = :'CK'), 'Bravo One,Bravo Three');

select expect('an empty list empties the queue',
  (select set_draft_queue(:'CK', array[]::text[]) ->> 'count'), '0');

select expect('a queue has a limit',
  refuses(format('select set_draft_queue(%L, (select array_agg(''P'' || g) from generate_series(1, 151) g))', :'CK')),
  'A queue holds at most 150 players, not 151');

select expect('and it is nobody else''s league to queue in',
  refuses(format('select set_draft_queue(%L, array[''Alpha One''])', :'L')),
  'Not your league');

select expect('the refused attempts left nothing behind',
  (select count(*)::int from draft_queue where league_id = :'CK'), 0);

-- ----------------------------------------------------------- the autodraft --

\o /dev/null
select set_draft_queue(:'CK', array['Bravo One', 'Bravo Two']);
select signin(:'CK1');
update leagues set draft_state = 'running', pick_started_at = now() where id = :'CK';
\o

select expect('nothing happens while somebody is on the clock',
  (select autodraft_expired(:'CK') ->> 'reason'), 'on the clock');

-- Alpha is on pick one. Seventy seconds is past the sixty a late round gets
-- and short of the ninety round one gets, which is the whole point of the
-- ladder: the round decides, not the league.
\o /dev/null
update leagues set pick_started_at = now() - interval '70 seconds' where id = :'CK';
\o

select expect('seventy seconds is not yet late in round one',
  (select autodraft_expired(:'CK') ->> 'reason'), 'on the clock');

\o /dev/null
update leagues set pick_started_at = now() - interval '95 seconds' where id = :'CK';
\o

select expect('but ninety-five is, and the fallback is taken',
  (select autodraft_expired(:'CK', 'Alpha One') ->> 'player_name'), 'Alpha One');

select expect('and it is recorded as the clock running out',
  (select detail ->> 'reason' from admin_log
    where league_id = :'CK' and action = 'autodraft'), 'clock');

select expect('the board moved on',
  (select current_pick from leagues where id = :'CK'), 2);

-- Bravo is on the clock now, and has a queue. The queue wins over any
-- fallback, which is the whole reason the queue exists.
\o /dev/null
update leagues set pick_started_at = now() - interval '95 seconds' where id = :'CK';
\o

select expect('a manager''s own queue is taken before the fallback',
  (select autodraft_expired(:'CK', 'Somebody Else') ->> 'player_name'), 'Bravo One');

select expect('and the record says the queue is where it came from',
  (select detail ->> 'reason' from admin_log
    where league_id = :'CK' and action = 'autodraft'
    order by created_at desc limit 1), 'clock_queue');

select expect('a drafted player leaves every queue, not just the picker''s',
  (select count(*)::int from draft_queue
    where league_id = :'CK' and player_name = 'Bravo One'), 0);

-- A manager who says they will not be here does not wait for a clock at all.
-- The flag goes on whoever actually holds the pick rather than on a franchise
-- named here, so the check does not quietly depend on reading the snake right.
\o /dev/null
update leagues set pick_started_at = now() where id = :'CK';
update managers set autodraft = true
 where id = (select manager_id from draft_picks
              where league_id = :'CK'
                and overall = (select current_pick from leagues where id = :'CK'));
\o

select expect('autodraft picks the moment the turn comes round, clock or no clock',
  (select autodraft_expired(:'CK', 'Wanted Nobody') ->> 'reason'), 'autodraft_queue');

select expect('and it is still the queue it picks from, not the fallback',
  (select player_name from draft_picks where league_id = :'CK' and overall = 3),
  'Bravo Two');

-- With nothing queued, the same switch falls through to the fallback the
-- caller worked out — which is the ADP-and-need pick, not best available.
\o /dev/null
delete from draft_queue where league_id = :'CK';
update leagues set pick_started_at = now() where id = :'CK';
update managers set autodraft = false where league_id = :'CK';
update managers set autodraft = true
 where id = (select manager_id from draft_picks
              where league_id = :'CK'
                and overall = (select current_pick from leagues where id = :'CK'));
\o

select expect('an empty queue falls through to the fallback',
  (select autodraft_expired(:'CK', 'Wanted Nobody') ->> 'reason'), 'autodraft');

select expect('and that is who was drafted',
  (select player_name from draft_picks where league_id = :'CK' and overall = 4),
  'Wanted Nobody');

\o /dev/null
update leagues set pick_started_at = now() where id = :'CK';
update managers set autodraft = false where league_id = :'CK';
\o

select expect('a manager who has not said so still gets their clock',
  (select autodraft_expired(:'CK', 'Bravo Three') ->> 'reason'), 'on the clock');

-- The fallback is worked out before the league row is locked, so it can name
-- somebody who has since been taken. That is a "call me again", not a crash.
\o /dev/null
update leagues set pick_started_at = now() - interval '200 seconds' where id = :'CK';
\o

select expect('a fallback who is already rostered is refused cleanly',
  (select autodraft_expired(:'CK', 'Alpha One') ->> 'reason'), 'already rostered');

select expect('and nothing was drafted twice',
  (select count(*)::int from roster_slots
    where league_id = :'CK' and player_name = 'Alpha One'), 1);

-- The commissioner's clock nudge works against the round's limit too, not a
-- league-wide one.
\o /dev/null
update leagues set pick_started_at = now(), current_pick = 21 where id = :'CK';
select signin(:'CK1');
\o

select expect('pick twenty-one is in round eleven',
  (select round from draft_picks where league_id = :'CK' and overall = 21), 11);

select expect('so the clock it is nudged against is sixty seconds, not ninety',
  (select (nudge_clock(:'CK', 0) ->> 'remaining')::int between 55 and 61), true);

\echo ''
\echo '--- email: a delivery channel for notices that already exist ---'

\set ML  '99999999-0000-0000-0000-0000000000e1'
\set ML1 'e1a00000-0000-0000-0000-000000000001'
\set ML2 'e1a00000-0000-0000-0000-000000000002'

\o /dev/null
insert into auth.users (id) values (:'ML1'), (:'ML2');
insert into leagues (id, name, season, commissioner_slot, settings, draft_state)
values (:'ML', 'Mail', 2034, 'AAA', '{"rounds": 2}'::jsonb, 'pending');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'ML', 'AAA', 'One', 'Alpha', true,  :'ML1'),
  (:'ML', 'BBB', 'Two', 'Bravo', false, :'ML2');

select signin(:'ML1');
\o

-- A manager owns their own address, the same way they own their team name.
select expect('an address starts empty',
  (select email from managers where league_id = :'ML' and slot = 'AAA'), null::text);

\o /dev/null
update managers set email = 'alpha@example.com'
 where league_id = :'ML' and slot = 'AAA';
\o

select expect('and can be set',
  (select email from managers where league_id = :'ML' and slot = 'AAA'), 'alpha@example.com');

select expect('wanting the emails is the default',
  (select email_notices from managers where league_id = :'ML' and slot = 'AAA'), true);

-- ------------------------------------------------------------- the queue ---

\o /dev/null
select notify_manager(:'ML', (select id from managers where league_id = :'ML' and slot = 'AAA'),
  'draft_turn', 'You are on the clock.', '/draft');
select notify_manager(:'ML', (select id from managers where league_id = :'ML' and slot = 'BBB'),
  'trade_offer', 'Alpha offered you a trade.', '/trade-builder');
\o

select expect('two notices were raised',
  (select count(*)::int from notices where league_id = :'ML'), 2);

-- Only the manager with an address is eligible, and the row carries everything
-- an email needs. Bravo gets the in-app notice and nothing else, which is the
-- whole point of the address being optional.
select expect('only the manager with an address is claimed, and it carries the email',
  (select email || '|' || kind || '|' || href || '|' || franchise
     from claim_notice_mail(25)),
  'alpha@example.com|draft_turn|/draft|Alpha');

-- Claim-then-send: a second run finds nothing, which is what stops two
-- overlapping crons posting the same notice twice.
select expect('claiming again finds nothing to send',
  (select count(*)::int from claim_notice_mail(25)), 0);

select expect('the claimed notice is marked, the other is not',
  (select count(*)::int from notices where league_id = :'ML' and emailed_at is not null), 1);

-- A send that fails hands the notice back, and the next run picks it up.
\o /dev/null
select release_notice_mail(array(
  select id from notices where league_id = :'ML' and emailed_at is not null));
\o

select expect('a released notice is unmarked',
  (select count(*)::int from notices where league_id = :'ML' and emailed_at is not null), 0);

select expect('and is claimed again on the next run',
  (select count(*)::int from claim_notice_mail(25)), 1);

-- Switching the emails off stops them without losing the address.
\o /dev/null
update managers set email_notices = false
 where league_id = :'ML' and slot = 'AAA';
select release_notice_mail(array(select id from notices where league_id = :'ML'));
\o

select expect('a manager who turned them off is not claimed',
  (select count(*)::int from claim_notice_mail(25)), 0);

select expect('but their address is still theirs',
  (select email from managers where league_id = :'ML' and slot = 'AAA'), 'alpha@example.com');

-- An old notice is not delivered late. A cron down for a week should resume,
-- not post the week.
\o /dev/null
update managers set email_notices = true where league_id = :'ML' and slot = 'AAA';
update notices set created_at = now() - interval '3 days', emailed_at = null
 where league_id = :'ML';
\o

select expect('a notice older than a day is left alone',
  (select count(*)::int from claim_notice_mail(25)), 0);

-- Nobody but the service key may touch the queue. A session that could claim
-- mail could mark somebody else's notices delivered and silently stop them.
select expect('a manager cannot claim the mail queue',
  (select has_function_privilege('authenticated', 'claim_notice_mail(int)', 'execute')), false);

select expect('nor hand notices back',
  (select has_function_privilege('authenticated', 'release_notice_mail(uuid[])', 'execute')), false);

select expect('but they can still read their own notices',
  (select has_table_privilege('authenticated', 'notices', 'select')), true);

\echo ''
\echo '--- best ball: the lineup picks itself ---'

\set BB  '99999999-0000-0000-0000-0000000000b1'
\set BB1 'bb100000-0000-0000-0000-000000000001'
\set BB2 'bb100000-0000-0000-0000-000000000002'

\o /dev/null
insert into auth.users (id) values (:'BB1'), (:'BB2');
insert into leagues (id, name, season, commissioner_slot, settings, draft_state)
values (:'BB', 'Best Ball', 2035, 'AAA',
  '{"rounds": 2, "starters": {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "FLEX": 1, "K": 1, "D/ST": 1}}'::jsonb,
  'complete');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'BB', 'AAA', 'One', 'Alpha', true,  :'BB1'),
  (:'BB', 'BBB', 'Two', 'Bravo', false, :'BB2');

-- A roster with a real decision in it: three backs, three receivers, and a
-- bench player who outscores a starter at his own position.
insert into roster_slots (league_id, manager_id, player_name, position, lineup_slot)
select :'BB', m.id, x.name, x.pos, 'BENCH'
  from managers m,
       (values
         ('Passer',      'QB'),
         ('Backup QB',   'QB'),
         ('Back One',    'RB'),
         ('Back Two',    'RB'),
         ('Back Three',  'RB'),
         ('Wide One',    'WR'),
         ('Wide Two',    'WR'),
         ('Wide Three',  'WR'),
         ('Tight One',   'TE'),
         ('Kicker',      'K'),
         ('The Defence', 'D/ST')
       ) as x(name, pos)
 where m.league_id = :'BB' and m.slot = 'AAA';

-- Points that make the right answer non-obvious: the third back outscores the
-- first two, and a receiver outscores every back for the flex.
insert into player_scores (league_id, week, player_name, points) values
  (:'BB', 1, 'Passer',      20),
  (:'BB', 1, 'Backup QB',   30),
  (:'BB', 1, 'Back One',     5),
  (:'BB', 1, 'Back Two',    12),
  (:'BB', 1, 'Back Three',  18),
  (:'BB', 1, 'Wide One',     9),
  (:'BB', 1, 'Wide Two',    14),
  (:'BB', 1, 'Wide Three',  16),
  (:'BB', 1, 'Tight One',    7),
  (:'BB', 1, 'Kicker',       8),
  (:'BB', 1, 'The Defence', 10);
\o

-- The optimum: Backup QB 30, Back Three 18 + Back Two 12, Wide Three 16 +
-- Wide Two 14, Tight One 7, flex takes Wide One 9 (the best left over, ahead
-- of Back One's 5), Kicker 8, Defence 10. Total 124.
select expect('the best quarterback starts, whatever he is called',
  (select slot from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where player_name = 'Backup QB'), 'QB');

select expect('and the lower-scoring one does not',
  (select count(*)::int from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where player_name = 'Passer'), 0);

select expect('the two best backs fill the two back slots',
  (select string_agg(player_name, ',' order by player_name)
     from best_ball_lineup(:'BB',
       (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where slot = 'RB'), 'Back Three,Back Two');

select expect('the flex takes the best left over, whatever position he is',
  (select player_name from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where slot = 'FLEX'), 'Wide One');

select expect('every slot is filled and none twice',
  (select count(*)::int from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)), 9);

select expect('nobody is in the lineup twice',
  (select count(distinct player_name)::int from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)), 9);

select expect('and the week is worth the best arrangement, not the saved one',
  lineup_points(:'BB', (select id from managers where league_id = :'BB' and slot = 'AAA'), 1),
  124::numeric);

-- The point of best ball: what lineup_slot says is now irrelevant. Every one
-- of those players is on the bench, and the score is the same.
select expect('every player is on the bench, and it changes nothing',
  (select count(*)::int from roster_slots
    where league_id = :'BB' and lineup_slot <> 'BENCH'), 0);

-- A player who did not play is worth nought rather than being skipped over.
\o /dev/null
delete from player_scores where league_id = :'BB' and player_name = 'Backup QB';
\o

select expect('a player with no score at all counts as nought',
  lineup_points(:'BB', (select id from managers where league_id = :'BB' and slot = 'AAA'), 1),
  114::numeric);

select expect('and the quarterback slot falls to the one who did play',
  (select player_name from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where slot = 'QB'), 'Passer');

-- The swap is live: raise a bench player above a starter and the lineup moves.
\o /dev/null
update player_scores set points = 40
 where league_id = :'BB' and week = 1 and player_name = 'Back One';
\o

select expect('a player who overtakes a starter takes his place',
  (select string_agg(player_name, ',' order by player_name)
     from best_ball_lineup(:'BB',
       (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where slot = 'RB'), 'Back One,Back Three');

-- Without a position nobody can be placed, which is why the app keeps them in
-- step. A missing one costs that player his slot rather than breaking a week.
\o /dev/null
update roster_slots set position = null
 where league_id = :'BB' and player_name = 'The Defence';
\o

select expect('a player with no position is left out rather than guessed at',
  (select count(*)::int from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where player_name = 'The Defence'), 0);

select expect('and the rest of the lineup still stands',
  (select count(*)::int from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)), 8);

\o /dev/null
select sync_roster_positions(:'BB', array['The Defence'], array['D/ST']);
\o

select expect('and the app putting it back puts him back',
  (select slot from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where player_name = 'The Defence'), 'D/ST');

select expect('positions are the service key''s to write, not a manager''s',
  (select has_function_privilege('authenticated',
     'sync_roster_positions(uuid, text[], text[])', 'execute')), false);

select expect('but a manager may read what their lineup would be',
  (select has_function_privilege('authenticated',
     'best_ball_lineup(uuid, uuid, int)', 'execute')), true);

-- The settings flag the migration backfills is not asserted here: this harness
-- runs the migrations against an empty database, so no league exists at the
-- moment of the backfill. It is read by the app, not by any of this — nothing
-- in SQL consults it, because the scoring is best ball unconditionally. That
-- is the safer arrangement: a result cannot depend on a settings key somebody
-- could clear.
select expect('scoring does not depend on a settings flag being present',
  lineup_points(:'BB', (select id from managers where league_id = :'BB' and slot = 'BBB'), 1),
  0::numeric);

-- --- injured reserve: the one decision best ball leaves you ---
--
-- Everything else about a lineup is gone, but a dynasty roster still has to be
-- able to carry a man who tore something in October without paying a roster
-- spot for him until March. That is a different problem from choosing who
-- starts, and it is the only reason lineup_slot still says anything.

\o /dev/null
update leagues
   set settings = settings || '{"bench": 2, "ir": 1}'::jsonb
 where id = :'BB';
select signin(:'BB1');
\o

-- Where we start: Back One is the best back on the roster and is in a slot.
select expect('the man about to be stashed is starting',
  (select slot from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where player_name = 'Back One'), 'RB');

select expect('and the week is worth what he is worth',
  lineup_points(:'BB', (select id from managers where league_id = :'BB' and slot = 'AAA'), 1),
  145::numeric);

select expect('a manager may stash one of their own',
  (select set_injured_reserve('Back One', true) ->> 'ok'), 'true');

select expect('a stashed player cannot fill a slot',
  (select count(*)::int from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where player_name = 'Back One'), 0);

-- 145 less his 40, less the 12 the flex loses shuffling up, plus the 9 the
-- flex now takes: the whole roster reorganises itself around the gap.
select expect('so the week is worth less, and the slots close over him',
  lineup_points(:'BB', (select id from managers where league_id = :'BB' and slot = 'AAA'), 1),
  114::numeric);

select expect('and he stops counting against the roster',
  roster_count((select id from managers where league_id = :'BB' and slot = 'AAA')), 10);

select expect('the reserve holds only what the settings say it holds',
  (select refuses($$select set_injured_reserve('Passer', true)$$)),
  'Injured reserve holds 1');

select expect('and a player nobody holds cannot be stashed',
  (select refuses($$select set_injured_reserve('Somebody Else', true)$$)),
  'You do not hold Somebody Else');

-- A man coming back needs a roster spot to come back to. Filling the one he
-- vacated is exactly how a manager would get himself two extra players.
\o /dev/null
insert into roster_slots (league_id, manager_id, player_name, position, lineup_slot)
select :'BB', m.id, 'The Replacement', 'RB', 'BENCH'
  from managers m where m.league_id = :'BB' and m.slot = 'AAA';
\o

select expect('a full roster will not take him back',
  (select refuses($$select set_injured_reserve('Back One', false)$$)),
  'Your roster is full at 11 — drop someone first');

select expect('and he is still on the reserve',
  (select lineup_slot from roster_slots
    where league_id = :'BB' and player_name = 'Back One'), 'IR');

\o /dev/null
delete from roster_slots where league_id = :'BB' and player_name = 'The Replacement';
\o

select expect('with room made, he comes back',
  (select set_injured_reserve('Back One', false) ->> 'ok'), 'true');

select expect('and takes his slot again',
  (select slot from best_ball_lineup(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'), 1)
    where player_name = 'Back One'), 'RB');

select expect('with the week worth what it was',
  lineup_points(:'BB', (select id from managers where league_id = :'BB' and slot = 'AAA'), 1),
  145::numeric);

-- Asking for a player who is already active to be active is not an error
-- somebody has to understand, and must not check for room he already has.
select expect('activating somebody already active does nothing',
  (select set_injured_reserve('Back One', false) ->> 'ok'), 'true');

select expect('a manager may do this themselves',
  (select has_function_privilege('authenticated',
     'set_injured_reserve(text, boolean)', 'execute')), true);

-- --- the roster cap ---
--
-- The cap is not stored: it is the starting slots plus the bench, so changing
-- the bench is the whole of changing it. What has to hold is that the number
-- the settings imply is the number place_player enforces, and that the draft
-- fills a roster exactly rather than overrunning it.

select expect('ten on the field and eight behind them is eighteen',
  roster_capacity('{"starters": {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "FLEX": 2, "D/ST": 1, "K": 1}, "bench": 8}'::jsonb),
  18);

-- That the draft rounds match it is asserted where the settings are written
-- rather than here: this harness has no league of its own to read defaults
-- from. See settings.test.mts.

-- The one that would bite: a full roster refuses another player rather than
-- quietly carrying nineteen.
\o /dev/null
update leagues
   set settings = settings || '{"bench": 0, "ir": 1}'::jsonb
 where id = :'BB';
\o

-- Alpha holds eleven against a capacity of nine starters plus no bench.
select expect('a roster over its cap takes nobody else',
  (select refuses(format($$select place_player(%L, %L, 'Somebody New')$$,
     :'BB', (select id from managers where league_id = :'BB' and slot = 'AAA')))),
  'Your roster is full at 9 — drop someone first');

\o /dev/null
update leagues
   set settings = settings || '{"bench": 8, "ir": 1}'::jsonb
 where id = :'BB';
\o

-- Nine starters plus eight is seventeen, and Alpha holds eleven, so there is
-- room again. The rule is arithmetic on the settings, not a stored number
-- somebody has to remember to change.
select expect('and raising the bench makes room without touching anybody',
  (select place_player(:'BB',
     (select id from managers where league_id = :'BB' and slot = 'AAA'),
     'Somebody New') ->> 'ok'), 'true');

select expect('the new man is on the roster',
  (select count(*)::int from roster_slots
    where league_id = :'BB' and player_name = 'Somebody New'), 1);
