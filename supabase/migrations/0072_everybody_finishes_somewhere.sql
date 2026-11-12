-- Everybody finishes somewhere, and the draft follows the finish.
--
-- Until now the postseason was the title bracket and nothing else. The teams
-- that missed it stopped playing after the last regular week, and next year's
-- draft ordered them by regular-season record — worst record, first pick. A
-- team out of it by October had every reason to stop setting a lineup.
--
-- The league plays it differently. The teams outside the field play a
-- losers-advance consolation bracket, and whoever loses all the way down it
-- finishes last. The teams knocked out of the title bracket play placement
-- games. So every franchise ends the season in a place, one to the size of
-- the league, earned on the field, and the rookie draft is exactly that finish
-- reversed: last place picks first, the champion picks last.
--
-- For a ten-team league with a six-team field, weeks 15 to 17:
--
--   week 15  wild card     3 v 6, 4 v 5 (1 and 2 rest)
--            consolation   7 v 10, 8 v 9
--   week 16  semi-finals   1 v lowest left, 2 v the other
--            5th place     the two wild-card losers
--            7th place     the two consolation winners
--            9th place     the two consolation losers — the loser is last
--   week 17  championship  for 1st
--            3rd place     the two semi-final losers
--
-- How it is kept:
--
--   * matchups.bracket says which bracket a postseason game is in: 'title',
--     'place' or 'consolation'. Everything that already read `playoff` as
--     "the title bracket" now says so explicitly.
--   * matchups.for_place is the place a game decides: the winner takes it,
--     the loser the one after. The championship is for 1st.
--   * consolation_seeds holds the teams outside the field, in seed order, the
--     way playoff_seeds holds the field.
--   * season_finish is the final order, written once when the last game is
--     done: places from the games that decided them, and anybody a game didn't
--     place (a field or a consolation group too big to pair off) by how far
--     they got and then by seed.
--
-- A level postseason game in any bracket goes to the better seed.

alter table matchups add column if not exists bracket text not null default 'title';
alter table matchups add column if not exists for_place int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matchups_bracket_check') then
    alter table matchups add constraint matchups_bracket_check
      check (bracket in ('title', 'place', 'consolation'));
  end if;
end
$$;

create table if not exists consolation_seeds (
  league_id  uuid not null references leagues(id) on delete cascade,
  season     int  not null,
  seed       int  not null,
  manager_id uuid not null references managers(id) on delete cascade,
  primary key (league_id, season, seed),
  unique (league_id, season, manager_id)
);

alter table consolation_seeds enable row level security;
drop policy if exists consolation_seeds_read on consolation_seeds;
create policy consolation_seeds_read on consolation_seeds
  for select using (league_id = (select league_id from current_manager()));
grant select on consolation_seeds to authenticated;

create table if not exists season_finish (
  league_id  uuid not null references leagues(id) on delete cascade,
  season     int  not null,
  place      int  not null,
  manager_id uuid references managers(id) on delete set null,
  -- The name at the time, as league_champions keeps it.
  franchise  text not null,
  primary key (league_id, season, place)
);

alter table season_finish enable row level security;
drop policy if exists season_finish_read on season_finish;
create policy season_finish_read on season_finish
  for select using (league_id = (select league_id from current_manager()));
grant select on season_finish to authenticated;

-- ------------------------------------------------------------- the seeds ---

/** A franchise's postseason seed, in the title field or the consolation. */
create or replace function postseason_seed(p_league_id uuid, p_season int, p_manager uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select seed from playoff_seeds
      where league_id = p_league_id and season = p_season and manager_id = p_manager),
    (select seed from consolation_seeds
      where league_id = p_league_id and season = p_season and manager_id = p_manager),
    999);
$$;

/** Who won a postseason game: the higher score, or on a level game the better seed. */
create or replace function postseason_winner(p_game matchups, p_season int)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_game.winner is not null then p_game.winner
    when postseason_seed(p_game.league_id, p_season, p_game.home_manager)
         <= postseason_seed(p_game.league_id, p_season, p_game.away_manager)
      then p_game.home_manager
    else p_game.away_manager
  end;
$$;

revoke all on function postseason_seed(uuid, int, uuid) from public;
revoke all on function postseason_winner(matchups, int) from public;

-- ----------------------------------------------------------- the bracket ---

