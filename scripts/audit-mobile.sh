#!/usr/bin/env bash
#
# Checks that every page still works on a phone.
#
#   ./scripts/audit-mobile.sh          # or: npm run audit:mobile
#   ./scripts/audit-mobile.sh --shots  # and keep a screenshot of every page
#
# Loads each page at 320px and 390px against a fixture of twelve franchises
# with long names, and fails on anything that runs off the screen, is too small
# to press, too small to read, or squeezed until its text wraps a word per
# line. scripts/mobile/audit.mjs says more about what each of those means.
#
# Starts its own Next server and its own Supabase stand-in, on ports of their
# own so a dev server you already have running is left alone.
#
# Playwright is a devDependency, but the browser it drives is not — that is a
# few hundred megabytes nobody wants on an install that is only ever going to
# run the app:
#
#   npx playwright install chromium
#
# Exits non-zero if anything is wrong, so CI can run it.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${AUDIT_PORT:-3123}
STUB_PORT=${STUB_PORT:-54399}
SHOTS=""
CONSOLE=""

# --console is the other lens on the same app. The audit answers /api/* in the
# browser from a fixture, which is right for measuring layout and means it
# never once runs the real route — so a page that renders a crash renders it
# identically at both widths and passes, twice. --console boots the same pair
# of servers and lets the routes answer for themselves, watching the console
# instead of the geometry. It is what found the bye week taking the roster
# page down.
#
# A loop rather than two ifs, so the flags can be given in either order and
# whatever is left over reaches the script underneath as a list of pages.
while [ $# -gt 0 ]; do
  case "$1" in
    --shots) SHOTS="$ROOT/.mobile-audit"; shift ;;
    --console) CONSOLE="1"; shift ;;
    --) shift; break ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done

cd "$ROOT"

# Checked the same way the audit imports it. require.resolve() would say yes
# to a global install that an ESM import then cannot find.
if ! node -e "import('playwright')" 2>/dev/null; then
  echo "Playwright is missing. Install the dependencies first:" >&2
  echo >&2
  echo "  npm install && npx playwright install chromium" >&2
  exit 2
fi

# A browser it can drive. Playwright finds its own unless told otherwise.
if [ -z "${PLAYWRIGHT_CHROMIUM:-}" ] && ! node -e "
  import('playwright').then(p => p.chromium.executablePath())" 2>/dev/null; then
  echo "Playwright has no browser installed:" >&2
  echo >&2
  echo "  npx playwright install chromium" >&2
  echo >&2
  echo "Or point PLAYWRIGHT_CHROMIUM at one you already have." >&2
  exit 2
fi

STUB_PID=""
NEXT_PID=""
LOG=$(mktemp)

# `next dev` runs its compiler in a child of its own, and killing only the
# process this script started leaves that child holding the port — so the next
# run cannot bind it. Children first, then the parent.
cleanup() {
  for pid in "$NEXT_PID" "$STUB_PID"; do
    [ -z "$pid" ] && continue
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  done
  rm -f "$LOG"
}
trap cleanup EXIT

STUB_PORT=$STUB_PORT LEAGUE_ID=league-a node "$ROOT/scripts/mobile/stub.mjs" >/dev/null 2>&1 &
STUB_PID=$!

# Passed as real environment variables rather than written to a file: a real
# environment variable beats .env.local, so this points the app at the stub
# without touching the one a developer is actually using. The keys are not
# secrets — the stub accepts anything.
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$STUB_PORT" \
NEXT_PUBLIC_SUPABASE_ANON_KEY=audit-anon-key \
SUPABASE_URL="http://127.0.0.1:$STUB_PORT" \
SUPABASE_SERVICE_KEY=audit-service-key \
LEAGUE_ID=league-a \
AUTH_SECRET=audit-secret-not-used-for-anything-real \
CRON_SECRET=audit \
  ./node_modules/.bin/next dev -p "$PORT" >"$LOG" 2>&1 &
NEXT_PID=$!

printf 'starting'
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then
    echo " — ready on $PORT"
    break
  fi
  printf '.'
  sleep 2
done

if ! curl -fsS -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then
  echo >&2
  echo "The app never came up on port $PORT. Its output:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

if [ -n "$CONSOLE" ]; then
  AUDIT_BASE="http://localhost:$PORT" AUDIT_SHOTS="$SHOTS" \
    node "$ROOT/scripts/mobile/console-check.mjs" "$@"
else
  AUDIT_BASE="http://localhost:$PORT" AUDIT_STUB="http://127.0.0.1:$STUB_PORT" \
    AUDIT_SHOTS="$SHOTS" node "$ROOT/scripts/mobile/audit.mjs"
fi
