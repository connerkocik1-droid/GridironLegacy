-- Letting a manager say they are ready.
--
-- The column has been on managers since the first migration and nothing has
-- ever written to it: 0010 revoked update on the whole table and handed back
-- only name and franchise, which was right at the time because nothing else
-- was a manager's to set. This is.
--
-- Rows are already settled by managers_self_update — a session may only write
-- its own row — so the grant is the whole of what is needed. A manager marks
-- themselves ready and nobody else.
--
-- What makes the button worth having is not the flag. Browsers will not play a
-- video with sound until the person watching has interacted with the page, and
-- on draft night most of the room will have done nothing but leave a countdown
-- open. A button they must press to be counted in is a button that is pressed
-- before the film starts, which is the only way the room hears it.

grant update (ready) on managers to authenticated;
