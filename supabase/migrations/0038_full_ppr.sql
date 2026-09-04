-- A point a catch.
--
-- The league is full PPR rather than half. One line, because the scorer has
-- read the format from the settings since the day it was written and nothing
-- else in the database has an opinion about receptions.
--
-- Worth being explicit about what this does not change: every score already
-- recorded stays as it was. player_scores holds numbers, not the rules that
-- produced them, and a week already graded keeps the points it was settled on.
-- Re-scoring the season under the new rule would rewrite results people have
-- already lived with — a matchup somebody lost by two would change hands
-- months later. If this needs applying to weeks already played, that is a
-- deliberate re-run of the scoring job for those weeks, not a migration.

update leagues
   set settings = coalesce(settings, '{}'::jsonb) || '{"scoring": "ppr"}'::jsonb;
