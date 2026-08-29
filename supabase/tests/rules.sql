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
