#!/usr/bin/env bash
#
# Runs the database rule tests against a throwaway Postgres.
#
# The rules that keep a league consistent — a player drafted once, a trade that
# either fully applies or not at all, a franchise nobody can delete out from
# under its owner — live in SQL, so they are tested in SQL.
#
#   ./scripts/test-db.sh
#
# Needs a local Postgres install (the `postgres` user and initdb/pg_ctl). It
# creates a cluster under a temporary directory and removes it afterwards.

set -euo pipefail

PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
PORT=${PGPORT:-5433}
DATA=$(mktemp -d)
SOCK=$(mktemp -d)
ROOT=$(cd "$(dirname "$0")/.." && pwd)

if [ ! -x "$PGBIN/initdb" ]; then
  echo "Could not find initdb. Set PGBIN to your Postgres bin directory." >&2
  exit 1
fi

cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap cleanup EXIT

# initdb insists on owning its data directory; the socket directory only has
# to be writable by the server and readable by psql.
chown postgres "$DATA" 2>/dev/null || true
chmod 777 "$SOCK"

su postgres -c "$PGBIN/initdb -D $DATA -U postgres --auth=trust" >/dev/null

# Listen on the socket only. Nothing outside this script needs to reach the
# cluster, and it keeps the run from colliding with anything on the port.
if ! su postgres -c \
  "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k $SOCK -c listen_addresses=' -l $DATA/log start" >/dev/null; then
  echo "Postgres did not start:" >&2
  cat "$DATA/log" >&2 || true
  exit 1
fi

for _ in $(seq 1 20); do
  psql -h "$SOCK" -p "$PORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break
  sleep 0.5
done

psql() { command psql -h "$SOCK" -p "$PORT" -U postgres -d postgres "$@"; }

# Stand-ins for what Supabase provides, so the migrations run unmodified.
psql -q -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create role authenticated;
create role anon;

-- The tests set test.uid to choose who is signed in.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

create publication supabase_realtime;
SQL

for migration in "$ROOT"/supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -f "$migration"
done

OUTPUT=$(psql -q -f "$ROOT/supabase/tests/rules.sql" 2>&1)
echo "$OUTPUT"

FAILED=$(echo "$OUTPUT" | grep -c '^FAIL' || true)
PASSED=$(echo "$OUTPUT" | grep -c '^PASS' || true)

echo "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
