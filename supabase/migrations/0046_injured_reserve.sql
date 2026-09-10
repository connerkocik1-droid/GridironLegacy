-- Injured reserve that means injured reserve.
--
-- Three things were missing. A manager could not stash anybody from My Team at
-- all. A free agent on IR could not be picked up without spending one of the
-- eighteen roster spots on a man who will not play for months — which in a
-- best-ball league is eighteen players all of whom score every week, so the
-- spot is expensive. And nothing noticed when a stashed player was cleared to
-- play: he sat in the reserve indefinitely, off the books, which is a
-- nineteen-man roster with extra steps.
--
-- All three need one thing this database has never had: the injury report.
--
-- Until now fitness lived entirely at ESPN and reached the browser, and the
-- app was what refused to stash a fit player. That was fine while the rule was
-- cosmetic. It is not fine now: every function here is granted to
-- `authenticated`, so a browser holding a session can call them directly, and
-- a rule enforced only in a React component is a rule enforced only against
-- people who are not trying. The reserve is now a league rule, so it is stated
-- where the league is.

-- ---------------------------------------------------------- the report ---

alter table nfl_players
  add column if not exists injury_status text,
  add column if not exists injury_detail text,
  add column if not exists injury_synced_at timestamptz;

comment on column nfl_players.injury_status is
  'One of the five in src/lib/health.ts: active, questionable, out, ir, suspended. Null means the report has never mentioned him, which is the same as active.';

/**
 * Writes the injury report.
 *
 * Service key only, like sync_nfl_players: this is ESPN speaking, not a
 * manager, and a manager who could call it could clear his own bench.
 *
 * Everybody the report does not mention goes back to active. That sweep is the
 * point of the function — a player leaves the injury report by disappearing
 * from it, not by appearing on it with a cheerful word, so without the sweep
 * the reserve would only ever fill up.
 */
