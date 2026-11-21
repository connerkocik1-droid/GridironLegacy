-- A postseason with a winners bracket and a losers bracket.
--
-- The league plays ten. The old postseason took a field of six and left four
-- out entirely — a league rule that made sense when "the playoffs" meant one
-- bracket, and does not any more: every franchise now plays in one of two,
-- the top four for the title and the other six for where they finish among
-- themselves. Both decide something — the winners bracket a champion, the
-- losers bracket next year's draft order among the bottom six — so neither
-- is a consolation nobody is watching.
--
-- Seeding is a mix no SQL table holds on its own: the division winners by
-- record, then the rest by power rank — and power rank is TypeScript
-- (src/lib/power.ts), computed from a blend the database does not have an
-- opinion about. Rather than grow a second copy of that arithmetic in SQL,
-- the caller (the nightly cron) computes the order and hands it down as an
-- array, the same way the injury sync hands down a report it already read.
-- The winners bracket's own #1 and #2 (the division winners) do not touch
-- that array at all; only the at-large and losers-bracket seats do.
--
-- What changes:
--   * playoff_seeds and matchups both learn a bracket: 'winners' or 'losers'.
--     A manager appears in exactly one playoff_seeds row per season — the
--     same uniqueness 0026 already enforced — now partitioned so each
--     bracket has its own seed 1.
--   * playoff_seeding(league, power_order) replaces seeding(league): the
--     single calculation that decides who is in which bracket and where.
--   * playoff_survivors, draw_playoff_round both take a bracket and work on
--     one at a time; start_playoffs and advance_playoffs now run both.
--   * set_draft_pick_order orders the losers bracket first (worst finish
--     there picks earliest), then the winners bracket in the order teams
--     went out, champion last — the same shape 0021 used for "missed the
--     playoffs" versus "made them", generalised to two brackets instead of
--     one bracket and an also-ran.

-- ------------------------------------------------------------- the field ---

alter table matchups add column if not exists bracket text
  check (bracket in ('winners', 'losers'));

alter table playoff_seeds add column if not exists bracket text
  not null default 'winners' check (bracket in ('winners', 'losers'));

-- Seeds restart at 1 in each bracket, so the primary key needs the bracket
-- in it. A manager is still in exactly one bracket a season, which the
-- existing unique constraint already said and does not need to change.
alter table playoff_seeds drop constraint if exists playoff_seeds_pkey;
alter table playoff_seeds add primary key (league_id, season, bracket, seed);

drop index if exists matchups_playoff_idx;
create index if not exists matchups_playoff_idx
  on matchups (league_id, bracket, playoff_round) where playoff;

alter table matchup_history add column if not exists bracket text;

