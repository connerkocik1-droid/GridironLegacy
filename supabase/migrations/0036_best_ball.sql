-- Best ball: nobody sets a lineup, ever.
--
-- The whole roster plays. Each week the highest scorers fill the starting
-- slots by themselves, swapping as the afternoon goes on and the numbers move,
-- and whatever the arrangement is when the last game ends is the one that
-- counts. There is no lineup to forget to set, no player left on a bench who
-- went for thirty, and no Sunday morning spent checking whether somebody is
-- active.
--
-- The rule that decides who wins therefore lives here rather than in a
-- browser. A result computed by whichever client happened to be open is not a
-- result; grade_week has always asked the database what a lineup was worth,
-- and it still does — the answer is just the best arrangement now instead of
-- the one somebody saved.

-- ----------------------------------------------------------- the positions ---
--
-- The database has never known what position anybody plays. It did not have
-- to: lineup_slot said what a player counted as, and a manager put him there.
-- Best ball has nobody to ask, so it needs the real thing.
--
-- The app is the only place that knows — the draft pool lives there — so the
-- app writes it. In the league's own vocabulary (K, not PK; RB for a fullback)
-- because that is what a slot is named after.

alter table roster_slots
  add column if not exists position text;

/**
 * Records what everybody on a roster plays.
 *
 * Sent as two parallel arrays rather than a row at a time: this is called on
 * the same schedule as the score refresh, and a hundred and fifty round trips
 * to say what has not changed is not a refresh.
 *
 * Idempotent and self-healing. Nothing depends on it having run at any
 * particular moment — a position that is missing costs that player his slot
 * for one refresh, and the next one puts him back.
 */
create or replace function sync_roster_positions(
  p_league_id  uuid,
  p_names      text[],
  p_positions  text[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed int;
begin
  if coalesce(array_length(p_names, 1), 0) <> coalesce(array_length(p_positions, 1), 0) then
    raise exception 'A name and a position for each, or neither' using errcode = '22023';
  end if;

  update roster_slots r
     set position = u.pos
    from unnest(p_names, p_positions) as u(name, pos)
   where r.league_id = p_league_id
     and r.player_name = u.name
     and r.position is distinct from u.pos;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function sync_roster_positions(uuid, text[], text[]) from public;
-- The service key only. A session that could write positions could make a
-- quarterback eligible for a flex and quietly win a week with it.

-- ------------------------------------------------------------ the lineup ---

/**
 * The best legal lineup a roster can field in one week, and what it is worth.
 *
 * Greedy, and greedy is provably right for this shape of lineup. Every
 * dedicated slot takes exactly one position, so the highest scorers at each
 * position must fill them — swapping in a lower one can never help. Only the
 * flex is shared, and it takes whatever is left over. A superflex would break
 * that reasoning, which is one more reason this league does not have one.
 *
 * A player with no score that week counts as nought rather than being left
 * out, so a slot filled by somebody who did not play reads as a filled slot
 * worth nothing — which is what it is.
 *
 * Ties break on name. Two players on the same points is common early on a
 * Sunday when everybody has nought, and a lineup that reshuffles itself
 * between two refreshes for no reason looks broken.
 */
create or replace function best_ball_lineup(
  p_league_id  uuid,
  p_manager_id uuid,
  p_week       int
)
returns table (player_name text, slot text, points numeric)
language plpgsql
stable
set search_path = public
as $$
declare
  v_starters jsonb;
begin
  select coalesce(settings -> 'starters', '{}'::jsonb)
    into v_starters
    from leagues
   where id = p_league_id;

  return query
  with held as (
    select r.player_name    as name,
           coalesce(r.position, '') as pos,
           coalesce(s.points, 0)    as pts
      from roster_slots r
      left join player_scores s
        on s.league_id = r.league_id
       and s.player_name = r.player_name
       and s.week = p_week
     where r.league_id = p_league_id
       and r.manager_id = p_manager_id
       -- Injured reserve is the one thing lineup_slot still says. A player
       -- stashed there does not count against the roster, so he must not be
       -- able to score for it either.
       and coalesce(r.lineup_slot, '') <> 'IR'
  ),
  ranked as (
    select h.*,
           row_number() over (partition by h.pos order by h.pts desc, h.name) as rank_at
      from held h
  ),
  dedicated as (
    select r.name, r.pos as in_slot, r.pts
      from ranked r
     where r.pos <> ''
       and r.rank_at <= coalesce((v_starters ->> r.pos)::int, 0)
  ),
  spare as (
    select r.name, r.pts
      from ranked r
     where r.pos in ('RB', 'WR', 'TE')
       and not exists (select 1 from dedicated d where d.name = r.name)
     order by r.pts desc, r.name
     limit coalesce((v_starters ->> 'FLEX')::int, 0)
  )
  select d.name, d.in_slot, d.pts from dedicated d
  union all
  select s.name, 'FLEX', s.pts from spare s;
end;
$$;

grant execute on function best_ball_lineup(uuid, uuid, int) to authenticated;

/**
 * What a manager's week is worth.
 *
 * Re-emitted from 0008. It used to sum whoever was not on the bench, which
 * was the right answer when somebody chose who that was. Now it sums the best
 * arrangement, which is the same question with the choosing taken out.
 */
create or replace function lineup_points(p_league_id uuid, p_manager_id uuid, p_week int)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(points), 0)
    from best_ball_lineup(p_league_id, p_manager_id, p_week);
$$;

/** The same lineup as the snapshot a graded matchup keeps. */
create or replace function best_ball_starters(
  p_league_id  uuid,
  p_manager_id uuid,
  p_week       int
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('name', player_name, 'slot', slot, 'points', points)),
    '[]'::jsonb
  )
  from best_ball_lineup(p_league_id, p_manager_id, p_week);
