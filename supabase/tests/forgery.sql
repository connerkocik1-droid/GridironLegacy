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

\o /dev/null
reset role;

-- A second league's picks, so "you see your own" can be told apart from
-- "you see everything".
-- Its own id. This read 'ffff2222-…-02' — the same league the crest checks
-- above create — so both inserts below failed on a duplicate key, and the
-- "another league's picks" check underneath was counting a league that had
-- never been given any. It passed by having nothing to hide.
\set PL 'ffff2222-0000-0000-0000-000000000009'
insert into leagues (id, name, season, inaugural_season, commissioner_slot, settings)
values (:'PL', 'Elsewhere', 2026, 2026, 'AAA', '{"rounds": 1, "rookieRounds": 1}'::jsonb);
insert into managers (league_id, slot, name, franchise) values (:'PL', 'ZZZ', 'Z', 'Zulu');
select award_draft_picks(:'PL', 2026);

select award_draft_picks(:'L', 2026);
select award_draft_picks(:'L', 2027);

-- The blanket grant above is the harness being generous so that RLS, not a
-- missing privilege, is what these checks actually exercise. Production grants
-- only select on this table; both are tested below.
select set_config('test.uid', :'U1', false);
set role authenticated;
\o

\echo ''
\echo '--- draft picks are not self-serve ---'

select expect('a manager cannot award themselves picks',
  refuses(format('select award_draft_picks(%L, 2030)', :'L'))
    like '%permission denied for function award_draft_picks%', true);

select expect('nor set the order of the board',
  refuses(format('select set_draft_pick_order(%L, 2027)', :'L'))
    like '%permission denied for function set_draft_pick_order%', true);

select expect('nor invent a pick, even with insert granted',
  refuses(format(
    'insert into draft_pick_assets (league_id, season, round, origin_manager, manager_id) values (%L, 2027, 9, %L, %L)',
    :'L',
    (select id from managers where league_id = :'L' and slot = 'AAA'),
    (select id from managers where league_id = :'L' and slot = 'AAA')))
    like '%row-level security%', true);

-- Update is never granted at all, so this is refused before RLS is consulted.
select expect('nor take somebody else''s pick by hand',
  refuses(format(
    'update draft_pick_assets set manager_id = %L where league_id = %L',
    (select id from managers where league_id = :'L' and slot = 'AAA'), :'L'))
    like '%permission denied for table draft_pick_assets%', true);

select expect('and every pick is still held by the franchise it came from',
  (select bool_and(a.manager_id = a.origin_manager)
     from draft_pick_assets a where a.league_id = :'L'), true);

-- Delete is granted by the harness, so what refuses it here is the absence of
-- a delete policy: the rows are simply not visible to delete.
\o /dev/null
delete from draft_pick_assets where league_id = :'L';
\o

-- Two franchises, 24 rounds in the inaugural draft and 5 in the rookie draft.
select expect('nor delete one to clear a rival''s board',
  (select count(*)::int from draft_pick_assets where league_id = :'L'), 58);

select expect('every pick in the league is visible, which is what a market needs',
  (select count(*)::int from draft_pick_assets where league_id = :'L'), 58);

select expect('but not another league''s',
  (select count(*)::int from draft_pick_assets where league_id = :'PL'), 0);

select expect('and picks are read-only to the browser in production',
  has_table_privilege('authenticated', 'draft_pick_assets', 'SELECT')
    and not has_table_privilege('authenticated', 'draft_pick_assets', 'UPDATE'), true);

\o /dev/null
reset role;
\o

\o /dev/null
reset role;

\set W  'ffff2222-0000-0000-0000-000000000003'
\set W1 'ffff2222-0000-0000-0000-0000000000c1'
\set W2 'ffff2222-0000-0000-0000-0000000000c2'

insert into leagues (id, name, season, commissioner_slot, settings)
values (:'W', 'Withdrawals', 2026, 'AAA', '{"starters":{"QB":1},"bench":4}'::jsonb);
insert into auth.users (id) values (:'W1'), (:'W2');
insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id) values
  (:'W', 'AAA', 'A', 'Alpha', true,  :'W1'),
  (:'W', 'BBB', 'B', 'Bravo', false, :'W2');

insert into roster_slots (league_id, manager_id, player_name, lineup_slot)
  select :'W', id, 'Alpha Star', 'BENCH' from managers where league_id = :'W' and slot = 'AAA';

-- Alpha offers, which means Alpha has accepted their own terms and Bravo has
-- not seen them yet.
insert into trades (id, league_id, from_manager, to_manager, offer, status,
                    from_accepted, to_accepted)
