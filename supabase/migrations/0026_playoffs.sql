-- The season gets an ending.
--
-- generate_schedule built a regular season and stopped. The matchups table has
-- carried a `playoff` flag since 0008 and nothing has ever set it, so a league
-- that reached the last week of the round robin simply ran out of fixtures.
-- Twelve people play sixteen weeks and then the site has nothing to say.
--
-- What is here:
--
--   * Seeds, taken once and written down. Division winners first, then the
--     best of the rest. Stored rather than recomputed, because a week that is
--     regraded in December must not re-seed a bracket already being played.
--   * A bracket built one round at a time, from the teams still alive. Byes
--     fall to the top seeds when the field is not a power of two, and each
--     round reseeds — the best team left plays the worst team left.
--   * A champion, recorded against the season so a dynasty has a record book.
--   * Next year's draft order, which now knows about all of it: the teams that
--     missed the playoffs pick first by record, then the teams that made them
--     in the order they went out, and the champion picks last.
--
-- Rounds are driven from the field rather than from a setting. playoffWeeks
-- was in the seed and decided nothing; a six-team field needs three weeks and
-- a four-team field needs two, and the schedule has always been the thing that
-- writes its own length back to the settings.

-- Which round a playoff fixture belongs to. Null for the regular season, so
-- the column says what it means rather than defaulting to a round nobody is in.
alter table matchups add column if not exists playoff_round int;

create index if not exists matchups_playoff_idx
  on matchups (league_id, playoff_round) where playoff;

/**
 * The bracket, once it is drawn.
 *
 * Seeds are a fact about the season that produced them, so they are keyed by
 * season and survive into the next one. Nothing recomputes them: a regrade in
 * week fifteen changes the standings, and must not change a bracket that is
 * already being played.
 */
create table if not exists playoff_seeds (
  league_id  uuid not null references leagues(id) on delete cascade,
  season     int  not null,
  seed       int  not null,
  manager_id uuid not null references managers(id) on delete cascade,
  primary key (league_id, season, seed),
  unique (league_id, season, manager_id)
);

alter table playoff_seeds enable row level security;

drop policy if exists playoff_seeds_read on playoff_seeds;
create policy playoff_seeds_read on playoff_seeds
  for select using (league_id = (select league_id from current_manager()));

grant select on playoff_seeds to authenticated;

/** Who won each season. The record book a dynasty is played for. */
create table if not exists league_champions (
  league_id  uuid not null references leagues(id) on delete cascade,
  season     int  not null,
  manager_id uuid references managers(id) on delete set null,
  -- The name at the time, so a title survives a franchise being renamed or
  -- handed to somebody else years later.
  franchise  text not null,
  decided_at timestamptz not null default now(),
  primary key (league_id, season)
);

alter table league_champions enable row level security;

drop policy if exists champions_read on league_champions;
create policy champions_read on league_champions
  for select using (league_id = (select league_id from current_manager()));

grant select on league_champions to authenticated;

-- ------------------------------------------------------------- the field ---

/** How many franchises make the playoffs. */
create or replace function playoff_field(p_league_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(2, least(
    coalesce((l.settings ->> 'playoffTeams')::int, 6),
    (select count(*)::int from managers where league_id = p_league_id)
  ))
  from leagues l where l.id = p_league_id;
$$;

revoke all on function playoff_field(uuid) from public;
grant execute on function playoff_field(uuid) to authenticated;

/**
 * How many rounds a field of that size takes.
 *
 * Not a setting. Six teams is three weekends and four teams is two, and a
 * number in the settings that disagreed with the bracket would be a number
 * that was simply wrong.
 */
create or replace function playoff_rounds(p_teams int)
returns int
language sql
immutable
as $$
  select greatest(1, ceil(log(2, greatest(p_teams, 2)::numeric))::int);
$$;

/** The last week of the regular season, from the fixtures rather than a setting. */
create or replace function regular_season_weeks(p_league_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select max(week) from matchups where league_id = p_league_id and not playoff),
    0
  );
$$;

revoke all on function regular_season_weeks(uuid) from public;
grant execute on function regular_season_weeks(uuid) to authenticated;

-- ------------------------------------------------------------- the seeds ---

/**
 * Who is in, and in what order, computed from the table as it stands.
 *
 * Division winners take the top seeds — winning the division is the thing a
 * division is for — and the rest of the field is the best records left over,
 * whichever divisions they come from.
 *
 * Ranked on win percentage rather than wins, so a franchise that has had a bye
 * week is not punished for having played fewer games; points scored breaks the
 * tie, and the franchise slot breaks that, so the answer is never random.
 *
 * This is a calculation, not a decision. start_playoffs is what writes it down.
 */