/** playoff_survivors, as 0026 wrote it, reading only the title bracket. */
create or replace function playoff_survivors(p_league_id uuid, p_season int)
returns table (seed int, manager_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with losers as (
    select case when postseason_winner(m, p_season) = m.home_manager
                then m.away_manager else m.home_manager end as manager_id
      from matchups m
     where m.league_id = p_league_id and m.playoff and m.bracket = 'title' and m.final
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

/** draw_playoff_round, as 0026 wrote it: the title bracket, and the final is for 1st. */
create or replace function draw_playoff_round(p_league_id uuid, p_season int, p_round int)
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
    from playoff_survivors(p_league_id, p_season);

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
                          playoff, playoff_round, divisional, bracket, for_place)
    values (p_league_id, v_week, v_alive[v_lo], v_alive[v_hi], true, p_round, false,
            'title', case when v_n = 2 then 1 end);
    v_made := v_made + 1;
    v_lo := v_lo + 1;
    v_hi := v_hi - 1;
  end loop;

  return v_made;
end;
$$;

revoke all on function draw_playoff_round(uuid, int, int) from public;

/**
 * The consolation's first round: everybody outside the field, best against
 * worst. Two teams play once, for the first place below the field; four play
 * twice, losers against losers (draw_postseason_week does the second round).
 */
create or replace function draw_consolation(p_league_id uuid, p_season int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids   uuid[];
  v_n     int;
  v_field int;
  v_lo    int := 1;
  v_hi    int;
  v_made  int := 0;
begin
  select array_agg(manager_id order by seed) into v_ids
    from consolation_seeds where league_id = p_league_id and season = p_season;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 2 then return 0; end if;

  select count(*) into v_field from playoff_seeds where league_id = p_league_id and season = p_season;
  v_hi := v_n;

  while v_lo < v_hi loop
    insert into matchups (league_id, week, home_manager, away_manager,
                          playoff, playoff_round, divisional, bracket, for_place)
    values (p_league_id, regular_season_weeks(p_league_id) + 1, v_ids[v_lo], v_ids[v_hi],
            true, 1, false, 'consolation', case when v_n = 2 then v_field + 1 end);
    v_made := v_made + 1;
    v_lo := v_lo + 1;
    v_hi := v_hi - 1;
  end loop;

  return v_made;
end;
$$;

revoke all on function draw_consolation(uuid, int) from public;

/**
 * Seeds the bracket, the consolation, and draws week one of both. As 0026's,
 * and then everybody outside the field is written into consolation_seeds in
 * the order seeding() puts them.
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
  v_cons   int;
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

  -- A reset season can leave last attempt's consolation behind.
  delete from consolation_seeds where league_id = p_league_id and season = v_league.season;
  insert into consolation_seeds (league_id, season, seed, manager_id)
  select p_league_id, v_league.season, s.seed, s.manager_id
    from seeding(p_league_id) s
   where s.seed > v_field;

  v_drawn := draw_playoff_round(p_league_id, v_league.season, 1);
  v_cons  := draw_consolation(p_league_id, v_league.season);

  update leagues
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{playoffWeeks}',
                              to_jsonb(playoff_rounds(v_field)))
   where id = p_league_id;

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, null, 'playoffs_started',
          jsonb_build_object('season', v_league.season, 'field', v_field,
                             'rounds', playoff_rounds(v_field), 'games', v_drawn,
                             'consolation', v_cons));

  return jsonb_build_object('ok', true, 'field', v_field,
                            'rounds', playoff_rounds(v_field), 'games', v_drawn,
                            'consolation', v_cons);
end;
$$;

revoke all on function start_playoffs(uuid) from public;

/**
 * The games for one postseason week besides the title bracket's own, once the
 * week before it is done:
 *
 *   * the two teams knocked out of the title bracket in the round before play
 *     for the better of the two places they are now competing for;
 *   * after the consolation's first round of four, its winners play for the
 *     first place below the field and its losers for the place two below that
 *     — and the loser of that one finishes last.
 */
create or replace function draw_postseason_week(p_league_id uuid, p_season int, p_k int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week    int := regular_season_weeks(p_league_id) + p_k;
  v_field   int;
  v_losers  uuid[];
  v_alive   int;
  v_winners uuid[];
  v_lost    uuid[];
  v_made    int := 0;
begin
  select count(*) into v_field from playoff_seeds where league_id = p_league_id and season = p_season;

  -- Placement: the title bracket's losers from the round before, when there
  -- are exactly two of them to pair.
  select array_agg(l.loser order by postseason_seed(p_league_id, p_season, l.loser)) into v_losers
    from (
      select case when postseason_winner(m, p_season) = m.home_manager
                  then m.away_manager else m.home_manager end as loser
        from matchups m
       where m.league_id = p_league_id and m.bracket = 'title'
         and m.playoff_round = p_k - 1 and m.final
    ) l;

  if coalesce(array_length(v_losers, 1), 0) = 2 then
    select count(*) into v_alive from playoff_survivors(p_league_id, p_season);
    insert into matchups (league_id, week, home_manager, away_manager,
                          playoff, playoff_round, divisional, bracket, for_place)
    values (p_league_id, v_week, v_losers[1], v_losers[2], true, p_k, false,
            'place', v_alive + 1);
    v_made := v_made + 1;
  end if;

  -- The consolation's second round, from a first round of exactly two games.
  if p_k = 2 and (select count(*) from matchups
                   where league_id = p_league_id and bracket = 'consolation'
                     and playoff_round = 1 and for_place is null) = 2 then
    select array_agg(postseason_winner(m, p_season)
                       order by postseason_seed(p_league_id, p_season, postseason_winner(m, p_season))),
           array_agg(case when postseason_winner(m, p_season) = m.home_manager
                          then m.away_manager else m.home_manager end
                       order by postseason_seed(p_league_id, p_season,
                         case when postseason_winner(m, p_season) = m.home_manager
                              then m.away_manager else m.home_manager end))
      into v_winners, v_lost
      from matchups m
     where m.league_id = p_league_id and m.bracket = 'consolation'
       and m.playoff_round = 1 and m.final;

    if coalesce(array_length(v_winners, 1), 0) = 2 then
      insert into matchups (league_id, week, home_manager, away_manager,
                            playoff, playoff_round, divisional, bracket, for_place)
      values
        (p_league_id, v_week, v_winners[1], v_winners[2], true, 2, false, 'consolation', v_field + 1),
        (p_league_id, v_week, v_lost[1], v_lost[2], true, 2, false, 'consolation', v_field + 3);
      v_made := v_made + 2;
    end if;
  end if;

  return v_made;
end;
$$;

revoke all on function draw_postseason_week(uuid, int, int) from public;

/**
 * The final order, written down once every postseason game is done.
 *
 * Places come from the games that decided them. Anybody left over — a title
 * bracket too big for every round to have a placement game, a consolation too
 * big to pair off twice — takes the free places in its half of the table by
 * how far it got, then by seed.
 */
create or replace function record_season_finish(p_league_id uuid, p_season int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_field int;
  v_total int;
  v_place int;
  v_row   record;
begin
  delete from season_finish where league_id = p_league_id and season = p_season;

  select count(*) into v_field from playoff_seeds where league_id = p_league_id and season = p_season;
  select v_field + count(*) into v_total from consolation_seeds where league_id = p_league_id and season = p_season;

  insert into season_finish (league_id, season, place, manager_id, franchise)
  select p_league_id, p_season, x.place, x.manager_id, mg.franchise
    from (
      select m.for_place as place, postseason_winner(m, p_season) as manager_id
        from matchups m
       where m.league_id = p_league_id and m.playoff and m.final and m.for_place is not null
      union all
      select m.for_place + 1,
             case when postseason_winner(m, p_season) = m.home_manager
                  then m.away_manager else m.home_manager end
        from matchups m
       where m.league_id = p_league_id and m.playoff and m.final and m.for_place is not null
    ) x
    join managers mg on mg.id = x.manager_id
  on conflict do nothing;

  -- The title field's unplaced: furthest round reached first, then seed.
  for v_row in
    select s.manager_id, mg.franchise
      from playoff_seeds s join managers mg on mg.id = s.manager_id
     where s.league_id = p_league_id and s.season = p_season
       and s.manager_id not in (select manager_id from season_finish
                                 where league_id = p_league_id and season = p_season and manager_id is not null)
     order by (select coalesce(max(m.playoff_round), 0) from matchups m
                where m.league_id = p_league_id and m.bracket = 'title'
                  and s.manager_id in (m.home_manager, m.away_manager)) desc,
              s.seed
  loop
    select min(p) into v_place from generate_series(1, v_field) p
     where p not in (select place from season_finish where league_id = p_league_id and season = p_season);
    insert into season_finish (league_id, season, place, manager_id, franchise)
    values (p_league_id, p_season, v_place, v_row.manager_id, v_row.franchise);
  end loop;

  -- The consolation's unplaced: games won first, then seed.
  for v_row in
    select s.manager_id, mg.franchise
      from consolation_seeds s join managers mg on mg.id = s.manager_id
     where s.league_id = p_league_id and s.season = p_season
       and s.manager_id not in (select manager_id from season_finish
                                 where league_id = p_league_id and season = p_season and manager_id is not null)
     order by (select count(*) from matchups m
                where m.league_id = p_league_id and m.bracket = 'consolation' and m.final
                  and postseason_winner(m, p_season) = s.manager_id) desc,
              s.seed
  loop
    select min(p) into v_place from generate_series(v_field + 1, v_total) p
     where p not in (select place from season_finish where league_id = p_league_id and season = p_season);
    insert into season_finish (league_id, season, place, manager_id, franchise)
    values (p_league_id, p_season, v_place, v_row.manager_id, v_row.franchise);
  end loop;

  return v_total;
end;
$$;

revoke all on function record_season_finish(uuid, int) from public;

/**
 * Moves the postseason on by whatever it is owed — as 0026's, for every
 * bracket at once. A postseason week is only over when every game in it is,
 * title, placement and consolation alike; then the next week of all three is
 * drawn together. When there is nothing left to draw, the champion is named
 * and the season's finish is written down.
 */
create or replace function advance_playoffs(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league   leagues;
  v_k        int;
  v_alive    int;
  v_champion uuid;
  v_name     text;
  v_drawn    int := 0;
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
    return start_playoffs(p_league_id) || jsonb_build_object('state', 'started');
  end if;

  if exists (select 1 from league_champions
              where league_id = p_league_id and season = v_league.season) then
    return jsonb_build_object('ok', true, 'state', 'decided');
  end if;

  if exists (select 1 from matchups
              where league_id = p_league_id and playoff and not final) then
    return jsonb_build_object('ok', true, 'state', 'playing',
      'round', (select max(playoff_round) from matchups where league_id = p_league_id and playoff));
  end if;

  v_k := coalesce((select max(week) from matchups where league_id = p_league_id and playoff), 0)
         - regular_season_weeks(p_league_id);

  select count(*) into v_alive from playoff_survivors(p_league_id, v_league.season);
  if v_alive >= 2 then
    v_drawn := draw_playoff_round(p_league_id, v_league.season, v_k + 1);
  end if;
  v_drawn := v_drawn + draw_postseason_week(p_league_id, v_league.season, v_k + 1);

  if v_drawn > 0 then
    return jsonb_build_object('ok', true, 'state', 'drawn', 'round', v_k + 1, 'games', v_drawn);
  end if;

  -- Nothing left to draw: the season is over.
  select ps.manager_id into v_champion
    from playoff_survivors(p_league_id, v_league.season) ps limit 1;
  select franchise into v_name from managers where id = v_champion;

  insert into league_champions (league_id, season, manager_id, franchise)
  values (p_league_id, v_league.season, v_champion, coalesce(v_name, 'Unknown'))
  on conflict (league_id, season) do nothing;

  perform record_season_finish(p_league_id, v_league.season);

  insert into admin_log (league_id, actor, action, detail)
  values (p_league_id, null, 'champion',
          jsonb_build_object('season', v_league.season, 'franchise', v_name));

  return jsonb_build_object('ok', true, 'state', 'champion', 'franchise', v_name);
end;
$$;

revoke all on function advance_playoffs(uuid) from public;

-- ---------------------------------------------------------- picking again ---

/**
 * Next season's draft order. Once the season is finished it is the finish,
 * reversed: last place picks first and the champion last, whatever anybody's
 * record was. Before then it is 0026's projection from the table and the
 * bracket so far, which is what the board shows while the season is played.
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

  -- A finished season: its champion is named and its finish written down.
  if exists (select 1 from league_champions where league_id = p_league_id and season = v_season)
     and exists (select 1 from season_finish where league_id = p_league_id and season = v_season) then
    with ranked as (
      select f.manager_id, row_number() over (order by f.place desc)::int as position
        from season_finish f
       where f.league_id = p_league_id and f.season = v_season and f.manager_id is not null
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
  end if;

  with knocked as (
    select s.manager_id,
           coalesce(max(m.playoff_round), 0) as reached
      from playoff_seeds s
      left join matchups m
        on m.league_id = s.league_id and m.playoff and m.bracket = 'title'
       and (m.home_manager = s.manager_id or m.away_manager = s.manager_id)
     where s.league_id = p_league_id and s.season = v_season
     group by s.manager_id
  ),
  ranked as (
    select s.manager_id,
           row_number() over (
             order by
               (k.manager_id is not null) asc,
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
