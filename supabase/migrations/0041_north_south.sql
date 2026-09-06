-- The divisions are North and South.
--
-- They were East and West, which was never a decision — it was the pair of
-- names 0009 happened to pick when it split a league in half. This is the
-- commissioner naming them, and it has to reach three places or the old names
-- grow back:
--
--   1. The managers who already carry a division. A rename that leaves the
--      rows alone renames nothing anybody can see.
--   2. assign_missing_divisions, which names both divisions when a league has
--      none — so a league resized before its first game would re-create East
--      and West underneath a standings page saying North and South.
--   3. assign_division_on_insert, the trigger every new franchise passes
--      through. This is the one that matters most: it fires on the seed, on a
--      resize, and on next season's rollover, so leaving it would mean the
--      thirteenth franchise anybody ever adds arrives in the East.
--
-- Only the two names the app itself chose are touched. A commissioner who has
-- already renamed their divisions to something of their own keeps them: this
-- is replacing a default, not overwriting a decision.
--
-- North sorts before South exactly as East sorted before West, which matters
-- more than it looks: every "order by division" in 0009 — the rematch
-- ordering, the standings grouping, the tie-break that picks the smaller
-- division by name — keeps the behaviour it was tested with.

update managers set division = 'North' where division = 'East';
update managers set division = 'South' where division = 'West';

/**
 * A franchise added by a resize has no division, which would leave it out of
 * the divisional rematches. New slots join the smaller division, so the two
 * stay as even as the league allows.
 *
 * Unchanged from 0009 but for the pair of names.
 */
create or replace function assign_missing_divisions(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_divs  text[];
  v_small text;
begin
  select array_agg(distinct division order by division) into v_divs
    from managers where league_id = p_league_id and division is not null;

  -- A league with no divisions at all splits evenly by slot.
  if v_divs is null or array_length(v_divs, 1) < 2 then
    update managers m
       set division = case when seq.rn * 2 <= seq.total then 'North' else 'South' end
      from (
        select id,
               row_number() over (order by slot) as rn,
               count(*) over () as total
          from managers where league_id = p_league_id
      ) seq
     where seq.id = m.id;
    return;
  end if;

  for v_id in
    select id from managers
     where league_id = p_league_id and division is null
     order by slot
  loop
    select division into v_small
      from managers
     where league_id = p_league_id and division is not null
     group by division
     order by count(*), division
     limit 1;

    update managers set division = v_small where id = v_id;
  end loop;
end;
$$;

revoke all on function assign_missing_divisions(uuid) from public;

-- Any franchise created later — by a resize, or by the seed script — joins a
-- division automatically, so a league can never end up with a franchise that
-- sits outside the divisional rematches.
create or replace function assign_division_on_insert()
returns trigger
language plpgsql
as $$
declare
  v_divs  text[];
  v_small text;
begin
  if new.division is not null then return new; end if;

  select array_agg(distinct division order by division) into v_divs
    from managers where league_id = new.league_id and division is not null;

  -- A league that has not got two divisions yet is filling the first ones, so
  -- both names have to be candidates: picking the smallest of what exists
  -- would put everybody in whichever division was created first.
  if v_divs is null or array_length(v_divs, 1) < 2 then
    v_divs := array['North', 'South'];
  end if;

  select d into v_small
    from unnest(v_divs) as d
    left join managers m
      on m.league_id = new.league_id and m.division = d
   group by d
   order by count(m.id), d
   limit 1;

  new.division := coalesce(v_small, 'North');
  return new;
end;
$$;

drop trigger if exists managers_division on managers;
create trigger managers_division
  before insert on managers
  for each row execute function assign_division_on_insert();
