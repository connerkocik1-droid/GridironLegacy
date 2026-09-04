-- Somewhere to talk.
--
-- Everything this league does to each other happens through the app — trades,
-- claims, a defence left in on a bye — and none of it can be commented on
-- inside it. The activity feed and the news wire are both read-only, so the
-- reaction to every one of those things happens in a group text, and a league
-- whose conversation lives somewhere else is a league that lives somewhere
-- else. Trash talk is not a nice-to-have in a dynasty league; it is most of
-- the reason people turn up in year four.
--
-- Deliberately not wired into notices. Every other notice is something that
-- happened *to* you and needs answering; a message is somebody talking, and a
-- league of twelve would email each other several hundred times a season. The
-- unread count on the page is the right amount of nagging for this.

create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues(id) on delete cascade,
  -- Who said it. Kept even when a franchise is released so the conversation
  -- does not lose half its speakers; the cascade is on the league, not the
  -- manager, and a released franchise keeps its manager row.
  manager_id uuid not null references managers(id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- The only query this table ever serves: one league's messages, newest first.
create index if not exists messages_league_idx
  on messages (league_id, created_at desc);

alter table messages enable row level security;

-- Everyone in the league reads everything in it. A private message is a
-- different feature with different rules, and half-building it here would give
-- people somewhere to say things they think are private and are not.
drop policy if exists messages_read on messages;
create policy messages_read on messages
  for select using (league_id = (select league_id from current_manager()));

-- You may say things as yourself, in your own league. Both halves are checked:
-- without the league test a manager could post into somebody else's.
drop policy if exists messages_write on messages;
create policy messages_write on messages
  for insert with check (
    manager_id = (select id from current_manager())
    and league_id = (select league_id from current_manager())
  );

-- Yours to take back, and the commissioner's to remove. Nobody else's.
drop policy if exists messages_delete on messages;
create policy messages_delete on messages
  for delete using (
    league_id = (select league_id from current_manager())
    and (
      manager_id = (select id from current_manager())
      or (select is_commissioner from current_manager())
    )
  );

grant select, insert, delete on messages to authenticated;
-- No update. An edited message is a message somebody can be misquoted from —
-- the honest version of changing your mind is deleting it and saying the other
-- thing, which leaves the conversation readable.

/**
 * Stops one manager filling the room.
 *
 * Not a moderation policy — it is a guard against a stuck key, a retry loop or
 * somebody being funny for ninety seconds. Ten in a minute is far more than a
 * conversation needs and far less than a flood.
 */
create or replace function guard_message_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
    from messages
   where manager_id = new.manager_id
     and created_at > now() - interval '1 minute';

  if v_recent >= 10 then
    raise exception 'That is a lot of messages in a minute — give it a moment'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_rate on messages;
create trigger messages_rate
  before insert on messages
  for each row execute function guard_message_rate();

-- Neither the season purge nor the league reset is changed to clear this, and
-- that is the decision rather than an oversight. A dynasty league rolling into
-- its fifth season should not lose four years of what people said to each
-- other — the conversation is the part of a long-running league that is
-- actually worth keeping. Deleting the league itself still takes it, through
-- the cascade above.

-- Realtime, so a conversation reads like one rather than like a page that
-- happens to change. draft_picks and leagues are already published this way.
do $$
begin
  alter publication supabase_realtime add table messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
