-- Waivers and free agency.
--
-- Two ways a roster changes outside a trade: a waiver claim, which competes
-- with other managers and is settled in priority order by a scheduled run; and
-- an open-market add, which is first come, first served. Which applies is the
-- league's waiverMode setting.
--
-- Everything that decides who gets a player is here rather than in a route,
-- because two managers claiming the same player in the same second must have
-- exactly one winner.

-- An open-market pickup is not a waiver claim — nobody competed for it — so
-- it is recorded as its own kind rather than being filed under 'waiver'.
alter table roster_slots
  drop constraint if exists roster_slots_acquired_check;

alter table roster_slots
  add constraint roster_slots_acquired_check
  check (acquired in ('draft', 'trade', 'waiver', 'add'));

-- Rolling waiver priority. Lower is better; winning a claim sends you last.
alter table managers
  add column if not exists waiver_priority int;

-- Seed priority by slot for a league that has none, so the order is defined
-- from the first claim rather than being null.
update managers m
   set waiver_priority = seq.rn
  from (
    select id, row_number() over (partition by league_id order by slot) as rn
      from managers
  ) seq
 where seq.id = m.id and m.waiver_priority is null;

create table waiver_claims (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  add_player text not null,
  -- What they will drop to make room. Null when the roster has space.
  drop_player text,
  -- A manager's own ordering across their claims: 1 is tried first.
  claim_order int not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'won', 'lost', 'cancelled')),
  reason text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (league_id, manager_id, add_player)
);

create index waiver_claims_pending_idx
  on waiver_claims (league_id, status, claim_order);

alter table waiver_claims enable row level security;

-- A manager sees and manages only their own claims: knowing what everyone else
-- has claimed before the run would defeat the point of a blind waiver period.
create policy claims_own on waiver_claims
  for all using (manager_id = (select id from current_manager()))
  with check (manager_id = (select id from current_manager()));

-- Every roster change, so "where did he go?" has an answer.
create table transactions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  manager_id uuid references managers(id) on delete set null,
  kind text not null,                    -- add | drop | waiver | trade | draft
  player_name text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index transactions_recent_idx on transactions (league_id, created_at desc);

alter table transactions enable row level security;

create policy transactions_read on transactions
  for select using (
    league_id = (select league_id from current_manager())
  );

/** How many players a roster holds, starters plus bench. IR sits outside it. */
create or replace function roster_capacity(p_settings jsonb)
returns int
language sql
immutable
as $$
  select coalesce(
           (select sum(value::int)::int from jsonb_each_text(coalesce(p_settings -> 'starters', '{}'::jsonb))),
           0
         )
       + coalesce((p_settings ->> 'bench')::int, 0);
$$;

/** How many a manager currently holds against that capacity. */
create or replace function roster_count(p_manager_id uuid)
returns int
language sql
stable
as $$
  select count(*)::int from roster_slots
   where manager_id = p_manager_id and lineup_slot is distinct from 'IR';
$$;

/**
 * Puts a player on a roster, dropping one if it is full.
 *
 * This is the mechanism with no opinion about who is asking: the waiver run
 * calls it for the winning manager, and add_player() calls it for the caller.
 * Keeping the authorisation out of here means the rule about who may act is
 * stated once, in add_player, rather than inferred from whether auth.uid()
 * happens to be set.
 *
 * The unique index on (league_id, player_name) is the backstop: if two adds
 * race, the second fails rather than the player landing on two rosters.
 */
