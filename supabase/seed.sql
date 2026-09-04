-- Creating the league, without leaving the SQL editor.
--
-- `scripts/seed.mjs` does the same thing from a terminal, but that needs Node
-- and the service key on your own machine. This does not: it is the same work
-- expressed as a function you call once.
--
-- Run this whole file, then call it:
--
--   select * from seed_league('Gridiron Legacy', 12);
--
-- It prints the league id to set as LEAGUE_ID in Vercel.

/**
 * Creates the league and its open franchises, and builds the draft board.
 *
 * Every franchise is created unclaimed — no PIN, no owner. People claim one at
 * /signin, and claiming is what sets the PIN. The commissioner slot is marked
 * in advance but is still claimed the same way.
 *
 * Refuses if a league already exists, because seeding twice would leave two
 * and no way to tell the app which one it serves.
 */
create or replace function seed_league(
  p_name text default 'Gridiron Legacy',
  p_teams int default 12,
  p_commissioner text default null,
  p_season int default 2026
)
-- The output columns are named apart from the table columns they sit
-- beside, so a bare league_id inside the body is never ambiguous.
returns table (new_league_id uuid, franchise_count int, season_weeks int, note text)
language plpgsql
as $$
declare
  -- The seeded names, used in order. Past these, franchises are numbered.
  v_names text[][] := array[
    array['STL',  'Steel Cartel'],
    array['BLZ',  'Blaze Syndicate'],
    array['RVN',  'Ravenous'],
    array['APEX', 'Apex Union'],
    array['NOVA', 'Nova Collective'],
    array['HELX', 'Helix Nine'],
    array['VOLT', 'Voltage'],
    array['ONYX', 'Onyx Row'],
    array['ORBT', 'Orbital'],
    array['FLUX', 'Flux Capital'],
    array['ZEN',  'Zenith'],
    array['TITN', 'Titanfall']
  ];
  v_league   uuid;
  v_slot     text;
  v_name     text;
  v_comm     text;
  v_i        int;
  v_board    jsonb;
  v_sched    jsonb;
begin
  if p_teams < 2 or p_teams > 16 then
    raise exception 'A league runs from 2 to 16 franchises';
  end if;

  if exists (select 1 from leagues) then
    raise exception
      'A league already exists. Delete it first if you meant to start over: delete from leagues;';
  end if;

  v_comm := coalesce(upper(p_commissioner), v_names[1][1]);

  insert into leagues (name, season, commissioner_slot, settings, draft_state, current_pick)
  values (
    p_name, p_season, v_comm,
    jsonb_build_object(
      'rounds', 18,
      'pickSeconds', 90,
      'cinematicRounds', 3,
      'lottery', true,
      'scoring', 'half',
      'starters', jsonb_build_object(
        'QB', 1, 'RB', 2, 'WR', 2, 'TE', 1, 'FLEX', 2, 'D/ST', 1, 'K', 1
      ),
      'bench', 8,
      'ir', 2,
      'regularWeeks', 13,
      'playoffWeeks', 4,
      'waiverMode', 'waivers',
      -- How long a dropped player sits on the wire before the run releases him.
      'waiverDays', 1
    ),
    'pending', 1
  )
  returning id into v_league;

  for v_i in 1..p_teams loop
    if v_i <= array_length(v_names, 1) then
      v_slot := v_names[v_i][1];
      v_name := v_names[v_i][2];
    else
      v_slot := 'T' || lpad(v_i::text, 2, '0');
      v_name := 'Open Team';
    end if;

    -- name is 'Open' until somebody claims the franchise and gives their own.
    insert into managers (league_id, slot, name, franchise, pin_hash, is_commissioner)
    values (v_league, v_slot, 'Open', v_name, null, v_slot = v_comm);
  end loop;

  -- Nobody matched the requested commissioner slot, so the first franchise
  -- holds the office rather than the league having none.
  if not exists (select 1 from managers where league_id = v_league and is_commissioner) then
    update managers set is_commissioner = true
     where id = (select id from managers where league_id = v_league order by slot limit 1);
  end if;

  -- Both are generated rather than typed in, so the board and the season match
  -- the league that actually exists.
  v_board := rebuild_draft_board(v_league);
  v_sched := generate_schedule(v_league);

  return query
  select v_league,
         p_teams,
         (v_sched ->> 'weeks')::int,
         format(
           '%s picks over %s rounds; %s matchups, %s divisional. Set LEAGUE_ID to the id above.',
           v_board ->> 'picks', v_board ->> 'rounds',
           v_sched ->> 'matchups', v_sched ->> 'divisional'
         );
end;
$$;
