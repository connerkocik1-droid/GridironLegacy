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

-- ----------------------------------------------------------------- ready ---
-- A manager says they are ready, and says it only about themselves.

\o /dev/null
select set_config('test.uid', :'U1', false);
set role authenticated;
\o

\echo ''
\echo '--- ready ---'

select expect('a manager marks themselves ready',
  refuses(format('update managers set ready = true where id = %L',
    (select id from managers where league_id = :'L' and slot = 'AAA'))),
  null::text);

select expect('and it took',
  (select ready from managers where league_id = :'L' and slot = 'AAA'), true);

select expect('nor is ready a way to reach anything else on the row',
  has_column_privilege('authenticated', 'managers', 'is_commissioner', 'UPDATE'), false);

-- Bravo is nobody in particular, which is the case that matters.
\o /dev/null
reset role;
select set_config('test.uid', :'U2', false);
set role authenticated;

update managers set ready = true where league_id = :'L' and slot = 'AAA';
\o

select expect('a manager cannot mark somebody else in',
  (select ready from managers where league_id = :'L' and slot = 'AAA'), true);

\o /dev/null
update managers set ready = false where league_id = :'L' and slot = 'AAA';
\o

select expect('nor mark them out again',
  (select ready from managers where league_id = :'L' and slot = 'AAA'), true);

select expect('though they can still speak for themselves',
  (select refuses(format('update managers set ready = true where id = %L',
     (select id from managers where league_id = :'L' and slot = 'BBB')))),
  null::text);

select expect('and that took',
  (select ready from managers where league_id = :'L' and slot = 'BBB'), true);

-- The commissioner reaching another franchise's row is managers_admin doing
-- what it has always done, not this grant widening anything. Marking somebody
-- present is a reasonable thing for the person running the room to do.
\o /dev/null
reset role;
update managers set ready = false where league_id = :'L' and slot = 'BBB';
select set_config('test.uid', :'U1', false);
set role authenticated;
update managers set ready = true where league_id = :'L' and slot = 'BBB';
\o

select expect('the commissioner may mark a franchise in, as they always could',
  (select ready from managers where league_id = :'L' and slot = 'BBB'), true);

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

-- ---------------------------------------------------------------- crests ---
-- A manager sets their own team photo and nobody else's. Run as authenticated,
-- because that is the only role the policies on team_logos apply to.

\o /dev/null
\set OTHER 'ffff2222-0000-0000-0000-000000000002'

insert into leagues (id, name, season, commissioner_slot)
values (:'OTHER', 'Elsewhere', 2026, 'ZZZ');
insert into managers (league_id, slot, name, franchise)
values (:'OTHER', 'ZZZ', 'Z', 'Zenith');

insert into team_logos (manager_id, league_id, image)
select id, :'OTHER', 'data:image/webp;base64,ZZZZ' from managers where league_id = :'OTHER';

select set_config('test.uid', :'U1', false);
set role authenticated;
\o

\echo ''
\echo '--- team photos ---'

select expect('a manager sets their own crest',
  refuses(format(
    'insert into team_logos (manager_id, league_id, image) values (%L, %L, %L)',
    (select id from managers where league_id = :'L' and slot = 'AAA'), :'L',
    'data:image/webp;base64,AAAA')),
  null::text);

select expect('but cannot put one on somebody else''s franchise',
  refuses(format(
    'insert into team_logos (manager_id, league_id, image) values (%L, %L, %L)',
    (select id from managers where league_id = :'L' and slot = 'BBB'), :'L',
    'data:image/webp;base64,BBBB')) like '%row-level security%', true);

-- Bravo's crest, put there by nobody in particular, so the checks below are
-- about whether Alpha can touch it rather than whether it exists.
\o /dev/null
reset role;
insert into team_logos (manager_id, league_id, image)
select id, :'L', 'data:image/webp;base64,BBBB'
  from managers where league_id = :'L' and slot = 'BBB'
 on conflict (manager_id) do update set image = excluded.image;
set role authenticated;

update team_logos set image = 'data:image/webp;base64,STOLEN'
 where manager_id = (select id from managers where league_id = :'L' and slot = 'BBB');
\o

select expect('nor overwrite the one somebody else chose',
  (select image from team_logos
    where manager_id = (select id from managers where league_id = :'L' and slot = 'BBB')),
  'data:image/webp;base64,BBBB');

\o /dev/null
delete from team_logos
 where manager_id = (select id from managers where league_id = :'L' and slot = 'BBB');
\o

select expect('nor take it away',
  (select count(*)::int from team_logos
    where manager_id = (select id from managers where league_id = :'L' and slot = 'BBB')), 1);

select expect('every crest in the league is visible, which is the point of one',
  (select count(*)::int from team_logos), 2);

select expect('but not one from another league',
  (select count(*)::int from team_logos where league_id = :'OTHER'), 0);

select expect('a picture too big for a crest is refused',
  refuses(format(
    'update team_logos set image = %L where manager_id = %L',
    'data:image/webp;base64,' || repeat('A', 300000),
    (select id from managers where league_id = :'L' and slot = 'AAA')))
    like '%team_logos_image_size%', true);

select expect('and so is something that is not an image at all',
  refuses(format(
    'update team_logos set image = %L where manager_id = %L',
    'javascript:alert(1)',
    (select id from managers where league_id = :'L' and slot = 'AAA')))
    like '%team_logos_image_kind%', true);

\o /dev/null
reset role;
\o
