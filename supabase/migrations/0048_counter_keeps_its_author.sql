-- A counter is an offer, so the manager making it has made it.

-- Changing the terms of a trade has always voided both acceptances, which is
-- right for the side that did not change them: nobody should find themselves
-- committed to a deal that was rewritten after they agreed to it.
--
-- It is wrong for the side that did. A counter is that manager saying "not
-- that, this" — the new terms are theirs. Voiding their acceptance too left a
-- counter waiting on its own author, so the desk asked them to accept an offer
-- they had just written, and until they did the other manager's acceptance
-- could not complete anything. Nobody noticed while a counter could only be
-- made by hand; a button on every received offer makes it the common path.
--
-- So a change of terms voids the other side, always, and leaves the author's
-- own flag exactly as their statement left it. The property that matters is
-- that nobody is ever bound to terms they have not seen, and voiding the other
-- side is the whole of it — a manager asserting they accept an offer they
-- themselves just wrote is not a thing anybody needs protecting from, and the
-- guard in 0023 already refuses either of them touching the other's flag.
--
-- The status goes back to 'countered' either way, so a deal that was out for a
-- league vote when somebody rewrote it drops out of the vote and has to be
-- agreed again. That is the right answer: the league voted on the old terms.

create or replace function void_acceptance_on_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me uuid;
begin
  if new.offer is not distinct from old.offer then
    return new;
  end if;

  new.status := 'countered';

  -- Anything not arriving as a browser session — the service key, or a
  -- definer function — has no manager behind it, so there is nobody whose
  -- acceptance could be meant. Both go, as they always did.
  if current_user in ('authenticated', 'anon') then
    select id into v_me from managers where auth_user_id = auth.uid();
  end if;

  if v_me is null then
    new.from_accepted := false;
    new.to_accepted := false;
    return new;
  end if;

  if v_me = new.from_manager then
    new.to_accepted := false;
  elsif v_me = new.to_manager then
    new.from_accepted := false;
  else
    -- A third party cannot rewrite somebody else's deal, but if one somehow
    -- does then neither manager has agreed to what came out of it.
    new.from_accepted := false;
    new.to_accepted := false;
  end if;

  return new;
end;
$$;
