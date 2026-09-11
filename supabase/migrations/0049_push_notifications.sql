-- Telling a manager something when the app is shut.

-- Everything the league knows happens while nobody is looking at it: a back
-- goes down on Friday, a matchup turns over on Sunday afternoon, a week gets
-- graded on Tuesday morning. Notices have always carried that inside the app
-- and email has carried it out of the app, but neither reaches somebody whose
-- phone is in their pocket, which is where the phone usually is.
--
-- Four kinds, and a manager picks which of them are worth a buzz. They are
-- separate because they are wanted by different people at different times:
-- scoring is a Sunday thing and a torn hamstring is a Wednesday one, and
-- somebody who wants the recap does not necessarily want either.

-- ------------------------------------------------------------ the devices ---

/**
 * One row per browser that has agreed to be told.
 *
 * Keyed by endpoint rather than by manager, because a manager is a phone and a
 * laptop and a tablet, and each of them subscribes separately. The keys are
 * the browser's own: the app encrypts to them and cannot read anything back,
 * which is the point of the specification.
 */
create table if not exists push_subscriptions (
  endpoint   text primary key,
  manager_id uuid not null references managers(id) on delete cascade,
  league_id  uuid not null references leagues(id) on delete cascade,
  -- The subscriber's public key and auth secret, base64url as the browser
  -- gives them. Useless to anybody who is not the push service.
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  -- The last time a push service took a message for this device, and how many
  -- times in a row it has not. A device that has been thrown in a drawer
  -- stops being tried rather than being retried forever.
  last_ok_at timestamptz,
  failures   int not null default 0
);

create index if not exists push_subscriptions_manager
  on push_subscriptions (manager_id);

alter table push_subscriptions enable row level security;

drop policy if exists push_subs_own on push_subscriptions;
-- Your own devices and nobody else's. The endpoint is a capability: anybody
-- holding one can send that browser a notification, so this is the one table
-- in the app where a manager reading another's row would be a real problem.
create policy push_subs_own on push_subscriptions for select to authenticated
  using (manager_id in (select id from managers where auth_user_id = auth.uid()));

-- Written only through subscribe_push and forget_push, which check who.
revoke insert, update, delete on push_subscriptions from authenticated;
grant select on push_subscriptions to authenticated;

-- --------------------------------------------------------- what they want ---

/**
 * Which of the four a manager wants.
 *
 * On the manager rather than in a table of its own: it is four booleans that
 * are read every time anything is enqueued, and a join for four booleans is a
 * join for nothing. Everything starts off, including for managers who already
 * exist — turning notifications on is a thing somebody does, not a thing that
 * happens to them.
 */
alter table managers add column if not exists push_scores      boolean not null default false;
alter table managers add column if not exists push_recap       boolean not null default false;
alter table managers add column if not exists push_injuries    boolean not null default false;
alter table managers add column if not exists push_projections boolean not null default false;

-- A manager sets their own four, and only their own. The guard from 0010
-- decides which columns a session may write at all, so they are named here.
grant update (push_scores, push_recap, push_injuries, push_projections)
  on managers to authenticated;

-- ------------------------------------------------------------- the outbox ---

/**
 * What is waiting to be sent.
 *
 * A queue rather than each producer sending for itself, for the same reason
 * the email has one: sending is the part that touches the network, and the
 * network is the part that fails. A cron that knows nothing about football
 * drains this; the crons that know about football only write to it, inside the
 * transaction that noticed the thing worth saying.
 *
 * `dedupe` is what stops a scoring cron running every few minutes from saying
 * the same thing every few minutes. It is the message's identity — "this
 * manager, this week, this player, this status" — and a second insert with the
 * same one is quietly dropped.
 */
create table if not exists push_outbox (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  kind       text not null check (kind in ('scores', 'recap', 'injuries', 'projections')),
  title      text not null,
  body       text not null,
  href       text,
  dedupe     text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at    timestamptz
);

create unique index if not exists push_outbox_dedupe on push_outbox (manager_id, dedupe);
create index if not exists push_outbox_waiting
  on push_outbox (created_at) where claimed_at is null;

alter table push_outbox enable row level security;
-- Nobody reads this from a browser. What it holds is on the pages the
-- notifications point at; the queue itself is plumbing.
revoke all on push_outbox from authenticated, anon;

-- ------------------------------------------------------------- the doings ---

/**
 * A browser saying it will accept notifications.
 *
 * Replaces by endpoint, because a browser hands back the same endpoint when it
 * re-subscribes and a second row would mean two copies of every notification.
 */
create or replace function subscribe_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me managers;
begin
  select * into v_me from managers where auth_user_id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'A subscription needs an endpoint and both keys' using errcode = '22023';
  end if;

  insert into push_subscriptions (endpoint, manager_id, league_id, p256dh, auth)
  values (p_endpoint, v_me.id, v_me.league_id, p_p256dh, p_auth)
      on conflict (endpoint) do update
         set manager_id = excluded.manager_id,
             league_id  = excluded.league_id,
             p256dh     = excluded.p256dh,
             auth       = excluded.auth,
             -- A device coming back is a device that works. Whatever it owed
             -- from the last time it went quiet is forgiven.
             failures   = 0;
