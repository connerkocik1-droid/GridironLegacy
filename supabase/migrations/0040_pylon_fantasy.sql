-- The app is called Pylon Fantasy.
--
-- Everything else about the rename lives in the code: the wordmark, the page
-- titles, the home-screen icon, the footer on every email. One thing does not,
-- and it is the one thing that would keep showing the old name after a
-- deployment — the league's own row.
--
-- seed_league named it after the app, so a league that has never been renamed
-- is called "Gridiron Legacy" and says so on the league page, the rules page
-- and the commissioner's office. That is the app's old name sitting in
-- somebody's data.
--
-- Renamed here, and only where it is still the name the seed gave it. A
-- commissioner who has called their league something of their own keeps it:
-- this is finishing a rename, not overwriting a decision.

update leagues
   set name = 'Pylon Fantasy'
 where name = 'Gridiron Legacy';

-- Deliberately not touched, and worth writing down so a later rename attempt
-- does not undo it:
--
--   The synthetic sign-in addresses. Managers are keyed on
--   "<slot>.<league>@gridiron.invalid" in auth.users, and sign-in looks that
--   address up. Rebranding the domain would find nothing and lock all twelve
--   of them out for good — the same failure as changing AUTH_SECRET. Nobody
--   ever sees the string; it is a primary key wearing a brand name.
--
--   The header comment on 0001. It is a record of what was applied and when,
--   and history is not rebranded.