$$;

/**
 * Scores a week and, once its games are over, freezes the result.
 *
 * Re-emitted from 0031 with one change: the starters it photographs are the
 * best-ball lineup rather than whoever was not on a bench. Everything else —
 * when a week is allowed to close, how a tie is recorded, the refusal to
 * regrade a final week — is exactly as it was.
 *
 * That snapshot is the whole point of freezing. While the week is open the
 * lineup is recomputed on every read and moves with the scores; once the last
 * game ends it is written down, and what is written down is what stands.
 */
create or replace function grade_week(p_league_id uuid, p_week int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m        matchups;
  v_complete boolean;
  v_graded   int := 0;
  v_home     numeric;
  v_away     numeric;
  v_season   int;
begin
  select season into v_season from leagues where id = p_league_id;
  if v_season is null then
    return jsonb_build_object('ok', false, 'error', 'no such league');
  end if;

  -- A week with no games mirrored yet cannot be closed.
  select count(*) > 0 and bool_and(completed)
    into v_complete
    from nfl_games
   where week = p_week
     and season = v_season
     and season_type = 2;

  for v_m in
    select * from matchups
     where league_id = p_league_id and week = p_week and not final
  loop
    v_home := lineup_points(p_league_id, v_m.home_manager, p_week);
    v_away := lineup_points(p_league_id, v_m.away_manager, p_week);

    update matchups
       set home_points = v_home,
           away_points = v_away,
           home_starters = best_ball_starters(p_league_id, v_m.home_manager, p_week),
           away_starters = best_ball_starters(p_league_id, v_m.away_manager, p_week),
           winner = case
             when not coalesce(v_complete, false) then null
             when v_home > v_away then v_m.home_manager
             when v_away > v_home then v_m.away_manager
             else null
           end,
           is_tie = coalesce(v_complete, false) and v_home = v_away,
           final = coalesce(v_complete, false),
           graded_at = now()
     where id = v_m.id;

    v_graded := v_graded + 1;
  end loop;

  return jsonb_build_object('ok', true, 'week', p_week, 'graded', v_graded, 'final', coalesce(v_complete, false));
end;
$$;

revoke all on function grade_week(uuid, int) from public;

-- Every league is best ball now. Recorded in settings rather than assumed, so
-- the rules page and the lineup screen read it from the same place everything
-- else about this league is read from.
update leagues
   set settings = coalesce(settings, '{}'::jsonb) || '{"bestBall": true}'::jsonb;

-- --------------------------------------------------------- injured reserve ---
--
-- The one decision left. Everything else about a lineup is gone, but a dynasty
-- roster still has to be able to carry a man who tore something in October
-- without paying a roster spot for him all season — that is a different
-- problem from choosing who starts, and best ball does not solve it.
--
-- lineup_slot therefore stays on roster_slots and stops meaning anything
-- except this: 'IR' or not. roster_count has excluded IR since 0007 and still
-- does, so the capacity rule needs no change; best_ball_lineup above excludes
-- it too, so a stashed player cannot score.

/**
 * Stashes one of your own on injured reserve, or brings him back.
 *
 * Whether he is actually injured is not asked here, because this database has
 * never seen an injury report — that lives at ESPN and reaches the app, so the
 * app is what refuses to stash a fit player. What is enforced here is the part
 * that is about the league rather than about a player: it is your roster, the
 * reserve holds what the settings say it holds, and a man coming back has to
 * have a roster spot to come back to.
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
  v_limit    int;
  v_stashed  int;
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
    v_limit := coalesce((v_settings ->> 'ir')::int, 0);

    select count(*)
      into v_stashed
      from roster_slots
     where manager_id = v_me.id
       and lineup_slot = 'IR'
       and player_name <> p_player;

    if v_stashed >= v_limit then
      raise exception 'Injured reserve holds %', v_limit using errcode = '55000';
    end if;

    update roster_slots
       set lineup_slot = 'IR'
     where manager_id = v_me.id and player_name = p_player;
  else
    -- Only a player actually coming back needs room made for him; asking for
    -- BENCH twice is a no-op rather than an error somebody has to understand.
    if v_was_ir and roster_count(v_me.id) >= roster_capacity(v_settings) then
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