create or replace function sync_player_health(
  p_names    text[],
  p_statuses text[],
  p_details  text[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed int;
begin
  if coalesce(array_length(p_names, 1), 0) <> coalesce(array_length(p_statuses, 1), 0) then
    raise exception 'A name and a status for each, or neither' using errcode = '22023';
  end if;

  -- An empty report clears nobody. A failed fetch arrives here looking exactly
  -- like a league in perfect health, and acting on it would activate every
  -- stashed player in the league on the strength of somebody else's outage.
  if coalesce(array_length(p_names, 1), 0) = 0 then
    return 0;
  end if;

  create temporary table _report (name text primary key, status text, detail text)
    on commit drop;

  insert into _report (name, status, detail)
  select u.name, nullif(btrim(u.status), ''), nullif(btrim(u.detail), '')
    from unnest(p_names, p_statuses, coalesce(p_details, p_names)) as u(name, status, detail)
   where u.name is not null and length(btrim(u.name)) > 0
      on conflict (name) do nothing;

  update nfl_players p
     set injury_status = r.status,
         injury_detail = r.detail,
         injury_synced_at = now()
    from _report r
   where p.name = r.name
     and (p.injury_status is distinct from r.status
       or p.injury_detail is distinct from r.detail);

  get diagnostics v_changed = row_count;

  -- Off the report, back to fit.
  update nfl_players p
     set injury_status = null,
         injury_detail = null,
         injury_synced_at = now()
   where p.injury_status is not null
     and not exists (select 1 from _report r where r.name = p.name);

  return v_changed;
end;
$$;

revoke all on function sync_player_health(text[], text[], text[]) from public;

-- ------------------------------------------------------- who may be stashed ---

/**
 * May this player occupy a reserve slot?
 *
 * IR and suspension only. Both are absences measured in months, which is what
 * the reserve is for; questionable and out are absences measured in a week,
 * and a slot that holds those is a nineteenth roster spot that refreshes every
 * Sunday.
 *
 * False for a player nobody has heard of. The reserve is a concession and an
 * unprovable claim does not earn one — the failure that matters here is a
 * manager parking a fit player off the books, not a manager being told to use
 * a bench spot he already has.
 */
create or replace function ir_eligible(p_player text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.injury_status in ('ir', 'suspended') from nfl_players p where p.name = p_player),
    false);
$$;

revoke all on function ir_eligible(text) from public;
grant execute on function ir_eligible(text) to authenticated;

/**
 * How many the reserve holds, and how many are in it.
 */
create or replace function ir_capacity(p_settings jsonb)
returns int
language sql
immutable
as $$
  select coalesce((p_settings ->> 'ir')::int, 0);
$$;

create or replace function ir_count(p_manager_id uuid)
returns int
language sql
stable
as $$
  select count(*)::int from roster_slots
   where manager_id = p_manager_id and lineup_slot = 'IR';
$$;

-- ------------------------------------------------------------ the count ---

/**
 * How many a manager holds against the eighteen.
 *
 * The reserve sits outside the count, as it always has — but only while the
 * man in it belongs there. The moment the report says he is fit, questionable
 * or merely out for the week, he counts, and a manager already at eighteen is
 * over the limit until somebody is dropped.
 *
 * Deliberately arithmetic rather than a punishment. Nothing is deleted and no
 * move is specially forbidden: being over the limit means the next add is
 * refused by the same check that has always refused it, which is the rule
 * doing its job rather than a new rule about a returning player.
 */
create or replace function roster_count(p_manager_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from roster_slots r
   where r.manager_id = p_manager_id
     and (r.lineup_slot is distinct from 'IR' or not ir_eligible(r.player_name));
$$;

/**
 * The stashed players the report says are fit again.
 *
 * What the app shows a manager who is over the limit, so the message can name
 * the man rather than saying the roster is wrong somewhere.
 */
create or replace function ir_returns(p_manager_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select r.player_name
    from roster_slots r
   where r.manager_id = p_manager_id
     and r.lineup_slot = 'IR'
     and not ir_eligible(r.player_name)
   order by r.player_name;
$$;

revoke all on function ir_returns(uuid) from public;
grant execute on function ir_returns(uuid) to authenticated;

-- -------------------------------------------------------- stash and back ---

/**
 * Stashing a player already held, or bringing him back.
 *
 * As 0036 left it, with two changes. Eligibility is checked here now rather
 * than only in the browser. And coming back needs room only when he was not
 * already counting: a player the report has cleared is on the books whichever
 * slot he is sitting in, so moving him to the bench changes nothing and must
 * not be refused for a fullness he is himself part of.
 */
create or replace function set_injured_reserve(p_player text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_settings jsonb;
  v_was_ir   boolean;
begin
  select * into v_me from current_manager();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select settings into v_settings from leagues where id = v_me.league_id;

  select lineup_slot = 'IR'
    into v_was_ir
    from roster_slots
   where manager_id = v_me.id and player_name = p_player;

  if v_was_ir is null then
    raise exception 'You do not hold %', p_player using errcode = 'P0002';
  end if;

  if p_on then
    if not ir_eligible(p_player) then
      raise exception 'The reserve is for players on IR or suspended — % is not'
        , p_player using errcode = '55000';
    end if;

    if ir_count(v_me.id) - (case when v_was_ir then 1 else 0 end)
       >= ir_capacity(v_settings) then
      raise exception 'Injured reserve holds %', ir_capacity(v_settings)
        using errcode = '55000';
    end if;

    update roster_slots
       set lineup_slot = 'IR'
     where manager_id = v_me.id and player_name = p_player;
  else
    if v_was_ir and ir_eligible(p_player)
       and roster_count(v_me.id) >= roster_capacity(v_settings) then
      raise exception 'Your roster is full at % — drop someone first',
        roster_capacity(v_settings) using errcode = '55000';
    end if;

    update roster_slots
       set lineup_slot = 'BENCH'
     where manager_id = v_me.id and player_name = p_player;
  end if;

  return jsonb_build_object('ok', true, 'player', p_player, 'ir', p_on);
end;
$$;

grant execute on function set_injured_reserve(text, boolean) to authenticated;

-- ------------------------------------------------ picking one up onto IR ---

/**
 * Signing a free agent straight into the reserve.
 *
 * The one addition that does not cost a roster spot, and the reason it is safe
 * to allow: the man cannot play. He is on IR or suspended, he will be for
 * months, and the whole transaction is a bet on next season. Charging a
 * best-ball roster spot for that bet is charging eighteen weeks of scoring for
 * a player who scores nothing — so nobody makes it, and a class of perfectly
 * reasonable dynasty move simply never happens.
 *
 * Everything else about an add still applies: waivers, the kickoff lock, and
 * the reserve's own size. And the moment he is cleared to play he counts
 * against the eighteen like everybody else, which is what stops this being a
 * back door to a larger roster.
 */
create or replace function add_player_to_ir(p_league_id uuid, p_player text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       managers;
  v_settings jsonb;
  v_clears   timestamptz;
  v_block    text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  if not ir_eligible(p_player) then
    raise exception 'Only a player on IR or suspended can be signed to the reserve'
      using errcode = '55000';
  end if;

  v_block := move_block(p_league_id, p_player, 'picked up');
  if v_block is not null then
    raise exception '%', v_block using errcode = '55000';
  end if;

  if waiver_mode(p_league_id) = 'all' then
    raise exception 'Every pickup in this league goes through waivers — place a claim'
      using errcode = '55000';
  end if;

  select clears_at into v_clears
    from waiver_wire where league_id = p_league_id and player_name = p_player;
  if v_clears is not null then
    raise exception '% is on waivers — place a claim instead', p_player
      using errcode = '55000';
  end if;

  if exists (
    select 1 from roster_slots where league_id = p_league_id and player_name = p_player
  ) then
    raise exception 'That player is already rostered' using errcode = '23505';
  end if;

  select settings into v_settings from leagues where id = p_league_id for update;

  if ir_count(v_me.id) >= ir_capacity(v_settings) then
    raise exception 'Injured reserve holds %', ir_capacity(v_settings)
      using errcode = '55000';
  end if;

  insert into roster_slots (league_id, manager_id, player_name, acquired, lineup_slot)
  values (p_league_id, v_me.id, p_player, 'add', 'IR');

  delete from waiver_wire where league_id = p_league_id and player_name = p_player;

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  values (p_league_id, v_me.id, 'add', p_player, jsonb_build_object('ir', true));

  return jsonb_build_object('ok', true, 'added', p_player, 'ir', true);
end;
$$;

revoke all on function add_player_to_ir(uuid, text) from public;
grant execute on function add_player_to_ir(uuid, text) to authenticated;
