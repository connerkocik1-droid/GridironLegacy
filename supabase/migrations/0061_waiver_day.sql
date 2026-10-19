-- Tuesday belongs to the waiver wire, and the order is last week's table
-- upside down.
--
-- Two things were missing from the league's waivers and one was only half
-- there.
--
-- A player nobody had ever rostered could be added at any hour of any day,
-- including the morning after the week ended — so the manager who happened to
-- be awake at seven on Tuesday got the week's best free agent, and everybody
-- else got a notification about it. Now Tuesday is a claim day: adds are
-- refused, claims are taken all day, and they settle together at the end of
-- it. Every other day is unchanged, and so is the wire a mid-week drop goes
-- on — the two live side by side, which is what makes a Sunday drop still
-- unsnipeable.
--
-- The order those claims settle in was a rolling queue seeded once at the
-- start of the league. It is now the immediately preceding week's scores,
-- lowest first, reseeded on the first run of each new week. Winning still
-- sends a manager to the back for the rest of that run, so one bad week does
-- not hand somebody the whole wire.
--
-- And the third thing was already built: waiver_claims has carried a
-- claim_order since 0007 and process_waivers has always honoured it. What it
-- never had was a way for anybody to set it. That part is UI, not schema.

-- ------------------------------------------------------------- the clock ---

/**
 * When Tuesday is, for this league.
 *
 * A stored zone rather than the server's, because the server's is UTC and a
 * waiver day that begins at seven in the evening is not Tuesday to anybody.
 * Eastern by default: it is the league's own clock and the one the NFL
 * schedule is written in.
 */
create or replace function league_clock(p_league_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(settings ->> 'timezone', ''),
    'America/New_York'
  ) from leagues where id = p_league_id;
$$;

/**
 * Which day of the week is the claim day. 0 is Sunday, 2 is Tuesday.
 *
 * A setting so a league can move it or switch it off — -1 means no claim day
 * at all, and every day behaves the way every day did before this migration.
 */
