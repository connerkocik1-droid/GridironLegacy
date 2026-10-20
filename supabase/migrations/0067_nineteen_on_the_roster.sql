-- Nineteen players, not eighteen.
--
-- The cap is still not a setting of its own: roster_capacity adds the
-- starting slots to the bench. The same ten on the field and a bench of nine
-- makes nineteen. Injured reserve stays outside it, as always.
--
-- The draft's rounds are left alone. This season's draft is done, and a
-- completed board is never redrawn; one more place on every roster is simply
-- one more free agent each franchise can carry.

update leagues
   set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('bench', 9);