create or replace function seeding(p_league_id uuid)
returns table (seed int, manager_id uuid, division text, is_division_winner boolean)
language sql
stable
security definer
set search_path = public
as $$
  with rated as (
    select s.manager_id, s.slot, s.division,
           case when s.wins + s.losses + s.ties = 0 then 0
                else (s.wins + s.ties * 0.5)::numeric / (s.wins + s.losses + s.ties)
           end as pct,
           s.points_for
      from standings(p_league_id) s
  ),
  ranked as (
    select r.*,
           row_number() over (
             partition by r.division order by r.pct desc, r.points_for desc, r.slot asc
           ) = 1 as winner
      from rated r
  )
  select row_number() over (
           -- Division winners first, then everybody else; within each group,
           -- the better season.
           order by ranked.winner desc, ranked.pct desc, ranked.points_for desc, ranked.slot asc
         )::int,
         ranked.manager_id,
         ranked.division,
         ranked.winner
    from ranked;
$$;

revoke all on function seeding(uuid) from public;
grant execute on function seeding(uuid) to authenticated;

-- ----------------------------------------------------------- the bracket ---

/**
 * Everybody still alive, best seed first.
 *
 * A team is out when it has lost a playoff game that has been graded. Anything
 * else is still in — which is what makes a bye need no special case at all: a
 * franchise that did not play in round one has not lost, so it is simply still
 * here in round two.
 *
 * A drawn playoff game is not a draw. The better seed goes through, which is
 * the ordinary rule everywhere and the only one that does not need a replay.
 */
