-- A game knows how long it has left.
--
-- The win probability on the matchup page treated anybody whose game was under
-- way as still owing whatever of his projection he had not scored — at the
-- start of the first quarter and with two minutes to play alike. A receiver on
-- nought late in the fourth was "owed" his whole projection, so a side that
-- was plainly beaten read as a coin toss until the final whistle.
--
-- The scoreboard has always sent the quarter and the clock. The mirror threw
-- them away. These two columns keep them, for games in progress only: the
-- mirror writes null for a game before kickoff and after the whistle, so a
-- finished game does not hold on to the clock it ended on.
--
-- Nullable and without defaults, so adding them does not rewrite the table,
-- and nothing reads them as required: the app falls back to the time since
-- kickoff wherever they are null, and the mirror writes around them on a
-- database that has not run this yet. Safe to apply mid-season, on any day.

alter table nfl_games add column if not exists period int;
alter table nfl_games add column if not exists clock numeric;

comment on column nfl_games.period is
  'The quarter being played, 5 and up for overtime. Null unless the game is in progress.';
comment on column nfl_games.clock is
  'Seconds left in that quarter. Null unless the game is in progress.';
