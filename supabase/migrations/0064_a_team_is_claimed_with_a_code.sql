-- A team is claimed with a code, and a sign-in is counted by where it came from.
--
-- Two holes in the front door, both in the claim.
--
-- Claiming a franchise needed nothing but its name. That is fine on the night
-- a league is set up and nowhere else: when the commissioner cleared a PIN or
-- let a manager go, the franchise — roster, record, picks and all — went to
-- whoever reached the sign-in page first, and the repository and the site are
-- both public. Now clearing a PIN or letting somebody go issues a one-time
-- code, which the office shows to the commissioner and nobody else, and the
-- claim needs it. A franchise with no code outstanding is claimed as before,
-- which is what setting up a new league still needs.
--
-- And a sign-in attempt was counted only against the franchise it named, so
-- one source could spend five tries on every franchise in turn. Attempts now
-- carry where they came from, and the routes refuse a source that has failed
-- too often, whichever franchise it names.
--
-- Additive: a new table nothing else reads, a nullable column, a new function.
-- The routes carry on exactly as before on a database that has not run this.

-- ------------------------------------------------------- the claim codes ---

/**
 * The code outstanding for a franchise, if any. One per franchise: issuing a
 * new one replaces the old, and a successful claim deletes it.
 *
 * Only a keyed hash is stored — HMAC under the server's AUTH_SECRET — so the
 * table is no use to anybody who reads it without the secret, and reading it
 * is not possible from a browser in the first place: row-level security is on
 * and there is no policy at all. The service key is the only way in.
 */
create table if not exists franchise_claims (
  manager_id uuid primary key references managers(id) on delete cascade,
  league_id  uuid not null references leagues(id) on delete cascade,
  code_hash  text not null,
  expires_at timestamptz not null,
  issued_by  uuid references managers(id) on delete set null,
  issued_at  timestamptz not null default now()
);

alter table franchise_claims enable row level security;
revoke all on franchise_claims from authenticated, anon;

-- ----------------------------------------------- where an attempt came from ---

alter table pin_attempts add column if not exists ip text;

create index if not exists pin_attempts_ip_idx
  on pin_attempts (ip, attempted_at desc)
  where ip is not null;

/**
 * How many failed attempts one source has made across every franchise within
 * the window. The per-franchise count in recent_pin_failures still applies;
 * this stops one source trying five PINs against each franchise in turn.
 */
create or replace function recent_ip_failures(
  p_ip text,
  p_window interval default interval '15 minutes'
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from pin_attempts
   where ip = p_ip
     and not succeeded
     and attempted_at > now() - p_window;
$$;

-- Read by the sign-in routes with the service key, and by nobody else.
revoke all on function recent_ip_failures(text, interval) from public, anon, authenticated;