select 'eeee0000-0000-0000-0000-000000000001', :'W',
       (select id from managers where league_id = :'W' and slot = 'AAA'),
       (select id from managers where league_id = :'W' and slot = 'BBB'),
       '{"give": ["Alpha Star"], "get": []}'::jsonb, 'open', true, false;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- Bravo, the manager who received it.
select set_config('test.uid', :'W2', false);
set role authenticated;
\o

\echo ''
\echo '--- withdrawing an offer ---'

select expect('the manager who received an offer cannot mark it withdrawn',
  refuses('update trades set status = ''rescinded'' where id = ''eeee0000-0000-0000-0000-000000000001'''),
  'Only the manager waiting on a reply may withdraw the offer');

select expect('so the offer still stands',
  (select status from trades where id = 'eeee0000-0000-0000-0000-000000000001'), 'open');

\o /dev/null
reset role;
select set_config('test.uid', :'W1', false);
set role authenticated;
\o

select expect('the manager who sent it may take it back',
  refuses('update trades set status = ''rescinded'', from_accepted = false where id = ''eeee0000-0000-0000-0000-000000000001'''),
  null);

select expect('and it is withdrawn, not declined',
  (select status from trades where id = 'eeee0000-0000-0000-0000-000000000001'), 'rescinded');

select expect('a withdrawn offer cannot be executed',
  refuses('select execute_trade(''eeee0000-0000-0000-0000-000000000001'')'),
  'Both managers must accept first');

select expect('and the player never moved',
  (select m.slot from roster_slots r join managers m on m.id = r.manager_id
    where r.league_id = :'W' and r.player_name = 'Alpha Star'), 'AAA');

-- Once the other side has accepted there is nothing left to withdraw: the
-- deal either ran or is blocked on something real.
\o /dev/null
insert into trades (id, league_id, from_manager, to_manager, offer, status,
                    from_accepted, to_accepted)
select 'eeee0000-0000-0000-0000-000000000002', :'W',
       (select id from managers where league_id = :'W' and slot = 'AAA'),
       (select id from managers where league_id = :'W' and slot = 'BBB'),
       '{"give": ["Alpha Star"], "get": []}'::jsonb, 'agreed', true, true;
\o

select expect('an offer both sides have accepted cannot be withdrawn',
  refuses('update trades set status = ''rescinded'' where id = ''eeee0000-0000-0000-0000-000000000002'''),
  'Only the manager waiting on a reply may withdraw the offer');

-- A counter is the other manager's terms, so it is theirs to take back.
\o /dev/null
insert into trades (id, league_id, from_manager, to_manager, offer, status,
                    from_accepted, to_accepted)
select 'eeee0000-0000-0000-0000-000000000003', :'W',
       (select id from managers where league_id = :'W' and slot = 'AAA'),
       (select id from managers where league_id = :'W' and slot = 'BBB'),
       '{"give": ["Alpha Star"], "get": []}'::jsonb, 'countered', false, true;
\o

select expect('the manager who sent an offer cannot withdraw the reply to it',
  refuses('update trades set status = ''rescinded'' where id = ''eeee0000-0000-0000-0000-000000000003'''),
  'Only the manager waiting on a reply may withdraw the offer');

\o /dev/null
reset role;
select set_config('test.uid', :'W2', false);
set role authenticated;
\o

select expect('but the manager who countered may take their counter back',
  refuses('update trades set status = ''rescinded'', to_accepted = false where id = ''eeee0000-0000-0000-0000-000000000003'''),
  null);

select expect('nor can withdrawing be used to fake a completed deal',
  refuses('update trades set status = ''executed'' where id = ''eeee0000-0000-0000-0000-000000000001'''),
  'A trade is executed by accepting it, not by setting its status');

\o /dev/null
reset role;
\o

-- ----------------------------------------------------------- waiver wire ---
-- The wire is the only thing standing between a dropped player and whoever
-- has the page open. A manager may read it and nothing else — writing to it
-- would let somebody release a player early, or park a free agent on it and
-- keep the league off him until they were ready to claim.
--
-- Every privilege is granted to authenticated by now, on purpose: what refuses
-- these is the absence of a write policy, not a missing grant.

\o /dev/null
reset role;

insert into waiver_wire (league_id, player_name, dropped_by, clears_at)
values (:'L', 'Wire Star',
        (select id from managers where league_id = :'L' and slot = 'BBB'),
        now() + interval '1 day');

