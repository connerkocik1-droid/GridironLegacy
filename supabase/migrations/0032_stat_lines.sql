-- The numbers behind the number.
--
-- A score on its own is a thing to be argued about. "18.4" beside a name tells
-- a manager nothing about whether his receiver was quiet or whether the app
-- lost half a box score, and the only way to settle it is to go and look
-- somewhere else. The stat line is what makes the score legible.
--
-- Kept as structured JSON rather than as the sentence to be shown, because the
-- wording depends on the position and the position is better known where the
-- line is displayed than where it is written. The roster knows a man is a
-- tight end even when he never entered our draft pool and ESPN forgot to say;
-- the ingestion, looking only at a box score, does not always.
--
-- player_scores already carries a stat_line column holding a sentence written
-- without regard to position. It stays, and stays written, so that a row from
-- before this migration still shows something rather than a blank.

alter table player_scores
  add column if not exists stats jsonb;

comment on column player_scores.stats is
  'Structured stat line: completions, attempts, passYards, carries, targets, '
  'receptions, recYards, touchdowns by kind, and for a unit sacks, takeaways, '
  'fumblesRecovered, pointsAllowed, yardsAllowed, kickReturnTd, puntReturnTd. '
  'Formatted for display by src/lib/scoring.ts formatStatLine(), which decides '
  'the wording from the position. Null on rows written before 0032.';