end;
$$;

grant execute on function subscribe_push(text, text, text) to authenticated;

/** A browser saying it will not. Only ever your own device. */
create or replace function forget_push(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
begin
  select id into v_me from managers where auth_user_id = auth.uid();
  if v_me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  delete from push_subscriptions where endpoint = p_endpoint and manager_id = v_me;
end;
$$;

grant execute on function forget_push(text) to authenticated;

/**
 * Something worth telling one manager about.
 *
 * Says nothing and writes nothing when they have not asked for that kind, or
 * have no device to be told on: the check belongs here rather than in each
 * producer, so a new producer cannot forget it. Returns whether anything was
 * queued, which is only of interest to a test.
 */
create or replace function enqueue_push(
  p_manager_id uuid,
  p_kind       text,
  p_title      text,
  p_body       text,
  p_href       text,
  p_dedupe     text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m     managers;
  v_wants boolean;
begin
  select * into v_m from managers where id = p_manager_id;
  if v_m.id is null then return false; end if;

  v_wants := case p_kind
    when 'scores'      then v_m.push_scores
    when 'recap'       then v_m.push_recap
    when 'injuries'    then v_m.push_injuries
    when 'projections' then v_m.push_projections
    else false
  end;

  if not v_wants then return false; end if;

  -- No device, nothing to queue. A row nobody can be sent would sit in the
  -- outbox forever being claimed and released.
  if not exists (select 1 from push_subscriptions where manager_id = p_manager_id) then
    return false;
  end if;

  insert into push_outbox (league_id, manager_id, kind, title, body, href, dedupe)
  values (v_m.league_id, p_manager_id, p_kind, p_title, p_body, p_href, p_dedupe)
      on conflict (manager_id, dedupe) do nothing;

  return found;
end;
$$;

revoke all on function enqueue_push(uuid, text, text, text, text, text) from public;
-- The service key only. A session that could enqueue could push anything it
-- liked to anybody who had notifications on.

/**
 * The next few messages, and the devices to send them to.
 *
 * One row per device, so a manager with a phone and a laptop gets both — and
 * marked claimed before anything is sent, so two runs overlapping cannot send
 * the same thing twice. Anything the network refuses is handed back.
 */
create or replace function claim_push(p_limit int default 40)
returns table (
  id         uuid,
  endpoint   text,
  p256dh     text,
  auth       text,
  kind       text,
  title      text,
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
    update push_outbox o
       set claimed_at = now()
     where o.id in (
       select q.id from push_outbox q
        where q.claimed_at is null
          -- A notification nobody has sent within the day is not news any
          -- more; a score from last Sunday buzzing on Wednesday is worse than
          -- no score at all.
          and q.created_at > now() - interval '1 day'
        order by q.created_at
        limit greatest(1, least(200, coalesce(p_limit, 40)))
        for update skip locked
     )
    returning o.id, o.manager_id, o.kind, o.title, o.body, o.href
  )
  select c.id, s.endpoint, s.p256dh, s.auth, c.kind, c.title, c.body, c.href
    from claimed c
    join push_subscriptions s on s.manager_id = c.manager_id
   -- Five refusals in a row is a device that is gone in every way but the
   -- row. It stops being tried, and comes back the moment it re-subscribes.
   where s.failures < 5;
end;
$$;

revoke all on function claim_push(int) from public;

/** Delivered. */
create or replace function push_sent(p_ids uuid[], p_endpoints text[])
returns void
language sql
security definer
set search_path = public
as $$
  update push_outbox set sent_at = now() where id = any(p_ids);
  update push_subscriptions
     set last_ok_at = now(), failures = 0
   where endpoint = any(p_endpoints);
$$;

revoke all on function push_sent(uuid[], text[]) from public;

/**
 * Not delivered, and why it matters which kind of not.
 *
 * A message the network would not take goes back in the queue for the next
 * run. A device the push service says no longer exists is deleted outright:
 * retrying a revoked endpoint is a request that can never succeed, and leaving
 * it there holds the manager's other devices behind it.
 */
create or replace function push_failed(p_ids uuid[], p_dead_endpoints text[])
returns void
language sql
security definer
set search_path = public
as $$
  update push_outbox set claimed_at = null where id = any(p_ids) and sent_at is null;
  update push_subscriptions set failures = failures + 1 where endpoint = any(p_dead_endpoints);
  delete from push_subscriptions where endpoint = any(p_dead_endpoints);
$$;

revoke all on function push_failed(uuid[], text[]) from public;

/** Everything sent, kept a week so a failure has somewhere to be seen from. */
create or replace function sweep_push()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gone int;
begin
  delete from push_outbox
   where (sent_at is not null and sent_at < now() - interval '7 days')
      or created_at < now() - interval '30 days';
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$$;

revoke all on function sweep_push() from public;