insert into waiver_wire (league_id, player_name, clears_at)
values (:'OTHER', 'Their Wire Star', now() + interval '1 day');

select set_config('test.uid', :'U1', false);
set role authenticated;
\o

\echo ''
\echo '--- the waiver wire is read-only ---'

select expect('a manager sees who is on his own league''s wire',
  (select count(*)::int from waiver_wire where player_name = 'Wire Star'), 1);

select expect('but not another league''s',
  (select count(*)::int from waiver_wire where player_name = 'Their Wire Star'), 0);

-- Each of these runs and is thrown away; what matters is the state afterwards.
\o /dev/null
select refuses('delete from waiver_wire where player_name = ''Wire Star''');
select refuses(format(
  'update waiver_wire set clears_at = now() - interval ''2 days'' where league_id = %L', :'L'));
\o

select expect('nobody releases a player early by deleting him off the wire',
  on_waivers(:'L', 'Wire Star'), true);

select expect('nor by bringing his clearing time forward',
  (select clears_at > now() from waiver_wire where player_name = 'Wire Star'), true);

select expect('nor parks a free agent on it to keep him from the league',
  refuses(format(
    'insert into waiver_wire (league_id, player_name, clears_at) values (%L, %L, now() + interval ''9 days'')',
    :'L', 'Nobody Touched Him')) like '%row-level security%', true);

select expect('so the player they tried to park is still free',
  on_waivers(:'L', 'Nobody Touched Him'), false);

\o /dev/null
reset role;
\o

-- --------------------------------------------------------------- notices ---
-- A notice is the league telling you something. A manager who could write one
-- could tell somebody anything, in the league's own voice, and a manager who
-- could read somebody else's would know their trade offers before they did.

\o /dev/null
reset role;

insert into notices (league_id, manager_id, kind, body, href)
select :'L', id, 'trade', 'Bravo has offered you a trade.', '/trade-builder'
  from managers where league_id = :'L' and slot = 'BBB';

insert into notices (league_id, manager_id, kind, body)
select :'L', id, 'draft', 'You are on the clock.'
  from managers where league_id = :'L' and slot = 'AAA';

select set_config('test.uid', :'U1', false);
set role authenticated;
\o

\echo ''
\echo '--- notices are yours alone ---'

select expect('a manager reads their own',
  (select count(*)::int from notices where body = 'You are on the clock.'), 1);

select expect('and nobody else''s, however curious',
  (select count(*)::int from notices where body like '%offered you a trade%'), 0);

\o /dev/null
select refuses('update notices set read_at = now()');
\o

select expect('marking your own read is allowed',
  (select count(*)::int from notices where read_at is null), 0);

-- The column grant that stops a body being rewritten cannot be exercised here:
-- the harness hands authenticated a table-wide UPDATE above, which covers every
-- column and masks it. It is checked directly against the grants in rules.sql,
-- where nothing has been widened.

select expect('a notice cannot be invented for somebody else',
  refuses(format(
    'insert into notices (league_id, manager_id, kind, body) select %L, id, ''draft'', ''Skip your pick'' from managers where league_id = %L and slot = ''BBB''',
    :'L', :'L')) like '%row-level security%', true);

-- Named rather than counted: the trade sections above trip the same trigger,
-- so this manager's inbox is not a number this check can know.
\o /dev/null
select refuses('delete from notices');
\o

select expect('and nobody deletes the record of what they were told',
  (select count(*)::int from notices where body = 'You are on the clock.'), 1);

\o /dev/null
reset role;
\o

-- ------------------------------------------------------------- watchlist ---
-- Who a manager is watching is the one thing on this site that is nobody
-- else's business at all: knowing it before a waiver run is knowing what
-- somebody is about to claim.

\o /dev/null
reset role;

insert into watchlist (manager_id, player_name, league_id)
select id, 'My Secret Target', :'L' from managers where league_id = :'L' and slot = 'AAA';

insert into watchlist (manager_id, player_name, league_id)
select id, 'Their Secret Target', :'L' from managers where league_id = :'L' and slot = 'BBB';

select set_config('test.uid', :'U1', false);
set role authenticated;
\o

\echo ''
\echo '--- a watchlist is private ---'

select expect('a manager reads their own watchlist',
  (select count(*)::int from watchlist where player_name = 'My Secret Target'), 1);

select expect('and cannot see who else is watching whom',
  (select count(*)::int from watchlist where player_name = 'Their Secret Target'), 0);

select expect('a manager may watch somebody new',
  refuses(format(
    'insert into watchlist (manager_id, player_name, league_id) select id, ''Another Target'', %L from managers where league_id = %L and slot = ''AAA''',
    :'L', :'L')), null);