create or replace function archive_season(p_league_id uuid, p_season int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matchups int;
  v_scores   int;
begin
  insert into matchup_history (
    league_id, season, week, home_manager, away_manager, home_franchise, away_franchise,
    home_points, away_points, home_starters, away_starters, winner, is_tie, final,
    playoff, playoff_round, bracket, divisional, graded_at
  )
  select m.league_id, p_season, m.week, m.home_manager, m.away_manager,
         h.franchise, a.franchise,
         m.home_points, m.away_points, m.home_starters, m.away_starters, m.winner,
         m.is_tie, m.final, m.playoff, m.playoff_round, m.bracket, m.divisional, m.graded_at
    from matchups m
    left join managers h on h.id = m.home_manager
    left join managers a on a.id = m.away_manager
   where m.league_id = p_league_id
  on conflict (league_id, season, week, home_manager) do nothing;
  get diagnostics v_matchups = row_count;

  insert into player_score_history (
    league_id, season, week, player_name, points, stat_line, stats, updated_at
  )
  select s.league_id, p_season, s.week, s.player_name, s.points, s.stat_line, s.stats, s.updated_at
    from player_scores s
   where s.league_id = p_league_id
  on conflict (league_id, season, week, player_name) do nothing;
  get diagnostics v_scores = row_count;

  return jsonb_build_object('matchups', v_matchups, 'scores', v_scores);
end;
$$;

-- ------------------------------------------------------------- the seeds ---

drop function if exists seeding(uuid);

/**
 * Who is in which bracket, and in what order.
 *
 * The #1 record in each division is an automatic winners-bracket seed —
 * capped at the winners bracket's own size, so a league with more divisions
 * than it has room for does not overflow it. Everyone else is ranked by
 * `p_power_order`, the manager IDs the caller has already ranked by power
 * rank, best first: that order fills whatever winners-bracket seats the
 * division winners did not take, and then becomes the losers bracket
 * outright, renumbered from 1.
 *
 * A manager missing from `p_power_order` (the array should always name
 * everyone) sorts last within the power-ranked group rather than erroring,
 * so a caller that slips a name is wrong about where that team seeds and not
 * about whether the postseason can be drawn at all.
 */
create or replace function playoff_seeding(p_league_id uuid, p_power_order uuid[])
returns table (bracket text, seed int, manager_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with rated as (
    select s.manager_id, s.division,
           case when s.wins + s.losses + s.ties = 0 then 0
                else (s.wins + s.ties * 0.5)::numeric / (s.wins + s.losses + s.ties)
           end as pct,
           s.points_for
      from standings(p_league_id) s
  ),
  div_rank as (
    select r.*,
           row_number() over (
             partition by r.division order by r.pct desc, r.points_for desc, r.manager_id asc
           ) as drk
      from rated r
  ),
  power as (
    select m.id as manager_id,
           coalesce(array_position(coalesce(p_power_order, '{}'::uuid[]), m.id), 999999) as p
      from managers m
     where m.league_id = p_league_id
  ),
  winners_n as (
    select least(
      (select count(*)::int from managers where league_id = p_league_id),
      4
    ) as n
  ),
  autos as (
    select d.manager_id,
           row_number() over (order by d.pct desc, d.points_for desc) as auto_ord
      from div_rank d
     where d.drk = 1
  ),
  autos_in as (
    select manager_id, auto_ord from autos
     where auto_ord <= (select n from winners_n)
  ),
  pool as (
    -- Everybody not already auto-qualified, by the power order handed down.
    -- This fills whatever winners-bracket seats are left and, past that,
    -- becomes the losers bracket.
    select pw.manager_id,
           row_number() over (order by pw.p) as pool_ord
      from power pw
     where pw.manager_id not in (select manager_id from autos_in)
  ),
  slots_left as (
    select greatest(0, (select n from winners_n) - (select count(*) from autos_in)) as n
  ),
  classed as (
    select manager_id, true as in_winners, auto_ord, null::int as pool_ord
      from autos_in
    union all
    select manager_id, (pool_ord <= (select n from slots_left)), null, pool_ord
      from pool
  )
  select
    case when in_winners then 'winners' else 'losers' end,
    row_number() over (
      partition by in_winners
      order by (auto_ord is null) asc, coalesce(auto_ord, 0) asc, coalesce(pool_ord, 0) asc
    )::int,
    manager_id
  from classed;
$$;

revoke all on function playoff_seeding(uuid, uuid[]) from public;

-- ----------------------------------------------------------- the bracket ---

drop function if exists playoff_survivors(uuid, int);

create or replace function playoff_survivors(p_league_id uuid, p_season int, p_bracket text)
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
        on h.league_id = m.league_id and h.season = p_season
       and h.bracket = p_bracket and h.manager_id = m.home_manager
      join playoff_seeds a
        on a.league_id = m.league_id and a.season = p_season
       and a.bracket = p_bracket and a.manager_id = m.away_manager
     where m.league_id = p_league_id and m.playoff and m.bracket = p_bracket and m.final
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
     and s.bracket = p_bracket
     and s.manager_id not in (select manager_id from losers)
   order by s.seed;
$$;

revoke all on function playoff_survivors(uuid, int, text) from public;
grant execute on function playoff_survivors(uuid, int, text) to authenticated;

drop function if exists draw_playoff_round(uuid, int, int);

create or replace function draw_playoff_round(p_league_id uuid, p_season int, p_bracket text, p_round int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alive  uuid[];
  v_n      int;
  v_byes   int := 0;
  v_week   int;
  v_lo     int;
  v_hi     int;
  v_made   int := 0;
begin
  select array_agg(manager_id order by seed) into v_alive
    from playoff_survivors(p_league_id, p_season, p_bracket);

  v_n := coalesce(array_length(v_alive, 1), 0);
  if v_n < 2 then return 0; end if;

  if p_round = 1 then
    v_byes := power(2, playoff_rounds(v_n))::int - v_n;
  end if;

  v_week := regular_season_weeks(p_league_id) + p_round;

  v_lo := v_byes + 1;
  v_hi := v_n;

  while v_lo < v_hi loop
    insert into matchups (league_id, week, home_manager, away_manager,
                          playoff, playoff_round, bracket, divisional)
    values (p_league_id, v_week, v_alive[v_lo], v_alive[v_hi], true, p_round, p_bracket, false)
    on conflict do nothing;
    v_made := v_made + 1;
    v_lo := v_lo + 1;
    v_hi := v_hi - 1;
  end loop;

  return v_made;
end;
$$;

revoke all on function draw_playoff_round(uuid, int, text, int) from public;

/**
 * Seeds both brackets and draws each one's first round.
 *
 * `p_power_order` is the manager IDs ranked by power, best first — see
 * playoff_seeding for exactly how it is used. Refuses until the regular
 * season is actually over, and does nothing if the seeds are already down,
 * same as before.
 */
drop function if exists start_playoffs(uuid);

create or replace function start_playoffs(p_league_id uuid, p_power_order uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league  leagues;
  v_weeks   int;
  v_winners int;
  v_losers  int;
  v_drawn_w int;
  v_drawn_l int;
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

  insert into playoff_seeds (league_id, season, bracket, seed, manager_id)
  select p_league_id, v_league.season, ps.bracket, ps.seed, ps.manager_id
    from playoff_seeding(p_league_id, p_power_order) ps;

  select count(*) into v_winners from playoff_seeds
   where league_id = p_league_id and season = v_league.season and bracket = 'winners';
  select count(*) into v_losers from playoff_seeds
   where league_id = p_league_id and season = v_league.season and bracket = 'losers';

  v_drawn_w := draw_playoff_round(p_league_id, v_league.season, 'winners', 1);
  v_drawn_l := draw_playoff_round(p_league_id, v_league.season, 'losers', 1);

  -- The longer of the two brackets decides how long the postseason is, the
  -- same way the round robin decides how long the regular season is.
  update leagues
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{playoffWeeks}',
                              to_jsonb(greatest(playoff_rounds(greatest(v_winners, 2)),
                                                playoff_rounds(greatest(v_losers, 2)))))
   where id = p_league_id;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, null, 'playoffs_started',
          jsonb_build_object('season', v_league.season,
                             'winners', v_winners, 'losers', v_losers,
                             'winnersGames', v_drawn_w, 'losersGames', v_drawn_l));

  return jsonb_build_object('ok', true, 'winners', v_winners, 'losers', v_losers,
                            'winnersGames', v_drawn_w, 'losersGames', v_drawn_l);
end;
$$;

revoke all on function start_playoffs(uuid, uuid[]) from public;

/**
 * Moves both brackets on by whatever they are owed.
 *
 * Called nightly after the scores are graded. Each bracket is handled on its
 * own schedule — the winners bracket (four teams, two rounds) is usually
 * done a week before the losers bracket (six teams, three) — so one can be
 * drawing its final while the other is still mid-round. Only the winners
 * bracket ever crowns a champion; the losers bracket simply stops once one
 * team is left, because all it ever decided was where the bottom six finish.
 */
drop function if exists advance_playoffs(uuid);

create or replace function advance_playoffs(p_league_id uuid, p_power_order uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league   leagues;
  v_result   jsonb := '{}'::jsonb;
  v_bracket  text;
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

  if not exists (select 1 from playoff_seeds
                  where league_id = p_league_id and season = v_league.season) then
    if regular_season_weeks(p_league_id) = 0
       or exists (select 1 from matchups
                   where league_id = p_league_id and not playoff and not final) then
      return jsonb_build_object('ok', true, 'state', 'regular season');
    end if;
    return start_playoffs(p_league_id, p_power_order) || jsonb_build_object('state', 'started');
  end if;

  foreach v_bracket in array array['winners', 'losers'] loop
    if not exists (select 1 from playoff_seeds
                    where league_id = p_league_id and season = v_league.season
                      and bracket = v_bracket) then
      v_result := v_result || jsonb_build_object(v_bracket, jsonb_build_object('state', 'empty'));
      continue;
    end if;

    if v_bracket = 'winners' and exists (
      select 1 from league_champions
       where league_id = p_league_id and season = v_league.season
    ) then
      v_result := v_result || jsonb_build_object('winners', jsonb_build_object('state', 'decided'));
      continue;
    end if;

    select coalesce(max(playoff_round), 0) into v_round
      from matchups
     where league_id = p_league_id and playoff and bracket = v_bracket;

    select count(*) into v_pending
      from matchups
     where league_id = p_league_id and playoff and bracket = v_bracket
       and playoff_round = v_round and not final;

    if v_pending > 0 then
      v_result := v_result
        || jsonb_build_object(v_bracket, jsonb_build_object('state', 'playing', 'round', v_round));
      continue;
    end if;

    select count(*) into v_alive from playoff_survivors(p_league_id, v_league.season, v_bracket);

    if v_alive <= 1 then
      if v_bracket = 'winners' then
        select ps.manager_id into v_champion
          from playoff_survivors(p_league_id, v_league.season, 'winners') ps limit 1;
        select franchise into v_name from managers where id = v_champion;

        insert into league_champions (league_id, season, manager_id, franchise)
        values (p_league_id, v_league.season, v_champion, coalesce(v_name, 'Unknown'))
        on conflict (league_id, season) do nothing;

        insert into admin_log (league_id, actor, action, detail)
        values (p_league_id, null, 'champion',
                jsonb_build_object('season', v_league.season, 'franchise', v_name));

        v_result := v_result
          || jsonb_build_object('winners', jsonb_build_object('state', 'champion', 'franchise', v_name));
      else
        v_result := v_result || jsonb_build_object('losers', jsonb_build_object('state', 'finished'));
      end if;
      continue;
    end if;

    v_drawn := draw_playoff_round(p_league_id, v_league.season, v_bracket, v_round + 1);
    v_result := v_result
      || jsonb_build_object(v_bracket, jsonb_build_object('state', 'drawn', 'round', v_round + 1, 'games', v_drawn));
  end loop;

  return jsonb_build_object('ok', true) || v_result;
end;
$$;

revoke all on function advance_playoffs(uuid, uuid[]) from public;

-- ---------------------------------------------------------- picking again ---

/**
 * Next season's draft order, generalised to two brackets.
 *
 * The losers bracket picks first in its entirety, worst finish there first;
 * then the winners bracket, in the order teams went out, champion last. Same
 * shape 0021 used for "missed the playoffs" against "made them" — a league
 * with no bracket yet (mid-season) has every manager's bracket come back
 * null from the join, which ties everyone on the first two keys and falls
 * straight through to the plain standings order underneath, exactly as
 * before a bracket existed at all.
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
  select season into v_season from leagues where id = p_league_id;

  with knocked as (
    select s.manager_id, s.bracket,
           coalesce(max(m.playoff_round), 0) as reached
      from playoff_seeds s
      left join matchups m
        on m.league_id = s.league_id and m.playoff and m.bracket = s.bracket
       and (m.home_manager = s.manager_id or m.away_manager = s.manager_id)
     where s.league_id = p_league_id and s.season = v_season
     group by s.manager_id, s.bracket
  ),
  ranked as (
    select s.manager_id,
           row_number() over (
             order by
               (k.bracket = 'winners') asc,
               coalesce(k.reached, 0) asc,
               (c.manager_id is not null) asc,
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
