-- A man you signed scores for you.

-- Best ball fills the starting slots from roster_slots.position, because the
-- database has to know that a name is a running back now that nobody drags him
-- into a slot by hand. make_pick writes it. Nothing else did.
--
-- So a player signed off the wire or out of free agency arrived with no
-- position, and a player with no position is in no slot — not his own, and not
-- the flex, because best_ball_lineup tests both against the same column. He
-- sat on the roster looking perfectly normal, the app drew him with his
-- position beside his name out of its own player pool, and he scored nothing.
-- Nothing anywhere said so: the matchup was simply lower than it should have
-- been.
--
-- The score refresh backfilled positions afterwards, which is why this was
-- survivable rather than permanent — but "survivable" here means the points
-- came back at the next refresh, and if the week was graded first they never
-- did, because a graded matchup keeps the number it was graded with.
--
-- Fixed as a trigger rather than in the four functions that insert, because
-- there were four and a fifth would have been written eventually. It fills the
-- column only when the caller has not, so the draft still says what it knows.

create or replace function roster_slot_position()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.position, '') = '' then
    select nullif(p.position, '') into new.position
      from nfl_players p
     where p.name = new.player_name;
  end if;

  return new;
end;
$$;

drop trigger if exists roster_slots_position on roster_slots;
create trigger roster_slots_position
  before insert or update of player_name on roster_slots
  for each row execute function roster_slot_position();

-- And everybody already sitting on a roster without one. These are the players
-- signed since best ball arrived whose position the score refresh has not yet
-- got to — every one of them is currently worth nought to his manager.
update roster_slots r
   set position = p.position
  from nfl_players p
 where p.name = r.player_name
   and coalesce(r.position, '') = ''
   and coalesce(p.position, '') <> '';