create or replace function waiver_dow(p_league_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((settings ->> 'waiverDay')::int, 2)
    from leagues where id = p_league_id;
$$;

/** Is it the claim day right now, on the league's own clock? */
create or replace function waiver_day(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when waiver_dow(p_league_id) < 0 then false
    else extract(dow from (now() at time zone league_clock(p_league_id)))::int
         = waiver_dow(p_league_id)
  end;
$$;

/**
 * The moment today's claims are judged, or null when today is not a claim day.
 *
 * The last second of the claim day on the league's clock. Carried on the claim
 * itself rather than worked out by the run, for the same reason the wire
 * carries its own clearing time: how punctual the run is then decides how
 * quickly a claim is settled, never whether it is settled at the right time.
 * A run at four in the morning must not judge claims the league still has all
 * day to place.
 */
create or replace function waiver_window_close(p_league_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case when waiver_day(p_league_id) then
    (
      (date_trunc('day', now() at time zone league_clock(p_league_id))
        + interval '1 day' - interval '1 second')
      at time zone league_clock(p_league_id)
    )
  end;
$$;

grant execute on function league_clock(uuid) to authenticated;
grant execute on function waiver_dow(uuid) to authenticated;
grant execute on function waiver_day(uuid) to authenticated;
grant execute on function waiver_window_close(uuid) to authenticated;

-- -------------------------------------------------------------- the order ---

-- Which week the standing order was built from. Null in a league that has
-- never run one, which is every league until the first Tuesday.
alter table leagues add column if not exists waiver_priority_week int;

/**
 * What each manager scored in one week.
 *
 * The graded matchup where there is one, and the live lineup where the week
 * has not been graded yet — the same pair season_points_for works from, for
 * the same reason: a week still being played has no matchup number, and a
 * manager with nothing scored is still a row, at nought. Missing from the
 * answer would mean missing from the order.
 */
create or replace function week_points(p_league_id uuid, p_week int)
returns table (manager_id uuid, points numeric)
language sql
stable
security definer
set search_path = public
as $$
  select mg.id,
         round(coalesce(
           (select sum(x.points) from (
              select m.home_points as points
                from matchups m
               where m.league_id = p_league_id and m.week = p_week
                 and m.final and m.home_manager = mg.id
              union all
              select m.away_points
                from matchups m
               where m.league_id = p_league_id and m.week = p_week
                 and m.final and m.away_manager = mg.id
            ) x),
           lineup_points(p_league_id, mg.id, p_week),
           0), 1)
    from managers mg
   where mg.league_id = p_league_id;
$$;

grant execute on function week_points(uuid, int) to authenticated;

/**
 * Rebuilds the claim order from one week's scores: lowest scorer first.
 *
 * Ties break on franchise slot, so the order is total and the same every time
 * it is computed — two managers on nought in week one must not swap places
 * between one run and the next.
 *
 * Returns how many managers were ordered, which is zero when the week has no
 * scores to order them by. That is week one, and the league keeps whatever
 * order it already had rather than being shuffled into a meaningless one.
 */
create or replace function seed_waiver_priority(p_league_id uuid, p_week int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scored int;
  v_count  int;
begin
  if p_week is null or p_week < 1 then return 0; end if;

  -- A week nobody scored in is not an order. Without this, the first Tuesday
  -- of a season would sort twelve zeroes by slot and call it the standings.
  select count(*) into v_scored
    from week_points(p_league_id, p_week) wp where wp.points > 0;
  if v_scored = 0 then return 0; end if;

  update managers m
     set waiver_priority = r.rn
    from (
      select wp.manager_id,
             row_number() over (order by wp.points asc, mg.slot asc) as rn
        from week_points(p_league_id, p_week) wp
        join managers mg on mg.id = wp.manager_id
    ) r
   where m.id = r.manager_id;
  get diagnostics v_count = row_count;

  update leagues set waiver_priority_week = p_week where id = p_league_id;
  return v_count;
end;
$$;

revoke all on function seed_waiver_priority(uuid, int) from public;

-- ------------------------------------------------------------- the claims ---

-- When this claim is judged. Null for a claim placed outside a claim day,
-- which is judged the moment its player leaves the wire, exactly as before.
alter table waiver_claims add column if not exists settles_at timestamptz;

create index if not exists waiver_claims_settles_idx
  on waiver_claims (league_id, status, settles_at);

/**
 * Stamps a claim with the close of the window it was placed in.
 *
 * A trigger rather than a column default, and certainly rather than the
 * caller: claims are inserted straight through PostgREST by the browser, so
 * anything the client can set is a thing the client can set to last Tuesday.
 */
create or replace function stamp_claim_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.settles_at := waiver_window_close(new.league_id);
  return new;
end;
$$;

drop trigger if exists waiver_claims_window on waiver_claims;
create trigger waiver_claims_window
  before insert on waiver_claims
  for each row execute function stamp_claim_window();

-- ---------------------------------------------------------------- the run ---

/**
 * Settles the claims that are ripe and releases the players nobody won.
 *
 * Two changes from 0028, which is the version this is built on — not 0024's,
 * which is the same function without the notices, and copying that one back
 * over the top would have taken them away again. The order is reseeded from
 * the previous week's scores on the first run of a new week, and a claim
 * placed during a claim day is not judged until that day is over.
 *
 * Everything else is as it was: best priority first, then the manager's own
 * ordering, then the order the claims were placed; a win sends that manager to
 * the back and moves everyone below them up; a claim that cannot be applied is
 * lost with the reason on it rather than taking the run down.
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
  v_week     int;
  v_seeded   int := 0;
  v_last     int;
begin
  -- The order, before anything is judged against it. The week that just ended
  -- is the one before the one being played, and it is seeded once per week: a
  -- second run must not undo the demotions the first one applied.
  v_week := current_week(p_league_id) - 1;
  select waiver_priority_week into v_last from leagues where id = p_league_id;
  if v_week >= 1 and v_last is distinct from v_week then
    v_seeded := seed_waiver_priority(p_league_id, v_week);
  end if;

  loop
    select c.* into v_claim
      from waiver_claims c
      join managers m on m.id = c.manager_id
      left join waiver_wire w
        on w.league_id = c.league_id and w.player_name = c.add_player
     where c.league_id = p_league_id
       and c.status = 'pending'
       and (w.player_name is null or w.clears_at <= now())
       -- A claim placed on a claim day waits for the day to be over, however
       -- often the run happens in between.
       and (c.settles_at is null or c.settles_at <= now())
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
                            'cleared', v_cleared, 'stillOnWaivers', v_held,
                            'reordered', v_seeded, 'orderFromWeek', v_week);
end;
$$;

revoke all on function process_waivers(uuid) from public;

-- ----------------------------------------------------------- the adds ---
-- Both routes onto a roster refuse on a claim day. Reproduced whole, because
-- a create-or-replace has to carry the entire body — and each from the LAST
-- migration that defined it rather than the one that introduced it. 0045 put
-- the game-time lock into add_player and 0060 widened add_player_to_ir; taking
-- 0024's copies would have quietly undone both. place_player is untouched: the
-- run calls it all day, and it is the thing that puts a won claim on a roster.

create or replace function add_player(
  p_league_id uuid,
  p_add text,
  p_drop text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     managers;
  v_clears timestamptz;
  v_block  text;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  -- Kickoff closes the roster. Both halves of the move are checked: an add
  -- that also drops somebody is two moves, and only one of them was named in
  -- the request.
  v_block := coalesce(
    move_block(p_league_id, p_add, 'picked up'),
    move_block(p_league_id, p_drop, 'dropped'));
  if v_block is not null then
    raise exception '%', v_block using errcode = '55000';
  end if;

  if waiver_day(p_league_id) then
    raise exception 'It is waiver day in this league — place a claim instead'
      using errcode = '55000';
  end if;

  -- And between the window closing and the run settling it, which is however
  -- long the run takes to come round. Without this the claim day leaks at the
  -- far end: at one in the morning it is no longer the claim day, so an add is
  -- allowed, and the player half the league queued for at noon goes to whoever
  -- was awake — the exact thing the day exists to stop. A claim stops blocking
  -- the moment it is settled, won or lost.
  if exists (
    select 1 from waiver_claims
     where league_id = p_league_id
       and add_player = p_add
       and status = 'pending'
       and settles_at is not null
  ) then
    raise exception '% has claims on him waiting to be settled', p_add
      using errcode = '55000';
  end if;

  if waiver_mode(p_league_id) = 'all' then
    raise exception 'Every pickup in this league goes through waivers — place a claim'
      using errcode = '55000';
  end if;

  select clears_at into v_clears
    from waiver_wire where league_id = p_league_id and player_name = p_add;

  if v_clears is not null then
    raise exception '% is on waivers — place a claim instead', p_add
      using errcode = '55000';
  end if;

  return place_player(p_league_id, v_me.id, p_add, p_drop, 'add');
end;
$$;

revoke all on function add_player(uuid, text, text) from public;
grant execute on function add_player(uuid, text, text) to authenticated;

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
    raise exception 'Only a player out, on IR or suspended can be signed to the reserve'
      using errcode = '55000';
  end if;

  v_block := move_block(p_league_id, p_player, 'picked up');
  if v_block is not null then
    raise exception '%', v_block using errcode = '55000';
  end if;

  if waiver_day(p_league_id) then
    raise exception 'It is waiver day in this league — place a claim instead'
      using errcode = '55000';
  end if;

  -- And between the window closing and the run settling it, which is however
  -- long the run takes to come round. Without this the claim day leaks at the
  -- far end: at one in the morning it is no longer the claim day, so an add is
  -- allowed, and the player half the league queued for at noon goes to whoever
  -- was awake — the exact thing the day exists to stop. A claim stops blocking
  -- the moment it is settled, won or lost.
  if exists (
    select 1 from waiver_claims
     where league_id = p_league_id
       and add_player = p_player
       and status = 'pending'
       and settles_at is not null
  ) then
    raise exception '% has claims on him waiting to be settled', p_player
      using errcode = '55000';
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

-- -------------------------------------------------------- the manager's own ---

/**
 * The order a manager wants their own claims tried in.
 *
 * claim_order has been on the table since 0007 and process_waivers has always
 * honoured it. Nothing has ever set it: every claim was placed at 1, so a
 * manager with three claims and room for one got whichever the tie-break
 * happened to reach first. This is the missing half.
 *
 * One statement rather than a row at a time, because a reorder that half
 * applies leaves two claims fighting over the same rank. Ownership is checked
 * here rather than trusted from the caller — an id belonging to somebody else
 * simply matches nothing, and the count that comes back says how many of the
 * ids were really theirs.
 */
create or replace function reorder_claims(p_league_id uuid, p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me managers;
  v_n  int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  update waiver_claims c
     set claim_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where c.id = o.id
     and c.manager_id = v_me.id
     and c.league_id = p_league_id
     and c.status = 'pending';

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function reorder_claims(uuid, uuid[]) from public;
grant execute on function reorder_claims(uuid, uuid[]) to authenticated;