select expect('but not on somebody else''s behalf',
  refuses(format(
    'insert into watchlist (manager_id, player_name, league_id) select id, ''Planted'', %L from managers where league_id = %L and slot = ''BBB''',
    :'L', :'L')) like '%row-level security%', true);

\o /dev/null
select refuses('delete from watchlist');
\o

select expect('stopping watching somebody removes only your own',
  (select count(*)::int from watchlist where player_name = 'My Secret Target'), 0);

\o /dev/null
reset role;
\o

select expect('and theirs is untouched',
  (select count(*)::int from watchlist where player_name = 'Their Secret Target'), 1);

\o /dev/null
set role authenticated;
\o

\echo ''
\echo '--- the league chat is the league''s ---'

\o /dev/null
reset role;

-- A second league, so "everyone sees everything" can be shown to stop at the
-- league boundary rather than being taken on trust.
\set XL 'ffff3333-0000-0000-0000-000000000001'
\set XU 'ffff3333-0000-0000-0000-0000000000a1'

insert into auth.users (id) values (:'XU');
insert into leagues (id, name, season, commissioner_slot, settings, draft_state)
values (:'XL', 'Elsewhere', 2036, 'ZZZ', '{}'::jsonb, 'pending');
insert into managers (league_id, slot, name, franchise, is_commissioner, auth_user_id)
values (:'XL', 'ZZZ', 'Outsider', 'Outsiders', true, :'XU');

-- Alpha (commissioner) and Bravo both say something, and so does the outsider.
insert into messages (league_id, manager_id, body)
select :'L', id, 'Alpha said this' from managers where league_id = :'L' and slot = 'AAA';
insert into messages (league_id, manager_id, body)
select :'L', id, 'Bravo said this' from managers where league_id = :'L' and slot = 'BBB';
insert into messages (league_id, manager_id, body)
select :'XL', id, 'Another league entirely' from managers where league_id = :'XL';

select set_config('test.uid', :'U2', false);
set role authenticated;
\o

-- Bravo is not the commissioner here; Alpha is.
select expect('a manager reads their own league''s conversation',
  (select count(*)::int from messages), 2);

select expect('and cannot see another league''s at all',
  (select count(*)::int from messages where body = 'Another league entirely'), 0);

select expect('a manager may say something as themselves',
  refuses(format(
    'insert into messages (league_id, manager_id, body) select %L, id, ''Bravo again'' from managers where league_id = %L and slot = ''BBB''',
    :'L', :'L')), null);

select expect('but not in somebody else''s name',
  refuses(format(
    'insert into messages (league_id, manager_id, body) select %L, id, ''Alpha never said this'' from managers where league_id = %L and slot = ''AAA''',
    :'L', :'L')) like '%row-level security%', true);

select expect('nor into a league they are not in',
  refuses(format(
    'insert into messages (league_id, manager_id, body) select %L, id, ''Barging in'' from managers where league_id = %L and slot = ''BBB''',
    :'XL', :'L')) like '%row-level security%', true);

-- Deleting: your own, and nobody else's — unless you are the commissioner.
\o /dev/null
select refuses('delete from messages where body = ''Alpha said this''');
\o

select expect('a manager cannot delete somebody else''s message',
  (select count(*)::int from messages where body = 'Alpha said this'), 1);

\o /dev/null
select refuses('delete from messages where body = ''Bravo said this''');
\o

select expect('but can take back their own',
  (select count(*)::int from messages where body = 'Bravo said this'), 0);

-- The commissioner moderates. Alpha is the commissioner of this league.
\o /dev/null
reset role;
select set_config('test.uid', :'U1', false);
set role authenticated;
select refuses('delete from messages where body = ''Bravo again''');
\o

select expect('the commissioner can remove anybody''s',
  (select count(*)::int from messages where body = 'Bravo again'), 0);

-- Nobody edits history. An edited message is one somebody can be misquoted
-- from, and the honest version of changing your mind is deleting it.
-- The harness grants select/insert/delete on every table so that RLS is what
-- these checks exercise; update is granted only where a test needs it, so this
-- one asserts the outcome rather than the wording of the refusal.
select expect('and nobody rewrites what was said',
  (select count(*)::int from messages where body = 'Something else entirely'), 0);

\o /dev/null
reset role;
\o

select expect('the other league still has its own conversation',
  (select count(*)::int from messages where league_id = :'XL'), 1);

\o /dev/null
set role authenticated;
\o