create or replace function place_player(
  p_league_id uuid,
  p_manager_id uuid,
  p_add text,
  p_drop text default null,
  p_kind text default 'add'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league   leagues;
  v_capacity int;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from managers where id = p_manager_id and league_id = p_league_id
  ) then
    raise exception 'That manager is not in this league' using errcode = '42501';
  end if;

  if exists (
    select 1 from roster_slots where league_id = p_league_id and player_name = p_add
  ) then
    raise exception 'That player is already rostered' using errcode = '23505';
  end if;

  -- The drop happens first, so a full roster can take the incoming player.
  if p_drop is not null then
    delete from roster_slots
     where league_id = p_league_id and manager_id = p_manager_id and player_name = p_drop;

    if not found then
      raise exception 'You do not hold %', p_drop using errcode = 'P0002';
    end if;

    insert into transactions (league_id, manager_id, kind, player_name, detail)
    values (p_league_id, p_manager_id, 'drop', p_drop, jsonb_build_object('for', p_add));
  end if;

  v_capacity := roster_capacity(v_league.settings);
  if roster_count(p_manager_id) >= v_capacity then
    raise exception 'Your roster is full at % — drop someone first', v_capacity
      using errcode = '55000';
  end if;

  insert into roster_slots (league_id, manager_id, player_name, acquired, lineup_slot)
  values (p_league_id, p_manager_id, p_add, p_kind, 'BENCH');

  insert into transactions (league_id, manager_id, kind, player_name, detail)
  values (p_league_id, p_manager_id, p_kind, p_add, jsonb_build_object('dropped', p_drop));

  return jsonb_build_object('ok', true, 'added', p_add, 'dropped', p_drop);
end;
$$;

-- Nobody calls this directly: it does not check who is asking.
revoke all on function place_player(uuid, uuid, text, text, text) from public;

/** Adds a player to the signed-in manager's own roster. */
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
  v_me managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  return place_player(p_league_id, v_me.id, p_add, p_drop, 'add');
end;
$$;

revoke all on function add_player(uuid, text, text) from public;
grant execute on function add_player(uuid, text, text) to authenticated;

/** Drops a player outright. */
create or replace function drop_player(p_league_id uuid, p_player text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or v_me.league_id <> p_league_id then
    raise exception 'Not your league' using errcode = '42501';
  end if;

  delete from roster_slots
   where league_id = p_league_id and manager_id = v_me.id and player_name = p_player;

  if not found then
    raise exception 'You do not hold %', p_player using errcode = 'P0002';
  end if;

  insert into transactions (league_id, manager_id, kind, player_name)
  values (p_league_id, v_me.id, 'drop', p_player);

  return jsonb_build_object('ok', true, 'dropped', p_player);
end;
$$;

revoke all on function drop_player(uuid, text) from public;
grant execute on function drop_player(uuid, text) to authenticated;

/**
 * Settles every pending claim in the league.
 *
 * Rolling priority: the best-priority manager with a live claim wins it, then
 * drops to the bottom of the order, and the next claim is judged against the
 * new order. That is why this is a loop rather than one ordered pass — a
 * single pass would let the best-priority manager sweep every player.
 *
 * A claim whose player was taken, or whose drop is no longer held, loses with
 * a reason rather than failing the whole run.
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
  v_max      int;
  v_guard    int := 0;
begin
  loop
    -- The next claim to judge: best waiver priority first, then the manager's
    -- own ordering, then the order it was placed.
    select c.* into v_claim
      from waiver_claims c
      join managers m on m.id = c.manager_id
     where c.league_id = p_league_id
       and c.status = 'pending'
     order by m.waiver_priority, c.claim_order, c.created_at
     limit 1;

    exit when v_claim.id is null;

    -- Bounded so a bug here can never spin forever against a live database.
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

      -- Winning sends this manager to the back of the queue, and everyone
      -- below them moves up one.
      select max(waiver_priority) into v_max
        from managers where league_id = p_league_id;

      update managers
         set waiver_priority = waiver_priority - 1
       where league_id = p_league_id
         and waiver_priority > (
           select waiver_priority from managers where id = v_claim.manager_id
         );

      update managers set waiver_priority = v_max where id = v_claim.manager_id;

      v_won := v_won + 1;

    exception when others then
      update waiver_claims
         set status = 'lost', reason = sqlerrm, settled_at = now()
       where id = v_claim.id;
      v_lost := v_lost + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'won', v_won, 'lost', v_lost);
end;
$$;

revoke all on function process_waivers(uuid) from public;
