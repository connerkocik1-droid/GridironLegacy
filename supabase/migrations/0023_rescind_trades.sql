-- Taking an offer back.
--
-- Until now the only way out of an offer you had sent was to decline it, which
-- put "Declined." in the thread and told the other manager they had turned
-- down something they may never have read. Withdrawing is a different act and
-- now says so.
--
-- The rule is symmetric rather than "the proposer may cancel": you may take
-- back terms of yours that are on the table and have not been accepted. That
-- covers a proposer withdrawing their offer and, just as fairly, a manager
-- withdrawing a counter they made.

alter table trades drop constraint if exists trades_status_check;
alter table trades add constraint trades_status_check
  check (status in ('open','countered','agreed','executed','declined','rescinded'));

/**
 * Nobody accepts on somebody else's behalf — and nobody withdraws on it either.
 *
 * Replaces the guard from 0010 with one more rule. The route enforces the same
 * thing, but the route is not the only way to reach this row: both managers in
 * a trade may update it, so a recipient could otherwise mark an offer they
 * received as "rescinded" and have the thread say the sender took it back.
 */
create or replace function guard_trade_acceptance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me uuid;
begin
  -- Anything not arriving as a browser session — the service key, or a
  -- definer function such as execute_trade — is past this.
  if current_user not in ('authenticated', 'anon') then return new; end if;

  select id into v_me from managers where auth_user_id = auth.uid();
  if v_me is null then return new; end if;

  if v_me = new.from_manager and new.to_accepted is distinct from old.to_accepted then
    raise exception 'You cannot accept on the other manager''s behalf'
      using errcode = '42501';
  end if;

  if v_me = new.to_manager and new.from_accepted is distinct from old.from_accepted then
    raise exception 'You cannot accept on the other manager''s behalf'
      using errcode = '42501';
  end if;

  -- Only execute_trade() marks a trade executed, and it checks both
  -- acceptances first. Letting a party set it directly would either fake a
  -- completed deal or block a real one from ever running.
  if new.status = 'executed' and old.status is distinct from 'executed' then
    raise exception 'A trade is executed by accepting it, not by setting its status'
      using errcode = '42501';
  end if;

  -- You may only take back your own terms, and only while they are still
  -- waiting. Once the other side has accepted there is nothing to withdraw —
  -- the deal either ran or is blocked on something real.
  if new.status = 'rescinded' and old.status is distinct from 'rescinded' then
    if not (
      (v_me = old.from_manager and old.from_accepted and not old.to_accepted)
      or (v_me = old.to_manager and old.to_accepted and not old.from_accepted)
    ) then
      raise exception 'Only the manager waiting on a reply may withdraw the offer'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trades_guard_acceptance on trades;
create trigger trades_guard_acceptance
  before update on trades
  for each row execute function guard_trade_acceptance();

-- execute_trade already refuses anything both managers have not accepted, and
-- withdrawing clears the acceptance, so a rescinded trade cannot execute. It
-- is not re-emitted here just to reword the message it gives.
