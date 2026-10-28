-- Twenty players, not nineteen, and two on injured reserve.
--
-- The cap is the starting slots plus the bench (roster_capacity), so the
-- same ten starters and a bench of ten makes twenty. Injured reserve stays
-- outside it, as always, at two places — set here too, so a league that had
-- it at anything else ends up at twenty plus two.
--
-- The draft's rounds are left alone, as 0067 left them: this season's draft
-- is done, and one more place on every roster is one more free agent each
-- franchise can carry.

update leagues
   set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('bench', 10, 'ir', 2);
