-- Can a manager force a trade through on their own?
--
-- Run as the `authenticated` role, because the guard keys on exactly that:
-- a SECURITY DEFINER function runs as its owner, so the check has to be able
-- to tell a browser session apart from execute_trade() calling in.
--
-- Run by scripts/test-db.sh. Each check prints PASS or FAIL.

\set ON_ERROR_STOP off
\pset pager off
\pset tuples_only on
\pset format unaligned

\set L 'ffff2222-0000-0000-0000-000000000001'
\set U1 'ffff2222-0000-0000-0000-0000000000a1'
\set U2 'ffff2222-0000-0000-0000-0000000000a2'
\set T  'ffff2222-0000-0000-0000-0000000000b1'

\o /dev/null
insert into leagues (id, name, season, commissioner_slot, settings)
values (:'L', 'Forgery', 2026, 'AAA', '{"starters":{"QB":1},"bench":4}'::jsonb);

insert into auth.users (id) values (:'U1'), (:'U2');

insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'L', 'AAA', 'A', 'Alpha', true,  :'U1'),
  (:'L', 'BBB', 'B', 'Bravo', false, :'U2');

insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
  select :'L', id, 'Their Star', 'BENCH' from managers where league_id = :'L' and slot = 'BBB';

-- Alpha proposes to take Bravo's star for nothing.
insert into trades (id, league_id, from_manager, to_manager, offer, status)
values (:'T', :'L',
  (select id from managers where league_id = :'L' and slot = 'AAA'),
  (select id from managers where league_id = :'L' and slot = 'BBB'),
  '{"give": [], "get": ["Their Star"]}'::jsonb, 'open');

grant usage on schema public to authenticated;
grant select, insert, delete on all tables in schema public to authenticated;
grant update on trades to authenticated;

select set_config('test.uid', :'U1', false);
set role authenticated;
\o

\echo ''
\echo '--- trade forgery ---'

select expect('a manager may accept their own side',
  refuses(format('update trades set from_accepted = true where id = %L', :'T')) is null, true);

select expect('but cannot accept for the other manager',
  refuses(format('update trades set to_accepted = true where id = %L', :'T'))
    like '%cannot accept on the other%', true);

select expect('nor mark the trade executed to fake it through',
  refuses(format('update trades set status = ''executed'' where id = %L', :'T'))
    like '%executed by accepting%', true);

select expect('so execute_trade still refuses',
  refuses(format('select execute_trade(%L)', :'T')) like '%Both managers must accept%', true);

\o /dev/null
reset role;
\o

select expect('and the player never moved',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'L' and r.player_name = 'Their Star'), 'BBB');

-- The legitimate path must still work, or the guard is too strict.
\o /dev/null
select set_config('test.uid', :'U2', false);
set role authenticated;
update trades set to_accepted = true where id = :'T';
reset role;
\o

select expect('the real other manager can accept',
  (select to_accepted from trades where id = :'T'), true);

select expect('and then the trade executes',
  (select (execute_trade(:'T') ->> 'ok')::boolean), true);

select expect('moving the player',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'L' and r.player_name = 'Their Star'), 'AAA');