create or replace function playoff_survivors(p_league_id uuid, p_season int)
returns table (seed int, manager_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with played as (
    select m.home_manager, m.away_manager, m.winner,
           h.seed as home_seed, a.seed as away_seed
      from matchups m
      join playoff_seeds h
        on h.league_id = m.league_id and h.season = p_season and h.manager_id = m.home_manager
      join playoff_seeds a
        on a.league_id = m.league_id and a.season = p_season and a.manager_id = m.away_manager
     where m.league_id = p_league_id and m.playoff and m.final
  ),
  losers as (
    select case
             when winner is not null then
               case when winner = home_manager then away_manager else home_manager end
             when home_seed < away_seed then away_manager
             else home_manager
           end as manager_id
      from played
  )
  select s.seed, s.manager_id
    from playoff_seeds s
   where s.league_id = p_league_id
     and s.season = p_season
     and s.manager_id not in (select manager_id from losers)
   order by s.seed;
$$;

revoke all on function playoff_survivors(uuid, int) from public;
grant execute on function playoff_survivors(uuid, int) to authenticated;

/**
 * Draws one round from the teams still standing.
 *
 * Highest plays lowest, which is the reseed: winning as the third seed should
 * be worth an easier opponent than winning as the sixth, and a bracket that
 * does not reseed throws that away.
 *
 * When the field is not a power of two the top seeds sit the first round out.
 * The number of byes is exactly what it takes to make the next round a power
 * of two, so the bracket only ever needs them once.
 */
create or replace function draw_playoff_round(p_league_id uuid, p_season int, p_round int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alive  uuid[];
  v_seeds  int[];
  v_n      int;
  v_byes   int := 0;
  v_week   int;
  v_lo     int;
  v_hi     int;
  v_made   int := 0;
begin
  select array_agg(manager_id order by seed), array_agg(seed order by seed)
    into v_alive, v_seeds
    from playoff_survivors(p_league_id, p_season);

  v_n := coalesce(array_length(v_alive, 1), 0);
  if v_n < 2 then return 0; end if;

  -- Only the first round can carry byes: after it the field is a power of two
  -- by construction.
  if p_round = 1 then
    v_byes := power(2, playoff_rounds(v_n))::int - v_n;
  end if;

  v_week := regular_season_weeks(p_league_id) + p_round;

  -- The seeds that sit out are the top v_byes of them; the rest pair off from
  -- the outside in.
  v_lo := v_byes + 1;
  v_hi := v_n;

  while v_lo < v_hi loop
    insert into matchups (league_id, week, home_manager, away_manager,
                          playoff, playoff_round, divisional)
    values (p_league_id, v_week, v_alive[v_lo], v_alive[v_hi], true, p_round, false)
    on conflict do nothing;
    v_made := v_made + 1;
    v_lo := v_lo + 1;
    v_hi := v_hi - 1;
  end loop;

  return v_made;
end;
$$;

revoke all on function draw_playoff_round(uuid, int, int) from public;

/**
 * Seeds the bracket and draws the first round.
 *
 * Refuses until the regular season is actually over — every week of it graded
 * — because a bracket drawn from an unfinished table is a bracket drawn from
 * the wrong table. Does nothing at all if the seeds are already down, so it is
 * safe to call every night.
 */
create or replace function start_playoffs(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league leagues;
  v_weeks  int;
  v_field  int;
  v_drawn  int;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  if exists (select 1 from playoff_seeds
              where league_id = p_league_id and season = v_league.season) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_weeks := regular_season_weeks(p_league_id);
  if v_weeks = 0 then
    raise exception 'There is no schedule to finish' using errcode = '55000';
  end if;

  if exists (select 1 from matchups
              where league_id = p_league_id and not playoff and not final) then
    raise exception 'The regular season is not over yet' using errcode = '55000';
  end if;

  v_field := playoff_field(p_league_id);

  insert into playoff_seeds (league_id, season, seed, manager_id)
  select p_league_id, v_league.season, s.seed, s.manager_id
    from seeding(p_league_id) s
   where s.seed <= v_field;

  v_drawn := draw_playoff_round(p_league_id, v_league.season, 1);

  -- The bracket decides how long the postseason is, the same way the round
  -- robin decides how long the regular season is.
  update leagues
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{playoffWeeks}',
                              to_jsonb(playoff_rounds(v_field)))
   where id = p_league_id;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, null, 'playoffs_started',
          jsonb_build_object('season', v_league.season, 'field', v_field,
                             'rounds', playoff_rounds(v_field), 'games', v_drawn));

  return jsonb_build_object('ok', true, 'field', v_field,
                            'rounds', playoff_rounds(v_field), 'games', v_drawn);
end;
$$;

revoke all on function start_playoffs(uuid) from public;

/**
 * Moves the postseason on by whatever it is owed.
 *
 * Called nightly after the scores are graded, and safe to call at any other
 * time: it starts the playoffs if the regular season has just ended, draws the
 * next round if the last one is complete, and records the champion when one
 * team is left. If none of that is true it does nothing and says so.
 */
create or replace function advance_playoffs(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league   leagues;
  v_round    int;
  v_pending  int;
  v_alive    int;
  v_champion uuid;
  v_name     text;
  v_drawn    int;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'No such league' using errcode = 'P0002';
  end if;

  -- Nothing to do until the last regular-season week is graded.
  if not exists (select 1 from playoff_seeds
                  where league_id = p_league_id and season = v_league.season) then
    if regular_season_weeks(p_league_id) = 0
       or exists (select 1 from matchups
                   where league_id = p_league_id and not playoff and not final) then
      return jsonb_build_object('ok', true, 'state', 'regular season');
    end if;
    return start_playoffs(p_league_id) || jsonb_build_object('state', 'started');
  end if;

  if exists (select 1 from league_champions
              where league_id = p_league_id and season = v_league.season) then
    return jsonb_build_object('ok', true, 'state', 'decided');
  end if;

  select coalesce(max(playoff_round), 0) into v_round
    from matchups where league_id = p_league_id and playoff;

  select count(*) into v_pending
    from matchups
   where league_id = p_league_id and playoff and playoff_round = v_round and not final;

  if v_pending > 0 then
    return jsonb_build_object('ok', true, 'state', 'playing', 'round', v_round);
  end if;

  select count(*) into v_alive from playoff_survivors(p_league_id, v_league.season);

  if v_alive <= 1 then
    select ps.manager_id into v_champion
      from playoff_survivors(p_league_id, v_league.season) ps limit 1;

    select franchise into v_name from managers where id = v_champion;

    insert into league_champions (league_id, season, manager_id, franchise)
    values (p_league_id, v_league.season, v_champion, coalesce(v_name, 'Unknown'))
    on conflict (league_id, season) do nothing;

    insert into admin_log (league_id, actor, action, detail)
    values (p_league_id, null, 'champion',
            jsonb_build_object('season', v_league.season, 'franchise', v_name));

    return jsonb_build_object('ok', true, 'state', 'champion', 'franchise', v_name);
  end if;

  v_drawn := draw_playoff_round(p_league_id, v_league.season, v_round + 1);
  return jsonb_build_object('ok', true, 'state', 'drawn',
                            'round', v_round + 1, 'games', v_drawn);
end;
$$;

revoke all on function advance_playoffs(uuid) from public;

-- ---------------------------------------------------------- picking again ---

/**
 * Next season's draft order, re-emitted from 0021 now that a season can end.
 *
 * The rule everybody knows: the teams that missed the playoffs pick first,
 * worst record first; then the teams that made them, in the order they went
 * out; and the champion picks last. Before a bracket exists this is exactly
 * what 0021 did, because every franchise is then equally "not in the
 * playoffs" and the record is all there is to sort on.
 */
create or replace function set_draft_pick_order(p_league_id uuid, p_season int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season  int;
  v_touched int;
begin
  -- The season the standings describe, which is the one being played now, not
  -- the draft the picks are for.
  select season into v_season from leagues where id = p_league_id;

  with knocked as (
    -- The last round each franchise was still alive for. A team that never
    -- made the bracket has none, and sorts ahead of everybody who did.
    select s.manager_id,
           coalesce(max(m.playoff_round), 0) as reached
      from playoff_seeds s
      left join matchups m
        on m.league_id = s.league_id and m.playoff
       and (m.home_manager = s.manager_id or m.away_manager = s.manager_id)
     where s.league_id = p_league_id and s.season = v_season
     group by s.manager_id
  ),
  ranked as (
    select s.manager_id,
           row_number() over (
             order by
               -- Everyone who missed the playoffs first.
               (k.manager_id is not null) asc,
               -- Then how far the rest got.
               coalesce(k.reached, 0) asc,
               -- The champion is the one who won the last round, and sorts
               -- behind the team they beat in it.
               (c.manager_id is not null) asc,
               -- Within a group, the worse season picks earlier. Win
               -- percentage rather than wins, so a bye week is not a penalty;
               -- points scored breaks the tie, because two 4-9 teams are not
               -- equally bad; the slot breaks that, so a board with nothing
               -- graded is stable rather than reshuffled nightly.
               case when s.wins + s.losses + s.ties = 0 then 0
                    else (s.wins + s.ties * 0.5)::numeric
                           / (s.wins + s.losses + s.ties)
               end asc,
               s.points_for asc,
               s.slot asc
           )::int as position
      from standings(p_league_id) s
      left join knocked k on k.manager_id = s.manager_id
      left join league_champions c
        on c.league_id = p_league_id and c.season = v_season
       and c.manager_id = s.manager_id
  )
  update draft_pick_assets a
     set slot = r.position
    from ranked r
   where a.league_id = p_league_id
     and a.season = p_season
     and a.origin_manager = r.manager_id
     and a.slot is distinct from r.position;

  get diagnostics v_touched = row_count;
  return v_touched;
end;
$$;

revoke all on function set_draft_pick_order(uuid, int) from public;

-- ------------------------------------------------------------ the resets ---
-- A league reset unmakes the season, and a season that never happened has no
-- bracket and no champion.

create or replace function reset_league(
  p_league_id uuid,
  p_release_franchises boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        managers;
  v_players   int;
  v_weeks     int;
  v_played    int;
  v_released  int := 0;
  v_saved     int;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null or not v_me.is_commissioner or v_me.league_id <> p_league_id then
    raise exception 'Only the commissioner can reset the league' using errcode = '42501';
  end if;

  select count(*) into v_players from roster_slots where league_id = p_league_id;
  select count(distinct week) into v_weeks from matchups where league_id = p_league_id;
  select count(*) into v_played from matchups where league_id = p_league_id and final;

  v_saved := snapshot_rosters(p_league_id, 'league_reset');

  delete from roster_slots     where league_id = p_league_id;
  delete from matchups         where league_id = p_league_id;
  delete from player_scores    where league_id = p_league_id;
  delete from transactions     where league_id = p_league_id;
  delete from waiver_claims    where league_id = p_league_id;
  delete from waiver_wire      where league_id = p_league_id;
  delete from trades           where league_id = p_league_id;
  delete from trade_block      where league_id = p_league_id;
  delete from draft_queue      where league_id = p_league_id;
  delete from pickem_picks     where league_id = p_league_id;
  delete from playoff_seeds    where league_id = p_league_id;
  delete from league_champions where league_id = p_league_id;

  update managers m
     set waiver_priority = seq.rn,
         ready = false
    from (
      select id, row_number() over (order by slot) as rn
        from managers where league_id = p_league_id
    ) seq
   where seq.id = m.id;

  if p_release_franchises then
    update managers
       set pin_hash = null,
           auth_user_id = null,
           name = 'Open'
     where league_id = p_league_id
       and not is_commissioner;
    get diagnostics v_released = row_count;
  end if;

  delete from draft_picks where league_id = p_league_id;
  perform rebuild_draft_board(p_league_id);

  update leagues
     set draft_state = 'pending',
         current_pick = 1,
         pick_started_at = null,
         lottery_order = null
   where id = p_league_id;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, v_me.id, 'league_reset',
          jsonb_build_object('players_returned', v_players,
                             'weeks_removed', v_weeks,
                             'weeks_played', v_played,
                             'franchises_released', v_released,
                             'roster_rows_saved', v_saved));

  return jsonb_build_object(
    'ok', true,
    'playersReturned', v_players,
    'weeksRemoved', v_weeks,
    'weeksPlayed', v_played,
    'franchisesReleased', v_released,
    'rosterRowsSaved', v_saved
  );
end;
$$;

revoke all on function reset_league(uuid, boolean) from public;
grant execute on function reset_league(uuid, boolean) to authenticated;
