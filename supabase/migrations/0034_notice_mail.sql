-- Email: the half of 0028 that was left out on purpose.
--
-- Notices work, and they are the right shape — written inside the transaction
-- that causes them, so a notice cannot arrive without its cause. What they
-- have never had is a way out of the browser. A manager who is not on the site
-- is told nothing, which matters on exactly the two occasions that decide
-- whether people enjoy a season: draft night, and Sunday morning with an
-- illegal lineup.
--
-- So this adds a delivery channel rather than a second notification system.
-- Every notice already written by every function that announces something is
-- eligible; nothing that raises a notice needs to change, or knows this exists.

-- ------------------------------------------------------------ the address ---

-- Nullable on purpose. A league runs perfectly well with nobody's address in
-- it — they simply get the in-app notices they already had — and a manager who
-- would rather not hand over an email should not be made to.
alter table managers
  add column if not exists email text,
  add column if not exists email_notices boolean not null default true;

-- A manager owns their own address and their own choice about being emailed,
-- the same way they own their franchise name. The row policy from 0001 already
-- limits a session to its own row, so the column grant is the whole of it.
grant update (email, email_notices) on managers to authenticated;

-- --------------------------------------------------------------- the queue ---

alter table notices
  add column if not exists emailed_at timestamptz;

-- Only the unsent are ever looked for, and they are a vanishing fraction of an
-- inbox that only grows — so the index covers those rows and no others.
create index if not exists notices_unsent_idx
  on notices (created_at) where emailed_at is null;

-- Everything that already existed counts as delivered. Without this, the first
-- run after switching mail on would post a season of history to twelve people
-- at once, which is the sort of thing that gets an app filtered as spam by the
-- only twelve addresses that matter.
update notices set emailed_at = now() where emailed_at is null;

/**
 * Claims a batch of notices to email, and marks them claimed.
 *
 * Claim-then-send rather than send-then-mark, so two overlapping cron runs
 * cannot post the same notice twice: the first marks the rows, the second
 * finds nothing. SKIP LOCKED is what makes that true under concurrency without
 * either run waiting on the other.
 *
 * The cost of that order is a notice lost when the provider fails mid-send.
 * That is what release_notice_mail below is for — the caller hands back
 * anything it could not deliver and the next run picks it up, the same
 * claim-and-restore shape the intro-video cleanup uses.
 *
 * Only rows from the last day are eligible. A cron that has been down for a
 * week should resume, not deliver the week.
 */
create or replace function claim_notice_mail(p_limit int default 25)
returns table (
  notice_id  uuid,
  email      text,
  franchise  text,
  kind       text,
  body       text,
  href       text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select n.id
      from notices n
      join managers m on m.id = n.manager_id
     where n.emailed_at is null
       and n.created_at > now() - interval '1 day'
       and m.email is not null
       and m.email_notices
     order by n.created_at
     limit greatest(1, least(100, coalesce(p_limit, 25)))
     for update of n skip locked
  )
  update notices n
     set emailed_at = now()
    from claimed c
    join managers m on true
   where n.id = c.id
     and m.id = n.manager_id
  returning n.id, m.email, m.franchise, n.kind, n.body, n.href;
end;
$$;

revoke all on function claim_notice_mail(int) from public;
-- Deliberately granted to nobody. Only the service key reaches this, from the
-- cron route: a session that could claim mail could mark somebody else's
-- notices delivered and silently stop their email.

/**
 * Hands back notices that could not be delivered.
 *
 * A claim that is not released and not sent is a notice nobody ever gets, so
 * the send path releases everything it failed on. Releasing a notice that was
 * in fact delivered would send it twice, which is why only the caller that
 * claimed it may do this — and why it does nothing to a notice claimed by a
 * different run and already sent.
 */
create or replace function release_notice_mail(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_freed int;
begin
  update notices
     set emailed_at = null
   where id = any (coalesce(p_ids, '{}'::uuid[]))
     and emailed_at is not null;

  get diagnostics v_freed = row_count;
  return v_freed;
end;
$$;

revoke all on function release_notice_mail(uuid[]) from public;

-- purge_league_season is deliberately NOT re-emitted here. It already deletes
-- from notices, and the mail queue is a column on that table rather than a
-- table of its own — so a reset clears it with everything else and the
-- function needs no change. Re-stating it to "keep the list together" would
-- mean maintaining a second copy of a delete list, which is exactly how the
-- copy ends up missing a table the original has.
