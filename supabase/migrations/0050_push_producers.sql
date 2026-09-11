-- The four things worth telling somebody about.

-- Written here rather than in the crons because all three of these read
-- rosters and scores, which live here, and because a producer inside the
-- database enqueues in the same transaction as the thing it noticed. What is
-- not here is the week's projections: a projection comes from the static
-- player pool, which the application holds and the database has never seen.
--
-- None of them decides who wants what. enqueue_push does that, once, so a
-- producer added later cannot forget to ask.

/**
 * Where a matchup stands, while it is still standing.
 *
 * Only when the lead changes hands. A cron running every few minutes through a
 * Sunday could say something every few minutes, and a phone that buzzes thirty
 * times in an afternoon is a phone with notifications turned off by teatime.
 * The dedupe key is who is ahead, so the first score of the day is one message
 * and every lead change after it is one more — which is exactly the list of
 * moments somebody would want to look up from their lunch for.
 */
create or replace function push_score_news(p_league_id uuid, p_week int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m      record;
  v_home   numeric;
  v_away   numeric;
  v_lead   text;
  v_queued int := 0;
begin
  for v_m in
    select m.id, m.home_manager, m.away_manager,
           h.franchise as home_name, a.franchise as away_name
      from matchups m
      join managers h on h.id = m.home_manager
      join managers a on a.id = m.away_manager
     where m.league_id = p_league_id
       and m.week = p_week
       and not m.final
  loop
    v_home := lineup_points(p_league_id, v_m.home_manager, p_week);
    v_away := lineup_points(p_league_id, v_m.away_manager, p_week);

    -- Nothing has happened yet. A message saying nought to nought is a message
    -- saying the games have not started, which the reader already knows.
    continue when v_home = 0 and v_away = 0;

    v_lead := case
      when v_home > v_away then 'h'
      when v_away > v_home then 'a'
      else 't'
    end;

    if enqueue_push(v_m.home_manager, 'scores',
         format('%s %s', v_m.home_name, round(v_home, 1)),
         case v_lead
           when 'h' then format('Ahead of %s by %s.', v_m.away_name, round(v_home - v_away, 1))
           when 'a' then format('Behind %s by %s.', v_m.away_name, round(v_away - v_home, 1))
           else format('Level with %s.', v_m.away_name)
         end,
         '/lineup',
         format('score:w%s:%s', p_week, v_lead))
    then v_queued := v_queued + 1; end if;

    if enqueue_push(v_m.away_manager, 'scores',
         format('%s %s', v_m.away_name, round(v_away, 1)),
         case v_lead
           when 'a' then format('Ahead of %s by %s.', v_m.home_name, round(v_away - v_home, 1))
           when 'h' then format('Behind %s by %s.', v_m.home_name, round(v_home - v_away, 1))
           else format('Level with %s.', v_m.home_name)
         end,
         '/lineup',
         format('score:w%s:%s', p_week, v_lead))
    then v_queued := v_queued + 1; end if;
  end loop;

  return v_queued;
end;
$$;

revoke all on function push_score_news(uuid, int) from public;

/**
 * How the week finished, once it is finished.
 *
 * Reads the graded matchup rather than recomputing it, so the number in the
 * notification is the number in the record. The dedupe key is the week, so
 * regrading a week — which the commissioner can do — does not send it again.
 */
create or replace function push_recap_news(p_league_id uuid, p_week int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m      record;
  v_queued int := 0;
begin
  for v_m in
    select m.home_manager, m.away_manager, m.home_points, m.away_points,
           m.winner, m.is_tie,
           h.franchise as home_name, a.franchise as away_name
      from matchups m
      join managers h on h.id = m.home_manager
      join managers a on a.id = m.away_manager
     where m.league_id = p_league_id
       and m.week = p_week
       and m.final
  loop
    if enqueue_push(v_m.home_manager, 'recap',
         format('Week %s: %s', p_week,
           case when v_m.is_tie then 'a draw'
                when v_m.winner = v_m.home_manager then 'won'
                else 'lost' end),
         format('%s %s, %s %s.', v_m.home_name, round(v_m.home_points, 1),
                                 v_m.away_name, round(v_m.away_points, 1)),
         format('/matchup?week=%s', p_week),
         format('recap:w%s', p_week))
    then v_queued := v_queued + 1; end if;

    if enqueue_push(v_m.away_manager, 'recap',
         format('Week %s: %s', p_week,
           case when v_m.is_tie then 'a draw'
                when v_m.winner = v_m.away_manager then 'won'
                else 'lost' end),
         format('%s %s, %s %s.', v_m.away_name, round(v_m.away_points, 1),
                                 v_m.home_name, round(v_m.home_points, 1)),
         format('/matchup?week=%s', p_week),
         format('recap:w%s', p_week))
    then v_queued := v_queued + 1; end if;
  end loop;

  return v_queued;
end;
$$;

revoke all on function push_recap_news(uuid, int) from public;

/**
 * Somebody on your roster is hurt.
 *
 * Reads the state rather than a change, and puts the state in the dedupe key,
 * which does the same job without needing to remember what yesterday said: a
 * man who is questionable for three weeks is announced once, and the morning
 * he is downgraded to out is a different key and a second message. A man who
 * gets better is not announced at all — nobody needs waking for good news
 * about somebody who was going to play anyway.
 *
 * Only the ones that change what a manager would do. Probable is noise.
 */
create or replace function push_injury_news(p_league_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p      record;
  v_queued int := 0;
begin
  for v_p in
    select r.manager_id, r.player_name, p.injury_status, p.injury_detail
      from roster_slots r
      join nfl_players p on p.name = r.player_name
     where r.league_id = p_league_id
       and p.injury_status in ('out', 'doubtful', 'ir', 'suspended')
       -- Already stashed is already known. The manager put him there.
       and r.lineup_slot <> 'IR'
  loop
    if enqueue_push(v_p.manager_id, 'injuries',
         v_p.player_name,
         format('%s%s',
           case v_p.injury_status
             when 'out'       then 'Out'
             when 'doubtful'  then 'Doubtful'
             when 'ir'        then 'On injured reserve'
             when 'suspended' then 'Suspended'
             else initcap(v_p.injury_status)
           end,
           case when coalesce(v_p.injury_detail, '') = '' then '.'
                else format(' — %s.', v_p.injury_detail) end),
         '/my-team',
         format('injury:%s:%s', v_p.player_name, v_p.injury_status))
    then v_queued := v_queued + 1; end if;
  end loop;

  return v_queued;
end;
$$;

revoke all on function push_injury_news(uuid) from public;
