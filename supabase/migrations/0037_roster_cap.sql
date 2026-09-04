-- Eighteen players, not twenty-four.
--
-- The cap has never been a setting of its own: roster_capacity adds the
-- starting slots to the bench, so ten starters and a bench of fourteen made
-- twenty-four. Eighteen means a bench of eight — the same ten on the field,
-- eight behind them, and injured reserve outside it as always.
--
-- The draft rounds move with it. They have always matched the roster exactly,
-- so that a completed draft leaves every franchise full and nobody has to drop
-- a player they just spent a pick on; twenty-four rounds into an eighteen-man
-- roster would refuse the last six picks of every team.
--
-- Best ball makes the smaller number matter more than it used to. Nobody is
-- setting a lineup, so a deep bench is no longer somewhere to stash a hunch —
-- every player you own is playing every week, and eight of depth is a real
-- decision about which eight rather than a wall of names nobody looks at.

update leagues
   set settings = coalesce(settings, '{}'::jsonb)
                || jsonb_build_object('bench', 8, 'rounds', 18);

/**
 * Rebuilds the board to match, where that is still possible.
 *
 * rebuild_draft_board refuses once a single pick has been made, and rightly:
 * redrawing a board mid-draft would renumber picks people have already used.
 * So this asks it only for leagues that have not started, and leaves the rest
 * alone rather than failing the migration.
 *
 * A league that is already drafting keeps its twenty-four rounds and its
 * twenty-four-man rosters until the commissioner deals with it. That is the
 * honest outcome: the alternative is a board that no longer matches the picks
 * sitting on it.
 */
do $$
declare
  v_league uuid;
begin
  for v_league in
    select l.id
      from leagues l
     where not exists (
       select 1 from draft_picks p
        where p.league_id = l.id and p.player_name is not null
     )
  loop
    perform rebuild_draft_board(v_league);
  end loop;
end;
$$;

-- Rosters already over the new cap are not touched. roster_count is only
-- consulted when somebody adds a player, so an over-full roster simply cannot
-- take another until it is under eighteen — which is the rule doing its job
-- rather than the migration deleting somebody's tight end.
